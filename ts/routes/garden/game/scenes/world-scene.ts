// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: walkable overworld — tile layers, avatar, plants, juice, day/night (doc 23 §6–§9).
import Phaser from "phaser";

import type { TypedBus } from "../../state/bus";
import type { DepthStats } from "../../state/depth-stats";
import type { MasterySnapshot, TopicMastery } from "../../state/mastery";
import { type GrowthStage, stageFor, wiltLevelFor } from "../../state/stage";
import { applyWilt } from "../wilt";
import { aimLabelText } from "../aim-label";
import {
    applyDisplaySize,
    DISPLAY,
    ensureTexture,
    hasAssetKey,
    regionThemeFromSection,
    sizeToHeightTiles,
    stageTextureKey,
} from "../assets";
import { baseBoxFor, boxesOverlap, firstOpenSpot, footBoxAt, moveWithSlide, type SolidBox } from "../collision";
import { skyStateFor } from "../daynight";
import { planFlora } from "../flora";
import { FloraLayer } from "../flora-layer";
import { clampFeetToTileRect, cloudNoise, fogDensityAt } from "../fog";
import { Gardener } from "../gardener";
import {
    buildIslandPlan,
    ISLAND_SUBTITLE,
    ISLAND_TITLE,
    islandCameraBounds,
    islandContainsPoint,
    islandFootBlocked,
    type IslandPlan,
    paintIsland,
} from "../island";
import { OvergrowthLayer, type OvergrowthPlotInput } from "../overgrowth";
import { sectorFor } from "../sectors/index";
import { buildTerrainModel, paintGround, planDecor, terrainKindAt, type TerrainModel } from "../terrain";
import { WeatherLayer } from "../weather";
import {
    buildWorldPlan,
    CENTER_PLAZA,
    type GardenSection,
    KEEPER_TILE,
    type PlantSpot,
    sectionAtTile,
    type TileCoord,
    waterIsSolid,
    waystoneArrivalTiles,
    type WorldPlan,
} from "../worldgen";

export interface GardenFlags {
    paraphrase: Record<string, number>;
    weeds: Record<string, boolean>;
    /** True once the master's placement test is done — false boots the island fogged. */
    placementDone?: boolean;
}

interface PlantObject {
    nodeId: string;
    sprite: Phaser.GameObjects.Image;
    spot: PlantSpot;
    /** Region art theme (regionThemeFromSection) — picks the region's flower species. */
    theme: string;
    marker?: Phaser.GameObjects.Arc;
}

const INTERACT_RADIUS = 1.5;

// Overworld camera: the base zoom is tuned for a ~720p viewport. Under Phaser
// Scale.RESIZE the canvas fills the window, so we scale zoom up with the viewport
// to keep a constant world slice visible (a bigger window must NOT reveal more map).
const BASE_ZOOM = 1.5;
const REFERENCE_WIDTH = 1280;
const REFERENCE_HEIGHT = 720;

// The one-time onboarding fog (2026-07-03 directive): pale morning mist hiding every
// garden but the Keeper's plaza until the placement test lifts it. World-space rects
// (never screen-space like the sky tint) so the shroud stays glued to the island.
// NOT flat rectangles: two full-island canvas textures whose per-pixel alpha is the
// smooth plaza falloff × layered value noise (fog.ts) — soft and wispy; the top drifts.
const FOG_DEPTH = 7500; // above every standing sprite (y/tile), below the sky tint at 8000
const FOG_FALLOFF_TILES = 2.5;
const FOG_CANVAS_PX_PER_TILE = 8; // painted at 1/4 world res — soft gradients, cheap boot
const FOG_PAD_TILES = 2; // texture margin past the island so the drift never shows an edge
const FOG_LIFT_MS = 3000;

/** First key with a loaded asset, or the last as the placeholder fallback. */
function pickFirstAsset(keys: string[]): string {
    for (const k of keys) {
        if (hasAssetKey(k)) {
            return k;
        }
    }
    return keys[keys.length - 1];
}

/** The eight movement facings (arrows/WASD can press two axes at once). */
type Dir8 =
    | "down"
    | "down-left"
    | "left"
    | "up-left"
    | "up"
    | "up-right"
    | "right"
    | "down-right";

/** Movement vector (each component -1|0|1) → one of the eight facings. */
function facing8(dx: number, dy: number): Dir8 {
    let v = "";
    if (dy < 0) {
        v = "up";
    } else if (dy > 0) {
        v = "down";
    }
    let h = "";
    if (dx < 0) {
        h = "left";
    } else if (dx > 0) {
        h = "right";
    }
    if (v && h) {
        return `${v}-${h}` as Dir8;
    }
    return (v || h || "down") as Dir8;
}

/** Gardener frame texture keys (individual PNGs, not a sprite-atlas). */
const G = {
    idleDown: "gardener-idle-down",
    idleUp: "gardener-idle-up",
    idleSide: "gardener-idle-side-a",
    // Every facing has its own four authored walk contacts (real art), with the watering can drawn
    // in the same hand/position across each cycle so the legs scissor while the can stays put — no
    // whole-sprite mirror to fake a step (that would swing the low-held can side-to-side).
    walkDownA: "gardener-walk-down-a",
    walkDownB: "gardener-walk-down-b",
    walkDownC: "gardener-walk-down-c",
    walkDownD: "gardener-walk-down-d",
    walkUpA: "gardener-walk-up-a",
    walkUpB: "gardener-walk-up-b",
    walkUpC: "gardener-walk-up-c",
    walkUpD: "gardener-walk-up-d",
    walkSideA: "gardener-walk-side-a",
    walkSideB: "gardener-walk-side-b",
    walkSideC: "gardener-walk-side-c",
    walkSideD: "gardener-walk-side-d",
    // Three-quarter diagonal facings (drawn facing the LEFT diagonals; the right diagonals are the
    // per-facing horizontal mirror). down-left = 3/4 front angled left; up-left = 3/4 back angled left.
    walkDownLeftA: "gardener-walk-downleft-a",
    walkDownLeftB: "gardener-walk-downleft-b",
    walkDownLeftC: "gardener-walk-downleft-c",
    walkDownLeftD: "gardener-walk-downleft-d",
    walkUpLeftA: "gardener-walk-upleft-a",
    walkUpLeftB: "gardener-walk-upleft-b",
    walkUpLeftC: "gardener-walk-upleft-c",
    walkUpLeftD: "gardener-walk-upleft-d",
} as const;

/** One pose of a walk cycle: a texture + whether that texture is drawn mirrored. (The
 * right-facing mirror of the whole avatar is applied separately from FACING_GAIT; per-pose
 * `flip` is only for authoring a mirrored source frame.) */
interface Pose {
    key: string;
    flip: boolean;
}
interface Gait {
    walk: Pose[];
    idle: Pose;
}
const pose = (key: string, flip = false): Pose => ({ key, flip });

/** The five drawable gaits — front, back, side, and the two three-quarter diagonals. Each plays
 * four authored walk frames (real art) with the watering can drawn in the same hand/position across
 * the cycle, so the legs scissor while the can stays put. No gait mirrors the whole sprite to fake a
 * step (that swings the low-held can and reads as a fast flicker); the only mirror is the per-facing
 * one in FACING_GAIT that turns each left-drawn facing (side + both diagonals) to its right twin.
 * The diagonals have no separate idle, so their first contact doubles as the standing pose. */
type GaitId = "down" | "up" | "side" | "down-diag" | "up-diag";
const GAIT: Record<GaitId, Gait> = {
    down: {
        walk: [pose(G.walkDownA), pose(G.walkDownB), pose(G.walkDownC), pose(G.walkDownD)],
        idle: pose(G.idleDown),
    },
    up: {
        walk: [pose(G.walkUpA), pose(G.walkUpB), pose(G.walkUpC), pose(G.walkUpD)],
        idle: pose(G.idleUp),
    },
    side: {
        walk: [pose(G.walkSideA), pose(G.walkSideB), pose(G.walkSideC), pose(G.walkSideD)],
        idle: pose(G.idleSide),
    },
    "down-diag": {
        walk: [pose(G.walkDownLeftA), pose(G.walkDownLeftB), pose(G.walkDownLeftC), pose(G.walkDownLeftD)],
        idle: pose(G.walkDownLeftA),
    },
    "up-diag": {
        walk: [pose(G.walkUpLeftA), pose(G.walkUpLeftB), pose(G.walkUpLeftC), pose(G.walkUpLeftD)],
        idle: pose(G.walkUpLeftA),
    },
};

/** Each of the eight facings → which gait to draw and whether the whole sprite is mirrored. The
 * side and diagonal art is drawn facing LEFT, so the rightward facings set flip. Every diagonal now
 * has its OWN three-quarter art (so NW ≠ W): south-west/north-west use the left diagonal gaits,
 * south-east/north-east use the same art mirrored. */
const FACING_GAIT: Record<Dir8, { gait: GaitId; flip: boolean }> = {
    "down": { gait: "down", flip: false },
    "up": { gait: "up", flip: false },
    "left": { gait: "side", flip: false },
    "right": { gait: "side", flip: true },
    "down-left": { gait: "down-diag", flip: false },
    "down-right": { gait: "down-diag", flip: true },
    "up-left": { gait: "up-diag", flip: false },
    "up-right": { gait: "up-diag", flip: true },
};

/** Walk playback speed, in poses per second (frame-rate independent via the phase clock). */
const WALK_FPS = 8;

export class WorldScene extends Phaser.Scene {
    private bus!: TypedBus;
    private plan!: WorldPlan;
    private snapshot: MasterySnapshot | null = null;
    private flags: GardenFlags = { paraphrase: {}, weeds: {} };
    private reducedMotion = false;
    private panelOpen = false;
    private mapOpen = false;

    private terrain: TerrainModel | null = null;
    private plants = new Map<string, PlantObject>();
    private stageByNode = new Map<string, GrowthStage>();
    /** Feet-level base boxes for every standing thing (bushes, trees, props, hedges,
     * structures, the Keeper) — realistic collision: block at the trunk, layer above it. */
    private solidBoxes: SolidBox[] = [];
    /** Ground flora (bone-meal watering): preset flowers that grow where you pour. */
    private flora: FloraLayer | null = null;
    private isMovingNow = false;

    private avatar!: Phaser.GameObjects.Sprite;
    private keeper!: Phaser.GameObjects.Image;
    private keeperLantern!: Phaser.GameObjects.Arc;
    /** The garden gnome: a wandering NPC that carries the day's encouragement in a bubble
     *  that grows from "…" to the full line as you approach. Null until the garden is real
     *  (spawned after the onboarding fog lifts). */
    private gardener: Gardener | null = null;
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private wasd!: {
        W: Phaser.Input.Keyboard.Key;
        A: Phaser.Input.Keyboard.Key;
        S: Phaser.Input.Keyboard.Key;
        D: Phaser.Input.Keyboard.Key;
    };
    private interactKey!: Phaser.Input.Keyboard.Key;
    private spaceKey!: Phaser.Input.Keyboard.Key;

    private interactPrompt!: Phaser.GameObjects.Text;
    private aimLabel!: Phaser.GameObjects.Text;
    private aimGlow!: Phaser.GameObjects.Ellipse;
    private aimGlowTween?: Phaser.Tweens.Tween;
    private nearTarget:
        | "plant"
        | "keeper"
        | "waystone"
        | "flavor"
        | "trial"
        | "island-return"
        | "island-stat"
        | null = null;
    private nearNodeId: string | null = null;
    private nearWaystoneId: string | null = null;
    private nearFlavorIdx: number | null = null;
    private nearTrialSection: string | null = null;
    private nearStatId: string | null = null;
    /** One standing stone at the heart of each quadrant — interact for a little rain. */
    private trialStones = new Map<string, Phaser.GameObjects.Image>();
    /** Ambient screen-effect weather (rain streaks / snow flecks; no clouds). */
    private weather: WeatherLayer | null = null;
    /** Absence-neglect ground layer: tufts creep around overdue plots (living decay). */
    private overgrowth: OvergrowthLayer | null = null;
    private critters: Array<{
        sprite: Phaser.GameObjects.Arc;
        kind: "shadowLoop" | "moteDrift";
        cx: number;
        cy: number;
        rx: number;
        ry: number;
        speed: number;
        phase: number;
        nightOnly: boolean;
    }> = [];
    private isNight = false;

    private skyOverlay!: Phaser.GameObjects.Rectangle;
    /** The onboarding shroud bands; empty once lifted (or never drawn when placement is done). */
    private fogSprites: Phaser.GameObjects.Image[] = [];
    private fogOrigin = { x: 0, y: 0 };
    private fogClock = 0;
    /** While true the avatar is leashed to the plaza (no wandering blind into the mist). */
    private fogActive = false;
    private lanternGlows: Phaser.GameObjects.Arc[] = [];
    private tendMarker: Phaser.GameObjects.Arc | null = null;
    private unsubscribers: Array<() => void> = [];

    /** The Overlook (Super Depth Analysis): built + painted lazily on first entry. */
    private islandPlan: IslandPlan | null = null;
    private islandActive = false;
    /** Where the avatar stood before departing — the exit lands back here. */
    private islandReturnTile: { tileX: number; tileY: number } | null = null;
    /** Monument value/label texts by stat id — refreshed with every new snapshot. */
    private islandTexts = new Map<string, Phaser.GameObjects.Text>();
    private islandStats: DepthStats | null = null;

    private avatarTile = { tileX: KEEPER_TILE.tileX + 2, tileY: KEEPER_TILE.tileY };
    /** The garden the avatar last stood in — drives the region-adaptive lofi score. */
    private currentRegion: string | null = null;
    private tendNextTile: { tileX: number; tileY: number } | null = null;
    private facing: Dir8 = "down";
    /** Smooth, frame-rate-independent walk clock (advances in "poses"; drives frame + bob). */
    private walkPhase = 0;

    constructor() {
        super("world");
    }

    create(): void {
        this.bus = this.registry.get("bus") as TypedBus;
        this.snapshot = this.registry.get("masterySnapshot") as MasterySnapshot | undefined ?? null;
        this.flags = this.registry.get("gardenFlags") as GardenFlags ?? { paraphrase: {}, weeds: {} };
        this.reducedMotion = this.registry.get("reducedMotion") as boolean ?? false;
        this.panelOpen = this.registry.get("panelOpen") as boolean ?? false;
        // The map keeps the keyboard (Esc/M live there) — so the world must gate its own
        // tending verbs while the map covers it, or Space waters unseen behind the overlay.
        this.unsubscribers.push(
            this.bus.on("map:visible", ({ open }) => {
                this.mapOpen = open;
            }),
        );

        this.plan = buildWorldPlan();
        this.rebuildStageMap();

        // The Overlook rebuilds lazily per scene life (its sprites/boxes die with the
        // scene; the painted texture itself is game-global and reattaches on entry).
        this.islandPlan = null;
        this.islandActive = false;
        this.islandReturnTile = null;
        this.islandTexts.clear();
        this.islandStats = null;

        const ts = DISPLAY.tile;
        const worldW = this.plan.widthTiles * ts;
        const worldH = this.plan.heightTiles * ts;

        this.cameras.main.setBounds(0, 0, worldW, worldH);
        // Compact overworld: a lower zoom reveals more of the island so it reads as
        // ~2 screens across (Champions-Island feel) while sprites stay chunky. Zoom
        // tracks the viewport (Scale.RESIZE) so fullscreen never shows the whole map.
        this.applyCameraZoom();
        const onResize = (): void => this.applyCameraZoom();
        this.scale.on("resize", onResize);
        this.unsubscribers.push(() => this.scale.off("resize", onResize));

        this.renderGround();
        this.renderDecor();
        this.renderFlora();
        this.renderPropsAndPlants();
        this.renderSectorStones();
        this.spawnLanternGlows();
        this.spawnCritters();
        this.setupAvatarTextures();
        this.spawnAvatar();
        this.spawnKeeper();
        this.setupInput();
        this.setupSky();
        this.setupFog();
        this.spawnGardener();
        this.weather = new WeatherLayer(this, this.reducedMotion);
        this.overgrowth = new OvergrowthLayer(this, this.reducedMotion);
        this.syncOvergrowth();
        this.setupBus();
        this.updateTendMarker();

        if (!this.snapshot || this.snapshot.topics.length === 0) {
            this.add.text(
                KEEPER_TILE.tileX * ts + ts,
                KEEPER_TILE.tileY * ts - ts * 2,
                "The garden awaits engine truth…",
                { fontFamily: "monospace", fontSize: "10px", color: "#e8f0e2", backgroundColor: "#1a2b1eaa" },
            ).setOrigin(0.5);
        }

        this.interactPrompt = this.add.text(0, 0, "E / Space", {
            fontFamily: "monospace",
            fontSize: "9px",
            color: "#ffe066",
            backgroundColor: "#1a2b1eaa",
            padding: { x: 3, y: 2 },
        }).setOrigin(0.5, 1).setVisible(false).setDepth(9000);

        // Aim indicator: a soft glow on the plot the watering can targets, plus a
        // floating label naming that plot's MCAT concept and its due/new count.
        // Presentation-only — same target as the water action (single source of truth).
        // fillAlpha (not transform alpha) is what the pulse tween animates below, so it's set
        // here as the base/static value; depth is assigned per-frame (tile-relative) so the glow
        // sits just in front of the aimed plant instead of behind its opaque sprite.
        this.aimGlow = this.add.ellipse(0, 0, DISPLAY.tile * 1.3, DISPLAY.tile * 0.7, 0xffe066, 0.5)
            .setVisible(false);
        this.aimLabel = this.add.text(0, 0, "", {
            fontFamily: "monospace",
            fontSize: "9px",
            color: "#ffe066",
            backgroundColor: "#1a2b1eaa",
            padding: { x: 3, y: 2 },
        }).setOrigin(0.5, 1).setVisible(false).setDepth(9000);

        this.scene.launch("map");
    }

    /**
     * Scale the camera zoom with the viewport so a bigger window (e.g. fullscreen)
     * shows the same slice of the world instead of revealing the entire map. "Cover"
     * the reference design size on both axes; never zoom out below the base zoom.
     */
    private applyCameraZoom(): void {
        const zoom = Math.max(
            BASE_ZOOM,
            (this.scale.width / REFERENCE_WIDTH) * BASE_ZOOM,
            (this.scale.height / REFERENCE_HEIGHT) * BASE_ZOOM,
        );
        this.cameras.main.setZoom(zoom);
    }

    shutdown(): void {
        for (const off of this.unsubscribers) {
            off();
        }
        this.unsubscribers = [];
        this.flora?.destroy();
        this.flora = null;
        this.weather?.destroy();
        this.weather = null;
        this.overgrowth?.destroy();
        this.overgrowth = null;
        this.gardener?.destroy();
        this.gardener = null;
    }

    /** Map overlay reads avatar position. */
    getAvatarTile(): { tileX: number; tileY: number } {
        return this.avatarTile;
    }

    getTendNextTile(): { tileX: number; tileY: number } | null {
        return this.tendNextTile;
    }

    /**
     * Map click-to-teleport validity (doc 23 §6.4 "pick a spot and drop in"): the tile
     * must be open GRASS — not water/shore/path/plaza, and the landing feet must not
     * intersect any solid base box (trunks, hedges, structures, the world rim).
     */
    canDropAt(tileX: number, tileY: number): boolean {
        if (!this.terrain) {
            return false;
        }
        if (
            tileX < 0 || tileY < 0
            || tileX >= this.plan.widthTiles || tileY >= this.plan.heightTiles
        ) {
            return false;
        }
        const ts = DISPLAY.tile;
        const cx = tileX * ts + ts / 2;
        if (terrainKindAt(this.terrain, cx, tileY * ts + ts / 2) !== "grass") {
            return false;
        }
        return !this.footBlocked(cx, tileY * ts + ts);
    }

    /** Drop the avatar onto a grass tile (map click). Returns false when the landing is
     * invalid — the caller decides how to surface the denial. */
    teleportToTile(tileX: number, tileY: number): boolean {
        if (!this.avatar || !this.canDropAt(tileX, tileY)) {
            return false;
        }
        const ts = DISPLAY.tile;
        this.avatar.setPosition(tileX * ts + ts / 2, tileY * ts + ts);
        this.avatarTile = { tileX, tileY };
        this.fxDropIn(this.avatar.x, this.avatar.y);
        return true;
    }

    /** A soft landing ring + a few dust motes where the avatar drops in. */
    private fxDropIn(x: number, y: number): void {
        if (this.reducedMotion) {
            return;
        }
        const ring = this.add.circle(x, y - 4, 7, 0xf2f2e4, 0.5);
        ring.setDepth(y / DISPLAY.tile + 0.5);
        this.tweens.add({
            targets: ring,
            scale: 3,
            alpha: 0,
            duration: 460,
            ease: "Cubic.easeOut",
            onComplete: () => ring.destroy(),
        });
        const dust = this.add.particles(x, y - 6, ensureTexture(this, pickFirstAsset(["fx-dust-04", "fx-droplet"])), {
            speed: { min: 20, max: 55 },
            angle: { min: 180, max: 360 },
            lifespan: 420,
            quantity: 8,
            scale: { start: 0.5, end: 0 },
            emitting: false,
        });
        dust.setDepth(8500);
        dust.explode();
        this.time.delayedCall(520, () => dust.destroy());
    }

    update(time: number, delta: number): void {
        this.panelOpen = this.registry.get("panelOpen") as boolean ?? false;
        this.flags = this.registry.get("gardenFlags") as GardenFlags ?? this.flags;

        this.moveAvatar(delta);
        this.updateInteractPrompt();
        this.emitRegionIfChanged();
        this.bobKeeper(delta);
        if (this.avatar) {
            this.gardener?.update(this.avatar.x, this.avatar.y, delta);
        }
        this.updateCritters();
        this.tickFog(delta);
        // The living wind: grown flowers sway as one field; completed lines host gusts.
        this.flora?.tick(time);
        // Ambient weather: screen-space rain/snow spells (plus stone-blessed bursts).
        this.weather?.tick(time);
        // Walking through grown flowers rustles them (cooldown-guarded, cheap).
        if (this.isMovingNow && this.flora && this.avatar) {
            this.flora.rustle(this.avatar.x, this.avatar.y);
        }
    }

    private rebuildStageMap(): void {
        this.stageByNode.clear();
        if (!this.snapshot) {
            return;
        }
        for (const topic of this.snapshot.topics) {
            const paraphrasePassed = (this.flags.paraphrase[topic.nodeId] ?? 0) > 0;
            const hasActiveWeed = this.flags.weeds[topic.nodeId] ?? false;
            this.stageByNode.set(
                topic.nodeId,
                stageFor({ topic, paraphrasePassed, hasActiveWeed }),
            );
        }
    }

    private topicForNode(nodeId: string): TopicMastery | undefined {
        return this.snapshot?.byNode.get(nodeId);
    }

    private renderGround(): void {
        // One painted organic surface (noise grass, wavy borders, winding paths,
        // shorelined water) instead of a per-tile checkerboard — no visible grid.
        this.terrain = buildTerrainModel(this.plan);
        paintGround(this, this.plan, this.terrain);
    }

    /** The preset ground flora: every grass tile's flower, restored from persisted pours. */
    private renderFlora(): void {
        if (!this.terrain) {
            return;
        }
        const counts = this.registry.get("floraState") as Record<string, number> | undefined;
        // Landmark anchors give the mass-bloom ambience something to reach toward
        // (CARS root-veins → the Supertrees; C-P could target the fountain later).
        const anchors: Partial<Record<GardenSection, TileCoord>> = {};
        for (const r of this.plan.regions) {
            const landmark = r.props.find((p) => p.key.startsWith("struct-landmark-"));
            if (landmark) {
                anchors[r.section] = { tileX: landmark.tileX, tileY: landmark.tileY };
            }
        }
        this.flora = new FloraLayer(
            this,
            planFlora(this.plan, this.terrain),
            counts ?? {},
            this.reducedMotion,
            () => true,
            anchors,
        );
    }

    /** Deterministic foliage scatter — trees/bushes clustered by species. Every standing
     * item gets a feet-level base box: block at the trunk, walk behind the canopy. */
    private renderDecor(): void {
        const ts = DISPLAY.tile;
        if (!this.terrain) {
            return;
        }
        for (const d of planDecor(this.plan, this.terrain)) {
            const img = this.add.image(d.x, d.y, ensureTexture(this, d.key));
            img.setOrigin(0.5, 1);
            sizeToHeightTiles(img, d.hTiles);
            img.setFlipX(d.flip);
            img.setDepth(d.flat ? -5 : d.y / ts);
            if (!d.flat) {
                this.solidBoxes.push(
                    baseBoxFor(img.x, img.y, img.displayWidth, {
                        // Hedges are WALLS (wide, taller box); ordinary foliage blocks only
                        // at a narrow trunk so brushing past feels natural.
                        widthFactor: d.key === "foliage-versailles-20" ? 0.92 : 0.45,
                        heightPx: d.key === "foliage-versailles-20" ? 20 : 12,
                    }),
                );
            }
        }
    }

    private renderPropsAndPlants(): void {
        const ts = DISPLAY.tile;

        for (const r of this.plan.regions) {
            for (const p of r.props) {
                const key = ensureTexture(this, p.key);
                const img = this.add.image(p.tileX * ts + ts / 2, p.tileY * ts + ts, key);
                img.setOrigin(0.5, 1);
                if (p.hTiles) {
                    sizeToHeightTiles(img, p.hTiles);
                } else {
                    applyDisplaySize(img);
                }
                img.setDepth(img.y / ts);
                // Big landmarks block wider at the base (you still walk BEHIND them —
                // "go behind but not through"); small props block a narrow trunk.
                const landmark = p.key.startsWith("struct-");
                this.solidBoxes.push(
                    baseBoxFor(img.x, img.y, img.displayWidth, {
                        widthFactor: landmark ? 0.6 : 0.45,
                        heightPx: landmark ? 16 : 12,
                        maxWidthPx: landmark ? 110 : 72,
                    }),
                );
            }
            // Region waystone (fast-travel marker).
            const wsKey = hasAssetKey("struct-waystone-dormant")
                ? "struct-waystone-dormant"
                : "struct-waystone";
            const ws = this.add.image(
                r.waystone.tileX * ts + ts / 2,
                r.waystone.tileY * ts + ts,
                ensureTexture(this, wsKey),
            );
            ws.setOrigin(0.5, 1);
            applyDisplaySize(ws);
            ws.setDepth(ws.y / ts);
            this.solidBoxes.push(baseBoxFor(ws.x, ws.y, ws.displayWidth, { heightPx: 10 }));

            // Plots render NOTHING until they have real engine state (2026-07-03: no more
            // soil holes/beds — you water the grass and the region's preset flower appears
            // there, growing with real mastery). The invisible sprite keeps the spot alive
            // for watering/growth targeting. Plants never collide — you tend right up to them.
            const theme = regionThemeFromSection(r.section);
            for (const spot of r.plants) {
                const stage = this.stageByNode.get(spot.nodeId) ?? "bare-soil";
                const key = ensureTexture(this, stageTextureKey(stage, theme));
                const spr = this.add.image(spot.tileX * ts + ts / 2, spot.tileY * ts + ts, key);
                spr.setOrigin(0.5, 1);
                applyDisplaySize(spr);
                spr.setDepth(spr.y / ts);
                spr.setVisible(stage !== "bare-soil");
                const topic = this.topicForNode(spot.nodeId);
                applyWilt(spr, stage === "drooping" && topic ? wiltLevelFor(topic) : null);
                this.plants.set(spot.nodeId, { nodeId: spot.nodeId, sprite: spr, spot, theme });
            }
        }
    }

    /** A standing stone at the heart of each quadrant. No lock, no veil — walk up and
     * interact and it blesses the garden with a brief shower of rain. */
    private renderSectorStones(): void {
        const ts = DISPLAY.tile;
        for (const r of this.plan.regions) {
            const center = {
                tileX: r.rect.x + Math.floor(r.rect.w / 2),
                tileY: r.rect.y + Math.floor(r.rect.h / 2),
            };
            // If the exact center is water (lagoons/ponds), spiral out to dry ground.
            outer:
            for (let radius = 1; radius <= 6 && waterIsSolid(this.plan, center.tileX, center.tileY); radius++) {
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const tx = r.rect.x + Math.floor(r.rect.w / 2) + dx;
                        const ty = r.rect.y + Math.floor(r.rect.h / 2) + dy;
                        if (!waterIsSolid(this.plan, tx, ty)) {
                            center.tileX = tx;
                            center.tileY = ty;
                            break outer;
                        }
                    }
                }
            }
            const sx = center.tileX * ts + ts / 2;
            const sy = center.tileY * ts + ts;
            const stoneKey = pickFirstAsset(["struct-waystone-active", "struct-waystone-dormant"]);
            const stone = this.add.image(sx, sy, ensureTexture(this, stoneKey));
            stone.setOrigin(0.5, 1);
            sizeToHeightTiles(stone, 2.2);
            stone.setDepth(stone.y / ts);
            this.solidBoxes.push(baseBoxFor(stone.x, stone.y, stone.displayWidth, { heightPx: 10 }));
            this.trialStones.set(r.section, stone);
        }
    }

    private restagePlants(): void {
        this.rebuildStageMap();
        for (const [nodeId, plant] of this.plants) {
            const stage = this.stageByNode.get(nodeId) ?? "bare-soil";
            plant.sprite.setTexture(ensureTexture(this, stageTextureKey(stage, plant.theme)));
            applyDisplaySize(plant.sprite);
            plant.sprite.setVisible(stage !== "bare-soil");
            const topic = this.topicForNode(nodeId);
            applyWilt(plant.sprite, stage === "drooping" && topic ? wiltLevelFor(topic) : null);
        }
        this.updateTendMarker();
    }

    /** Recompute the neglect layer from engine truth (boot + every mastery:refreshed). */
    private syncOvergrowth(): void {
        if (!this.overgrowth) {
            return;
        }
        const daysAway = this.registry.get("daysAway") as number ?? 0;
        const items: OvergrowthPlotInput[] = [];
        for (const r of this.plan.regions) {
            for (const spot of r.plants) {
                items.push({
                    nodeId: spot.nodeId,
                    tileX: spot.tileX,
                    tileY: spot.tileY,
                    stage: this.stageByNode.get(spot.nodeId) ?? "bare-soil",
                    dueCount: this.topicForNode(spot.nodeId)?.dueCount ?? 0,
                });
            }
        }
        this.overgrowth.sync(items, daysAway);
    }

    private spawnAvatar(): void {
        const ts = DISPLAY.tile;
        const sx = (KEEPER_TILE.tileX + 2) * ts + ts / 2;
        const sy = KEEPER_TILE.tileY * ts + ts;
        // A plain sprite: movement + collision are ours (feet-box slide in moveAvatar),
        // not arcade physics — that's what makes behind/in-front layering honest.
        this.avatar = this.add.sprite(sx, sy, ensureTexture(this, G.idleDown));
        this.avatar.setOrigin(0.5, 1);
        this.refreshAvatarView();
        this.avatar.setDepth(this.avatar.y / ts);
        this.cameras.main.startFollow(this.avatar, true, 0.12, 0.12);
        this.avatarTile = { tileX: KEEPER_TILE.tileX + 2, tileY: KEEPER_TILE.tileY };
    }

    /** Would the avatar's FEET at (x, y) collide? World rim, water (minus fords),
     * and every standing thing's base box. */
    private footBlocked(x: number, y: number): boolean {
        const ts = DISPLAY.tile;
        // The Overlook floats OUTSIDE the plan rect: inside its sky rect the island's
        // own walkable set is the floor (the sky is not), then base boxes still apply.
        // Everything else beyond the plan rect stays blocked by the world rim below.
        if (this.islandPlan && islandContainsPoint(this.islandPlan, x, y)) {
            if (islandFootBlocked(this.islandPlan, x, y)) {
                return true;
            }
            const islandFoot = footBoxAt(x, y);
            for (const box of this.solidBoxes) {
                if (boxesOverlap(islandFoot, box)) {
                    return true;
                }
            }
            return false;
        }
        const worldW = this.plan.widthTiles * ts;
        const worldH = this.plan.heightTiles * ts;
        if (x < 10 || x > worldW - 10 || y < ts * 0.9 || y > worldH - 2) {
            return true;
        }
        const foot = footBoxAt(x, y);
        // Probe the foot box's corners against tile-level terrain (the box is ≪ tile size).
        const corners = [
            { px: foot.left, py: foot.top },
            { px: foot.left + foot.w, py: foot.top },
            { px: foot.left, py: foot.top + foot.h },
            { px: foot.left + foot.w, py: foot.top + foot.h },
        ];
        for (const c of corners) {
            const tx = Math.floor(c.px / ts);
            const ty = Math.floor(c.py / ts);
            if (waterIsSolid(this.plan, tx, ty)) {
                return true;
            }
        }
        for (const box of this.solidBoxes) {
            if (boxesOverlap(foot, box)) {
                return true;
            }
        }
        return false;
    }

    private spawnLanternGlows(): void {
        const ts = DISPLAY.tile;
        for (const r of this.plan.regions) {
            for (const p of r.props) {
                if (!p.key.includes("lantern") && !p.key.includes("glow")) {
                    continue;
                }
                const glow = this.add.circle(
                    p.tileX * ts + ts / 2,
                    p.tileY * ts + ts / 2 - 8,
                    10,
                    0xffe066,
                    0.25,
                );
                glow.setDepth(p.tileY + 0.7);
                glow.setVisible(false);
                this.lanternGlows.push(glow);
            }
        }
    }

    /** Deterministic ambient life: koi/duck shadow-loops and drifting bee/firefly motes
     * (docs/sectors/*). Pure timers off this.time.now — no runtime RNG, so the world stays
     * reproducible. Reduced-motion leaves them static (no per-frame movement). */
    private spawnCritters(): void {
        const ts = DISPLAY.tile;
        for (const r of this.plan.regions) {
            const layout = sectorFor(r.section)?.critters;
            if (!layout) {
                continue;
            }
            for (const c of layout) {
                for (let i = 0; i < c.count; i++) {
                    const phase = (i / c.count) * Math.PI * 2;
                    const isMote = c.kind === "moteDrift";
                    const radius = isMote ? 3 : 6;
                    const alpha = isMote ? 0.55 : 0.32;
                    const sprite = this.add.circle(
                        (c.cx + 0.5) * ts,
                        (c.cy + 0.5) * ts,
                        radius,
                        c.tint,
                        alpha,
                    );
                    sprite.setDepth(isMote ? 8400 : c.cy + 0.45);
                    if (isMote) {
                        sprite.setScale(1, 0.6);
                    } else {
                        sprite.setScale(1.6, 0.7);
                    }
                    this.critters.push({
                        sprite,
                        kind: c.kind,
                        cx: c.cx,
                        cy: c.cy,
                        rx: c.rx,
                        ry: c.ry,
                        speed: c.speed,
                        phase,
                        nightOnly: Boolean(c.nightOnly),
                    });
                }
            }
        }
    }

    private updateCritters(): void {
        if (this.reducedMotion || this.critters.length === 0) {
            return;
        }
        const ts = DISPLAY.tile;
        const t = this.time.now / 1000;
        for (const c of this.critters) {
            if (c.nightOnly && !this.isNight) {
                c.sprite.setVisible(false);
                continue;
            }
            c.sprite.setVisible(true);
            if (c.kind === "shadowLoop") {
                // Circle an ellipse (koi in a pond, ducks tracing a canal line).
                const a = t * c.speed + c.phase;
                c.sprite.x = (c.cx + 0.5 + Math.cos(a) * c.rx) * ts;
                c.sprite.y = (c.cy + 0.5 + Math.sin(a) * c.ry) * ts;
            } else {
                // Drift a slow figure-eight between the two anchors (bees/fireflies).
                const u = (t / c.speed) * Math.PI * 2 + c.phase;
                const midX = (c.cx + c.rx) / 2;
                const midY = (c.cy + c.ry) / 2;
                const spanX = (c.rx - c.cx) / 2;
                const spanY = (c.ry - c.cy) / 2;
                c.sprite.x = (midX + 0.5 + Math.sin(u) * spanX) * ts;
                c.sprite.y = (midY + 0.5 + Math.sin(u * 2) * spanY * 0.5) * ts;
            }
        }
    }

    private spawnKeeper(): void {
        const ts = DISPLAY.tile;
        const kx = KEEPER_TILE.tileX * ts + ts / 2;
        const ky = KEEPER_TILE.tileY * ts + ts;

        // ONE centerpiece at the center of everything (2026-07-03): the gazebo shrine rises
        // directly behind the Keeper on the plaza axis — nothing else competes with it.
        if (hasAssetKey("struct-gazebo")) {
            const gz = this.add.image(kx, ky - 1.6 * ts, ensureTexture(this, "struct-gazebo"));
            gz.setOrigin(0.5, 1);
            sizeToHeightTiles(gz, 4.6);
            gz.setDepth(gz.y / ts);
            this.solidBoxes.push(
                baseBoxFor(gz.x, gz.y, gz.displayWidth, {
                    widthFactor: 0.7,
                    heightPx: 18,
                    maxWidthPx: 120,
                }),
            );
        }
        // The Keeper is a MONK — the meditating sage, not a gardener (2026-07-03).
        const keeperKey = pickFirstAsset(["keeper-meditating", "keeper-gardener"]);
        this.keeper = this.add.image(kx, ky, ensureTexture(this, keeperKey));
        this.keeper.setOrigin(0.5, 1);
        sizeToHeightTiles(this.keeper, 2.2);
        this.keeper.setDepth(this.keeper.y / ts);
        this.solidBoxes.push(
            baseBoxFor(kx, ky, this.keeper.displayWidth, { widthFactor: 0.55, heightPx: 14 }),
        );

        this.keeperLantern = this.add.circle(kx + 20, ky - 40, 8, 0xffe066, 0.5);
        this.keeperLantern.setDepth(KEEPER_TILE.tileY + 0.76);
    }

    private bobKeeper(_delta: number): void {
        if (this.reducedMotion || !this.keeper) {
            return;
        }
        const t = this.time.now / 1000;
        this.keeper.y = KEEPER_TILE.tileY * DISPLAY.tile + DISPLAY.tile + Math.sin(t * 2) * 2;
    }

    /** Spawn the wandering gnome at a random, discoverable grass tile — but only once the
     *  garden is real (after the onboarding fog lifts; while it holds, only the non-grass
     *  plaza is reachable, so there's nowhere honest to stand). Idempotent. */
    private spawnGardener(): void {
        if (this.gardener || this.fogActive) {
            return;
        }
        const spot = this.pickGardenerTile();
        if (!spot) {
            return;
        }
        this.gardener = new Gardener(this, spot.tileX, spot.tileY, this.reducedMotion);
        // The insight may have arrived on the bus before the gnome existed — apply it.
        const pending = this.registry.get("gardenerInsight") as string | undefined;
        if (pending) {
            this.gardener.setText(pending);
        }
    }

    /** A random open grass tile a short walk from where the avatar starts (so the "…"→text
     *  reveal has room to play), validated exactly like a map drop — grass, in-bounds, not
     *  blocked. Null if none found in a bounded number of tries (the gnome simply skips). */
    private pickGardenerTile(): TileCoord | null {
        const spawn = this.avatarTile;
        for (let i = 0; i < 80; i++) {
            const tileX = Math.floor(Math.random() * this.plan.widthTiles);
            const tileY = Math.floor(Math.random() * this.plan.heightTiles);
            if (!this.canDropAt(tileX, tileY)) {
                continue;
            }
            if (this.distTiles(tileX + 0.5, tileY + 0.5, spawn.tileX + 0.5, spawn.tileY + 0.5) < 5) {
                continue;
            }
            return { tileX, tileY };
        }
        return null;
    }

    private setupInput(): void {
        if (!this.input.keyboard) {
            return;
        }
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = {
            W: this.input.keyboard.addKey("W"),
            A: this.input.keyboard.addKey("A"),
            S: this.input.keyboard.addKey("S"),
            D: this.input.keyboard.addKey("D"),
        };
        this.interactKey = this.input.keyboard.addKey("E");
        this.spaceKey = this.input.keyboard.addKey("SPACE");

        // M toggles the map overlay. It lives HERE, not in the map scene: the world stays
        // active under the overlay (so one binding serves open AND close), while the hidden
        // map scene is inactive and its keyboard plugin never sees the key.
        this.input.keyboard.addKey("M").on("down", () => {
            // No map while the island sleeps under the placement fog, and none from the
            // Overlook — the map miniature only knows the garden below.
            if (!this.panelOpen && !this.fogActive && !this.islandActive) {
                this.bus.emit("map:toggle", {});
            }
        });

        this.interactKey.on("down", () => this.tryInteract());
        // Space is the tending verb (docs 2026-07-03): near a person/marker it interacts
        // (talk to the Keeper, use a waystone); on open ground it WATERS where you stand
        // and the garden wakes there. Planting seeds is gone — you water the ground itself.
        this.spaceKey.on("down", () => {
            if (this.panelOpen || this.mapOpen) {
                return;
            }
            if (
                this.nearTarget === "keeper" || this.nearTarget === "waystone"
                || this.nearTarget === "flavor" || this.nearTarget === "trial"
                || this.nearTarget === "island-return" || this.nearTarget === "island-stat"
            ) {
                this.tryInteract();
            } else if (!this.islandActive) {
                // No watering on the Overlook: pours are a garden verb (a sky pour would
                // write flora counts for out-of-world tiles and feed the tutorial).
                this.waterGround();
            }
        });
    }

    /** The tile the watering can POINTS at: one tile ahead of the avatar's facing. */
    private aimTile(): TileCoord {
        const ahead: Record<Dir8, [number, number]> = {
            "down": [0, 1],
            "up": [0, -1],
            "left": [-1, 0],
            "right": [1, 0],
            "down-left": [-1, 1],
            "down-right": [1, 1],
            "up-left": [-1, -1],
            "up-right": [1, -1],
        };
        const [dx, dy] = ahead[this.facing];
        return { tileX: this.avatarTile.tileX + dx, tileY: this.avatarTile.tileY + dy };
    }

    /** Water where the can points: a request to the panel layer (which owns the water
     * ledger) to spend a pour; on success it answers with `flora:water` and the ground
     * flora grows at the splash (aim +2, ring +1). The nearest plot still queues. */
    private waterGround(): void {
        if (!this.avatar) {
            return;
        }
        const nodeId = this.nearestPlot(6)?.nodeId ?? null;
        const aim = this.aimTile();
        this.bus.emit("ground:watered", {
            x: this.avatar.x,
            y: this.avatar.y - DISPLAY.tile * 0.5,
            nodeId,
            aimTileX: aim.tileX,
            aimTileY: aim.tileY,
        });
        const ts = DISPLAY.tile;
        this.fxGroundWater(aim.tileX * ts + ts / 2, (aim.tileY + 1) * ts);
    }

    /** The nearest plot within `maxTiles` of the avatar (or null on open ground).
     * Returns the plot itself so callers can both queue its concept (water) and
     * anchor the aim indicator to its tile. */
    private nearestPlot(maxTiles: number): { nodeId: string; spot: PlantSpot } | null {
        const ax = this.avatarTile.tileX + 0.5;
        const ay = this.avatarTile.tileY + 0.5;
        let best: { nodeId: string; spot: PlantSpot } | null = null;
        let bestD = maxTiles;
        for (const [, plant] of this.plants) {
            const d = this.distTiles(ax, ay, plant.spot.tileX + 0.5, plant.spot.tileY + 0.5);
            if (d < bestD) {
                bestD = d;
                best = { nodeId: plant.nodeId, spot: plant.spot };
            }
        }
        return best;
    }

    /** A ring of droplets + a soft green "wake" pulse where the player pours. Cosmetic only —
     * real growth still comes from graded reviews (I4); this just makes tending feel alive. */
    private fxGroundWater(x: number, y: number): void {
        if (this.reducedMotion) {
            return;
        }
        const drops = this.add.particles(x, y - DISPLAY.tile * 0.4, ensureTexture(this, "fx-droplet"), {
            speed: { min: 30, max: 70 },
            angle: { min: 200, max: 340 },
            lifespan: 480,
            quantity: 10,
            scale: { start: 0.5, end: 0 },
            gravityY: 120,
            tint: 0x6ec5ff,
        });
        drops.setDepth(8500);
        this.time.delayedCall(560, () => drops.destroy());
        const pulse = this.add.circle(x, y - 4, 8, 0x8fdc72, 0.4);
        pulse.setDepth(y / DISPLAY.tile + 0.4);
        this.tweens.add({
            targets: pulse,
            scale: 4,
            alpha: 0,
            duration: 620,
            ease: "Cubic.easeOut",
            onComplete: () => pulse.destroy(),
        });
    }

    private moveAvatar(delta: number): void {
        if (!this.avatar) {
            return;
        }
        const speed = 96;
        let dx = 0;
        let dy = 0;
        if (this.cursors.left.isDown || this.wasd.A.isDown) {
            dx = -1;
        } else if (this.cursors.right.isDown || this.wasd.D.isDown) {
            dx = 1;
        }
        if (this.cursors.up.isDown || this.wasd.W.isDown) {
            dy = -1;
        } else if (this.cursors.down.isDown || this.wasd.S.isDown) {
            dy = 1;
        }

        const moving = dx !== 0 || dy !== 0;
        this.isMovingNow = moving;
        if (moving) {
            // Normalise so diagonals aren't ~40% faster, integrate by real frame time,
            // then slide: X and Y resolve independently against the feet-box world, so
            // pushing into a bush glides you along it instead of pinning you.
            const inv = 1 / Math.hypot(dx, dy);
            const stepX = dx * speed * inv * (delta / 1000);
            const stepY = dy * speed * inv * (delta / 1000);
            const next = moveWithSlide(
                this.avatar.x,
                this.avatar.y,
                stepX,
                stepY,
                (x, y) => this.footBlocked(x, y),
            );
            this.avatar.setPosition(next.x, next.y);
            if (this.fogActive) {
                // The plaza leash: while the island sleeps under the mist you cannot
                // wander blind into it — the placement test is the only way out.
                const leashed = clampFeetToTileRect(
                    this.avatar.x,
                    this.avatar.y,
                    CENTER_PLAZA,
                    DISPLAY.tile,
                );
                this.avatar.setPosition(leashed.x, leashed.y);
            }
        }

        this.avatarTile = {
            tileX: Math.floor(this.avatar.x / DISPLAY.tile),
            tileY: Math.floor((this.avatar.y - DISPLAY.tile * 0.5) / DISPLAY.tile),
        };

        this.updateAvatarFrame(dx, dy, moving, delta);
        this.refreshAvatarView();
        // Pixel-Y depth: south of a bush's base you draw over it, north of it the canopy
        // covers you — the same rule every standing sprite uses.
        this.avatar.setDepth(this.avatar.y / DISPLAY.tile);
    }

    /** Prepare the gardener's runtime textures — guarantee every authored frame exists (real art,
     * or a generated placeholder if art is missing). Every facing now ships four real walk frames,
     * so there are no runtime-synthesized contacts to fabricate. */
    private setupAvatarTextures(): void {
        for (const key of Object.values(G)) {
            ensureTexture(this, key);
        }
    }

    /** 8-direction walk/idle driver. Advances a smooth, frame-rate-independent step clock and
     * draws the current pose (texture + per-facing mirror); each facing has its own authored art. */
    private updateAvatarFrame(dx: number, dy: number, moving: boolean, delta: number): void {
        if (moving) {
            this.facing = facing8(dx, dy);
        }
        const fg = FACING_GAIT[this.facing];
        const gait = GAIT[fg.gait];
        let frame: Pose;
        if (moving) {
            this.walkPhase += (delta / 1000) * WALK_FPS;
            frame = gait.walk[Math.floor(this.walkPhase) % gait.walk.length];
        } else {
            this.walkPhase = 0;
            frame = gait.idle;
        }
        this.avatar.setTexture(ensureTexture(this, frame.key));
        // Mirror only to face the left-drawn side art rightward (a per-facing flag); walk frames
        // never self-mirror, so the held watering can never flips sides mid-stride.
        this.avatar.setFlipX(frame.flip !== fg.flip);
    }

    /** Size the avatar to a constant on-screen height with its native aspect preserved — the
     * sliced frames differ in pixel size, and the old code force-fit each into one 32×40 box,
     * making the character's proportions "pop" every frame. A gentle vertical bob, synced to
     * the step clock (highest at mid-stride), then gives the walk weight and smoothness. */
    private refreshAvatarView(): void {
        const frameH = this.avatar.frame.height;
        const scale = frameH > 0 ? DISPLAY.avatarHeight / frameH : 1;
        let bob = 1;
        if (!this.reducedMotion) {
            if (this.isMovingNow) {
                // The back view reads with a touch more vertical weight than the other facings.
                const amp = this.facing === "up" ? 0.06 : 0.045;
                bob = 1 + amp * Math.abs(Math.sin(this.walkPhase * Math.PI));
            } else {
                bob = 1 + 0.012 * Math.sin((this.time.now / 1000) * Math.PI * 1.2);
            }
        }
        this.avatar.setScale(scale, scale * bob);
    }

    private distTiles(ax: number, ay: number, bx: number, by: number): number {
        return Math.hypot(ax - bx, ay - by);
    }

    private updateInteractPrompt(): void {
        const ts = DISPLAY.tile;
        const ax = this.avatarTile.tileX + 0.5;
        const ay = this.avatarTile.tileY + 0.5;

        this.nearTarget = null;
        this.nearNodeId = null;
        this.nearWaystoneId = null;
        this.nearFlavorIdx = null;
        this.nearTrialSection = null;
        this.nearStatId = null;

        // On the Overlook only its own targets exist — the return stone home, and each
        // stat monument's walk-up detail line. The garden scans below never match up
        // here (everything they check lives inside the plan rect), so skip them.
        if (this.islandActive && this.islandPlan) {
            const rs = this.islandPlan.returnStone;
            if (this.distTiles(ax, ay, rs.tileX + 0.5, rs.tileY + 0.5) <= INTERACT_RADIUS + 0.5) {
                this.nearTarget = "island-return";
            } else {
                for (const spot of this.islandPlan.statSpots) {
                    if (this.distTiles(ax, ay, spot.tileX + 0.5, spot.tileY + 0.5) <= INTERACT_RADIUS) {
                        this.nearTarget = "island-stat";
                        this.nearStatId = spot.id;
                        break;
                    }
                }
            }
            if (this.nearTarget && !this.panelOpen && !this.mapOpen) {
                this.interactPrompt.setVisible(true);
                this.interactPrompt.setPosition(this.avatar.x, this.avatar.y - ts);
            } else {
                this.interactPrompt.setVisible(false);
            }
            this.updateAimIndicator();
            return;
        }

        // Sector stones (quadrant hearts) — interact for a brief blessing of rain.
        for (const [section, stone] of this.trialStones) {
            if (
                this.distTiles(ax, ay, stone.x / ts - 0.5 + 0.5, stone.y / ts - 1 + 0.5)
                    <= INTERACT_RADIUS + 0.7
            ) {
                this.nearTarget = "trial";
                this.nearTrialSection = section;
                break;
            }
        }

        // Keeper
        if (
            !this.nearTarget
            && this.distTiles(ax, ay, KEEPER_TILE.tileX + 0.5, KEEPER_TILE.tileY + 0.5)
                <= INTERACT_RADIUS
        ) {
            this.nearTarget = "keeper";
        }

        // Plants (only ones that have sprouted — invisible bare-soil spots aren't targets)
        if (!this.nearTarget) {
            for (const [, plant] of this.plants) {
                if (!plant.sprite.visible) {
                    continue;
                }
                const px = plant.spot.tileX + 0.5;
                const py = plant.spot.tileY + 0.5;
                if (this.distTiles(ax, ay, px, py) <= INTERACT_RADIUS) {
                    this.nearTarget = "plant";
                    this.nearNodeId = plant.nodeId;
                    break;
                }
            }
        }

        // Waystones
        if (!this.nearTarget) {
            for (const r of this.plan.regions) {
                const wx = r.waystone.tileX + 0.5;
                const wy = r.waystone.tileY + 0.5;
                if (this.distTiles(ax, ay, wx, wy) <= INTERACT_RADIUS) {
                    this.nearTarget = "waystone";
                    this.nearWaystoneId = r.section;
                    break;
                }
            }
        }

        // Landmark flavor interactions (walk-up Keeper-voiced lines tied to the geography).
        if (!this.nearTarget) {
            for (let i = 0; i < this.plan.interactions.length; i++) {
                const it = this.plan.interactions[i];
                const radius = it.radius ?? 1.6;
                if (this.distTiles(ax, ay, it.tileX + 0.5, it.tileY + 0.5) <= radius) {
                    this.nearTarget = "flavor";
                    this.nearFlavorIdx = i;
                    break;
                }
            }
        }

        if (this.nearTarget && !this.panelOpen && !this.mapOpen) {
            this.interactPrompt.setVisible(true);
            this.interactPrompt.setPosition(this.avatar.x, this.avatar.y - ts);
        } else {
            this.interactPrompt.setVisible(false);
        }

        this.updateAimIndicator();
    }

    /** Show a glow + concept label on the plot the watering can targets — but only
     * when Space would water it (open ground or standing by a plant, no panel/map open).
     * Same target as `waterGround`, so the label never lies about what watering queues. */
    private updateAimIndicator(): void {
        const canWater = !this.panelOpen && !this.mapOpen
            && (this.nearTarget === null || this.nearTarget === "plant");
        const aim = canWater ? this.nearestPlot(6) : null;
        if (!aim) {
            this.aimLabel.setVisible(false);
            this.aimGlow.setVisible(false);
            this.aimGlowTween?.stop();
            this.aimGlowTween = undefined;
            // Reset to base so the next show starts a clean pulse (the yoyo tween can stop
            // mid-cycle, leaving scale/fillAlpha at arbitrary values).
            this.aimGlow.setScale(1).setFillStyle(0xffe066, 0.5);
            return;
        }
        const ts = DISPLAY.tile;
        const cx = aim.spot.tileX * ts + ts / 2;
        const topY = aim.spot.tileY * ts;
        const topic = this.snapshot?.byNode.get(aim.nodeId);
        this.aimLabel.setText(aimLabelText(aim.nodeId, topic));
        this.aimLabel.setPosition(cx, topY - 2).setVisible(true);
        // Plant sprites are row-depth-sorted (~tileY + 1); sit just in front so the glow reads
        // over a sprouted plot's base rather than being swallowed by its opaque sprite.
        this.aimGlow.setPosition(cx, topY + ts).setDepth(aim.spot.tileY + 1.1).setVisible(true);
        if (!this.reducedMotion && !this.aimGlowTween) {
            this.aimGlowTween = this.tweens.add({
                targets: this.aimGlow,
                scaleX: 1.15,
                scaleY: 1.15,
                fillAlpha: 0.28,
                duration: 900,
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut",
            });
        }
    }

    /** Tell the score which garden we're in as the avatar crosses a border (cosmetic, read-only:
     * the music layer reacts like the sky does). Seam/plaza tiles keep the last garden playing. */
    private emitRegionIfChanged(): void {
        const section = sectionAtTile(this.plan, this.avatarTile.tileX, this.avatarTile.tileY);
        if (!section) {
            return;
        }
        const region = regionThemeFromSection(section);
        if (region !== this.currentRegion) {
            this.currentRegion = region;
            this.bus.emit("region:entered", { region });
        }
    }

    private tryInteract(): void {
        if (this.panelOpen || this.mapOpen || !this.nearTarget) {
            return;
        }
        switch (this.nearTarget) {
            case "plant":
                if (this.nearNodeId) {
                    this.bus.emit("plant:interact", { nodeId: this.nearNodeId });
                }
                break;
            case "keeper":
                this.bus.emit("keeper:interact", {});
                break;
            case "waystone":
                if (this.nearWaystoneId) {
                    this.bus.emit("map:travel", { waystoneId: this.nearWaystoneId });
                    this.teleportToWaystone(this.nearWaystoneId);
                }
                break;
            case "flavor":
                if (this.nearFlavorIdx !== null) {
                    const it = this.plan.interactions[this.nearFlavorIdx];
                    if (it) {
                        this.bus.emit("world:flavor", { title: it.title, line: it.line });
                    }
                }
                break;
            case "trial":
                if (this.nearTrialSection) {
                    // The stone opens that section's trial (a short MCQ exam). The panel
                    // layer runs the questions and pays the water reward; the world answers
                    // that payout with rain (see "trial:rewarded" in setupBus).
                    this.bus.emit("trial:interact", { section: this.nearTrialSection });
                }
                break;
            case "island-return":
                this.exitIsland();
                break;
            case "island-stat":
                if (this.nearStatId && this.islandStats) {
                    const stat = this.islandStats.stats.find((s) => s.id === this.nearStatId);
                    if (stat) {
                        this.bus.emit("world:flavor", { title: stat.label, line: stat.detail });
                    }
                }
                break;
            default: {
                const _exhaustive: never = this.nearTarget;
                return _exhaustive;
            }
        }
    }

    private teleportToWaystone(waystoneId: string): void {
        const region = this.plan.regions.find((r) => r.section === waystoneId);
        if (!region || !this.avatar) {
            return;
        }
        const ts = DISPLAY.tile;
        const ws = region.waystone;
        // Arrive SOUTH of the stone (never inside its base box), probing further south and
        // then NORTH (waystones on the last authored row — Versailles y=30 — have no legal
        // south landing: every candidate is past the world rim). If every candidate is
        // blocked we stay put: teleporting INTO geometry was the old softlock.
        const spot = firstOpenSpot(
            waystoneArrivalTiles(ws).map((t) => ({ x: t.tileX * ts + ts / 2, y: (t.tileY + 1) * ts })),
            (x, y) => this.footBlocked(x, y),
        );
        if (!spot) {
            return;
        }
        this.avatar.setPosition(spot.x, spot.y);
        this.avatarTile = {
            tileX: Math.floor(this.avatar.x / ts),
            tileY: Math.floor((this.avatar.y - ts * 0.5) / ts),
        };
    }

    /**
     * Super Depth Analysis: teleport to the Overlook (docs/superpowers/specs/
     * 2026-07-03-depth-analysis-island-design.md). The island is built + painted lazily
     * on first entry; camera bounds swap onto its fully painted sky rect with a hard cut
     * (centerOn), so the void between garden and island is never on screen. Landing is
     * validated with firstOpenSpot — all-blocked means stay put (the anti-softlock rule).
     */
    private enterIsland(stats: DepthStats): void {
        if (!this.avatar || this.fogActive) {
            return;
        }
        if (!this.islandPlan) {
            this.islandPlan = buildIslandPlan();
            paintIsland(this, this.islandPlan);
            this.spawnIslandProps(this.islandPlan);
        }
        this.islandStats = stats;
        this.updateIslandTexts(stats);
        const ts = DISPLAY.tile;
        const spot = firstOpenSpot(
            this.islandPlan.arrival.map((t) => ({ x: t.tileX * ts + ts / 2, y: (t.tileY + 1) * ts })),
            (x, y) => this.footBlocked(x, y),
        );
        if (!spot) {
            return;
        }
        if (!this.islandActive) {
            this.islandReturnTile = { ...this.avatarTile };
            this.islandActive = true;
            this.bus.emit("island:state", { on: true });
        }
        const bounds = islandCameraBounds(this.islandPlan);
        this.cameras.main.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
        this.avatar.setPosition(spot.x, spot.y);
        this.avatarTile = {
            tileX: Math.floor(this.avatar.x / ts),
            tileY: Math.floor((this.avatar.y - ts * 0.5) / ts),
        };
        this.cameras.main.centerOn(this.avatar.x, this.avatar.y);
        this.fxDropIn(this.avatar.x, this.avatar.y);
    }

    /** Leave the Overlook: restore the garden camera bounds and land back where you
     * stood (probing neighbors, then the Keeper's side — never into geometry). */
    private exitIsland(): void {
        if (!this.avatar || !this.islandActive) {
            return;
        }
        const ts = DISPLAY.tile;
        const back = this.islandReturnTile
            ?? { tileX: KEEPER_TILE.tileX + 2, tileY: KEEPER_TILE.tileY };
        const candidates = [
            back,
            { tileX: back.tileX + 1, tileY: back.tileY },
            { tileX: back.tileX - 1, tileY: back.tileY },
            { tileX: back.tileX, tileY: back.tileY + 1 },
            { tileX: back.tileX, tileY: back.tileY - 1 },
            { tileX: KEEPER_TILE.tileX + 2, tileY: KEEPER_TILE.tileY },
            { tileX: KEEPER_TILE.tileX - 2, tileY: KEEPER_TILE.tileY },
        ];
        const spot = firstOpenSpot(
            candidates.map((t) => ({ x: t.tileX * ts + ts / 2, y: (t.tileY + 1) * ts })),
            (x, y) => this.footBlocked(x, y),
        );
        if (!spot) {
            return; // stay on the island rather than land inside geometry
        }
        this.islandActive = false;
        this.cameras.main.setBounds(0, 0, this.plan.widthTiles * ts, this.plan.heightTiles * ts);
        this.avatar.setPosition(spot.x, spot.y);
        this.avatarTile = {
            tileX: Math.floor(this.avatar.x / ts),
            tileY: Math.floor((this.avatar.y - ts * 0.5) / ts),
        };
        this.cameras.main.centerOn(this.avatar.x, this.avatar.y);
        this.fxDropIn(this.avatar.x, this.avatar.y);
        this.bus.emit("island:state", { on: false });
    }

    /** The Overlook's standing set: an ACTIVE waystone home at the heart, a dormant
     * stone per stat monument (value + label floating above, walk up for the detail
     * line), and the floating title. Everything Y-sorts and collides like garden props. */
    private spawnIslandProps(plan: IslandPlan): void {
        const ts = DISPLAY.tile;
        const textStyle = {
            fontFamily: "Varela Round, sans-serif",
            align: "center",
        };

        const rsX = plan.returnStone.tileX * ts + ts / 2;
        const rsY = (plan.returnStone.tileY + 1) * ts;
        const homeKey = pickFirstAsset(["struct-waystone-active", "struct-waystone-dormant"]);
        const home = this.add.image(rsX, rsY, ensureTexture(this, homeKey));
        home.setOrigin(0.5, 1);
        sizeToHeightTiles(home, 2.4);
        home.setDepth(home.y / ts);
        this.solidBoxes.push(baseBoxFor(home.x, home.y, home.displayWidth, { heightPx: 10 }));
        this.add.text(rsX, rsY + 6, "Back to the garden", {
            ...textStyle,
            fontSize: "9px",
            color: "#dfe8ec",
            stroke: "#1a2b1e",
            strokeThickness: 3,
        }).setOrigin(0.5, 0).setDepth(9000).setResolution(2);

        this.add.text(rsX, (plan.sky.tileY + 2.2) * ts, ISLAND_TITLE, {
            ...textStyle,
            fontSize: "20px",
            color: "#fff8e6",
            stroke: "#3f2c1a",
            strokeThickness: 5,
        }).setOrigin(0.5, 1).setDepth(9000).setResolution(2);
        this.add.text(rsX, (plan.sky.tileY + 2.35) * ts, ISLAND_SUBTITLE, {
            ...textStyle,
            fontSize: "10px",
            color: "#dfe8ec",
            stroke: "#3f2c1a",
            strokeThickness: 3,
        }).setOrigin(0.5, 0).setDepth(9000).setResolution(2);

        const stoneKey = pickFirstAsset(["struct-waystone-dormant", "struct-waystone-active"]);
        for (const spot of plan.statSpots) {
            const mx = spot.tileX * ts + ts / 2;
            const my = (spot.tileY + 1) * ts;
            const img = this.add.image(mx, my, ensureTexture(this, stoneKey));
            img.setOrigin(0.5, 1);
            sizeToHeightTiles(img, 1.6);
            img.setDepth(img.y / ts);
            this.solidBoxes.push(
                baseBoxFor(img.x, img.y, img.displayWidth, { widthFactor: 0.5, heightPx: 8 }),
            );
            const value = this.add.text(mx, my - ts * 2.15, "—", {
                ...textStyle,
                fontSize: "13px",
                color: "#fff8e6",
                stroke: "#3f2c1a",
                strokeThickness: 4,
                wordWrap: { width: ts * 4 },
            }).setOrigin(0.5, 1).setDepth(9000).setResolution(2);
            const label = this.add.text(mx, my - ts * 2.1, "", {
                ...textStyle,
                fontSize: "9px",
                color: "#dfe8ec",
                stroke: "#1a2b1e",
                strokeThickness: 3,
            }).setOrigin(0.5, 0).setDepth(9000).setResolution(2);
            this.islandTexts.set(spot.id, value);
            this.islandTexts.set(`${spot.id}:label`, label);
        }
    }

    /** Refresh the monument texts from a fresh snapshot (every entry re-fetches). */
    private updateIslandTexts(stats: DepthStats): void {
        for (const stat of stats.stats) {
            this.islandTexts.get(stat.id)?.setText(stat.value);
            this.islandTexts.get(`${stat.id}:label`)?.setText(stat.label);
        }
    }

    private setupSky(): void {
        const apply = (): void => {
            const sky = skyStateFor(new Date());
            if (!this.skyOverlay) {
                this.skyOverlay = this.add.rectangle(
                    0,
                    0,
                    this.scale.width * 2,
                    this.scale.height * 2,
                    sky.tint,
                    sky.ambientAlpha,
                );
                this.skyOverlay.setOrigin(0, 0);
                this.skyOverlay.setScrollFactor(0);
                this.skyOverlay.setDepth(8000);
                this.skyOverlay.setBlendMode(Phaser.BlendModes.MULTIPLY);
            } else if (this.reducedMotion) {
                this.skyOverlay.setFillStyle(sky.tint, sky.ambientAlpha);
            } else {
                this.tweens.add({
                    targets: this.skyOverlay,
                    fillAlpha: sky.ambientAlpha,
                    duration: 800,
                });
                this.skyOverlay.setFillStyle(sky.tint, this.skyOverlay.fillAlpha);
            }

            const isNight = sky.phase === "night" || sky.phase === "dusk";
            this.isNight = isNight;
            for (const g of this.lanternGlows) {
                g.setVisible(isNight);
            }
            this.keeperLantern?.setVisible(isNight || sky.phase === "evening");
        };

        apply();
        this.time.addEvent({ delay: 60_000, loop: true, callback: apply });
    }

    /**
     * The onboarding shroud: near-opaque mist bands over everything but the Keeper's
     * plaza (a half-alpha one-tile ring feathers the edge), gently breathing. Skipped
     * entirely once the placement test is done — the fog never returns.
     */
    private setupFog(): void {
        if (this.flags.placementDone) {
            return;
        }
        this.fogActive = true;
        const ts = DISPLAY.tile;
        const pad = FOG_PAD_TILES;
        this.fogOrigin = { x: -pad * ts, y: -pad * ts };
        const wPx = (this.plan.widthTiles + pad * 2) * ts;
        const hPx = (this.plan.heightTiles + pad * 2) * ts;
        // Base: the near-opaque shroud. Drift: a lighter wisp layer that wanders on top.
        const layers: Array<{ key: string; seed: number; gain: number }> = [
            { key: "fog-shroud-base", seed: 11, gain: 1 },
            { key: "fog-shroud-drift", seed: 71, gain: 0.6 },
        ];
        for (const layer of layers) {
            this.paintFogTexture(layer.key, layer.seed, layer.gain);
            const sprite = this.add
                .image(this.fogOrigin.x, this.fogOrigin.y, layer.key)
                .setOrigin(0, 0)
                .setDisplaySize(wPx, hPx)
                .setDepth(FOG_DEPTH + this.fogSprites.length);
            this.fogSprites.push(sprite);
        }
    }

    /**
     * Paint one fog layer: per-pixel alpha = smooth plaza falloff × cloud noise (wispy
     * edges, soft body), color a pale morning mist with a broad tonal wash so the
     * shroud has depth instead of a flat fill. Painted at 1/4 world resolution.
     */
    private paintFogTexture(key: string, seed: number, gain: number): void {
        const px = FOG_CANVAS_PX_PER_TILE;
        const pad = FOG_PAD_TILES;
        const cw = (this.plan.widthTiles + pad * 2) * px;
        const ch = (this.plan.heightTiles + pad * 2) * px;
        if (this.textures.exists(key)) {
            this.textures.remove(key);
        }
        const canvas = this.textures.createCanvas(key, cw, ch);
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext();
        const img = ctx.createImageData(cw, ch);
        const data = img.data;
        for (let y = 0; y < ch; y++) {
            const tileY = y / px - pad;
            for (let x = 0; x < cw; x++) {
                const tileX = x / px - pad;
                const density = fogDensityAt(tileX, tileY, CENTER_PLAZA, FOG_FALLOFF_TILES);
                if (density <= 0) {
                    continue; // the plaza stays perfectly clear
                }
                // Body wisps (mid-size blobs) + a broad tonal wash for depth.
                const wisp = 0.62 + 0.38 * cloudNoise(tileX, tileY, 5.5, seed);
                const wash = cloudNoise(tileX, tileY, 13, seed + 9);
                const i = (y * cw + x) * 4;
                data[i] = 214 + Math.round(24 * wash);
                data[i + 1] = 224 + Math.round(19 * wash);
                data[i + 2] = 231 + Math.round(16 * wash);
                data[i + 3] = Math.round(255 * Math.min(1, density * wisp * gain));
            }
        }
        ctx.putImageData(img, 0, 0);
        canvas.refresh();
    }

    /** The living mist: the drift layer wanders and breathes (called from update()). */
    private tickFog(delta: number): void {
        if (!this.fogActive || this.fogSprites.length < 2 || this.reducedMotion) {
            return;
        }
        this.fogClock += delta;
        const t = this.fogClock;
        const drift = this.fogSprites[1];
        drift.setPosition(
            this.fogOrigin.x + Math.sin(t * 0.00009) * 14,
            this.fogOrigin.y + Math.cos(t * 0.00007) * 10,
        );
        drift.setAlpha(0.75 + 0.25 * Math.sin(t * 0.00013));
        this.fogSprites[0].setAlpha(0.94 + 0.06 * Math.sin(t * 0.00006));
    }

    /** placement:completed — the shroud burns off: drift first, then the base, then gone. */
    private liftFog(): void {
        if (!this.fogActive && this.fogSprites.length === 0) {
            return;
        }
        this.fogActive = false;
        // The garden is real now — the gnome can take its place among the beds.
        this.spawnGardener();
        const sprites = this.fogSprites;
        this.fogSprites = [];
        if (this.reducedMotion) {
            sprites.forEach((s) => s.destroy());
            return;
        }
        sprites.forEach((sprite, i) => {
            this.tweens.add({
                targets: sprite,
                alpha: 0,
                duration: FOG_LIFT_MS,
                delay: (sprites.length - 1 - i) * 500,
                ease: "Sine.easeInOut",
                onComplete: () => sprite.destroy(),
            });
        });
    }

    private setupBus(): void {
        this.unsubscribers.push(
            this.bus.on("mastery:refreshed", () => {
                this.snapshot = this.registry.get("masterySnapshot") as MasterySnapshot;
                this.restagePlants();
                this.syncOvergrowth();
            }),
            this.bus.on("gardener:insight", ({ text }) => {
                // Cache for a gnome that hasn't spawned yet (fog still up), then push to a live one.
                this.registry.set("gardenerInsight", text);
                this.gardener?.setText(text);
            }),
            this.bus.on("plant:watered", ({ nodeId }) => this.fxWatered(nodeId)),
            this.bus.on("growth:tick", ({ nodeId, fast }) => this.fxGrowthTick(nodeId, fast)),
            this.bus.on("plant:bloomed", ({ nodeId }) => this.fxBloomed(nodeId)),
            this.bus.on("map:travel", ({ waystoneId }) => this.teleportToWaystone(waystoneId)),
            this.bus.on("map:teleport", ({ tileX, tileY }) => {
                this.teleportToTile(tileX, tileY);
            }),
            this.bus.on("flora:water", ({ aimTileX, aimTileY }) => this.onFloraWater(aimTileX, aimTileY)),
            this.bus.on("placement:completed", () => this.liftFog()),
            // A stone trial paid out — reward the garden with a shower of rain (the
            // reward is credited by the panel layer; this is only the cosmetic answer).
            this.bus.on("trial:rewarded", () => this.weather?.rainBurst()),
            this.bus.on("island:enter", ({ stats }) => this.enterIsland(stats)),
            this.bus.on("island:exit", () => this.exitIsland()),
        );
    }

    /** A pour was paid for — grow the ground flora, persist the counts, celebrate bands.
     * (The FloraLayer owns the celebration itself now: the domino halo wave down the line
     * plus each garden's persistent completion visuals — ribbons, gravel, veins.) */
    private onFloraWater(aimTileX: number, aimTileY: number): void {
        if (!this.flora) {
            return;
        }
        const result = this.flora.applyPour(aimTileX, aimTileY);
        if (result.changed.length > 0) {
            this.bus.emit("flora:changed", { counts: this.flora.snapshotCounts() });
        }
        for (const bandId of result.bandsCompleted) {
            const section = bandId.split(":")[0];
            const flowers = this.flora.bandTiles(bandId).length;
            this.bus.emit("flora:band-bloomed", { section, bandId, flowers });
        }
    }

    private plantWorldPos(nodeId: string): { x: number; y: number } | null {
        const plant = this.plants.get(nodeId);
        if (!plant) {
            return null;
        }
        return { x: plant.sprite.x, y: plant.sprite.y - DISPLAY.plantHeight / 2 };
    }

    private fxWatered(nodeId: string): void {
        if (this.reducedMotion) {
            this.restagePlants();
            return;
        }
        const pos = this.plantWorldPos(nodeId);
        if (!pos) {
            return;
        }
        const drops = this.add.particles(pos.x, pos.y, ensureTexture(this, "fx-droplet"), {
            speed: { min: 20, max: 50 },
            lifespan: 400,
            quantity: 6,
            scale: { start: 0.4, end: 0 },
            tint: 0x6ec5ff,
        });
        drops.setDepth(8500);
        this.time.delayedCall(500, () => drops.destroy());
        const plant = this.plants.get(nodeId);
        if (plant) {
            this.tweens.add({
                targets: plant.sprite,
                alpha: { from: 1, to: 0.7 },
                yoyo: true,
                duration: 200,
            });
        }
    }

    private fxGrowthTick(nodeId: string, fast: boolean): void {
        if (this.reducedMotion) {
            this.restagePlants();
            return;
        }
        const pos = this.plantWorldPos(nodeId);
        const plant = this.plants.get(nodeId);
        if (!pos || !plant) {
            return;
        }
        this.restagePlants();
        this.tweens.add({
            targets: plant.sprite,
            scaleY: { from: 1.2, to: 1 },
            scaleX: { from: 0.9, to: 1 },
            duration: 180,
        });
        const spark = this.add.circle(pos.x, pos.y, 4, 0x5cb848, 0.8);
        spark.setDepth(8500);
        this.tweens.add({ targets: spark, alpha: 0, scale: 2, duration: 300, onComplete: () => spark.destroy() });
        if (fast) {
            const glint = this.add.star(pos.x + 10, pos.y - 10, 4, 2, 5, 0xffe066);
            glint.setDepth(8501);
            this.tweens.add({ targets: glint, alpha: 0, duration: 400, onComplete: () => glint.destroy() });
        }
    }

    private fxBloomed(nodeId: string): void {
        this.restagePlants();
        if (this.reducedMotion) {
            return;
        }
        const pos = this.plantWorldPos(nodeId);
        const plant = this.plants.get(nodeId);
        if (!pos || !plant) {
            return;
        }
        for (let i = 0; i < 8; i++) {
            const petal = this.add.circle(pos.x, pos.y, 3, 0xf9c5d5);
            petal.setDepth(8600);
            const angle = (i / 8) * Math.PI * 2;
            this.tweens.add({
                targets: petal,
                x: pos.x + Math.cos(angle) * 24,
                y: pos.y + Math.sin(angle) * 24,
                alpha: 0,
                duration: 900,
                onComplete: () => petal.destroy(),
            });
        }
        const halo = this.add.circle(pos.x, pos.y, 20, 0xffe066, 0.4);
        halo.setDepth(8599);
        this.tweens.add({ targets: halo, scale: 2, alpha: 0, duration: 1500, onComplete: () => halo.destroy() });
        const txt = this.add.text(pos.x, pos.y - 30, "Bloomed!", {
            fontFamily: "monospace",
            fontSize: "11px",
            color: "#ffe066",
        }).setOrigin(0.5).setDepth(8601);
        this.tweens.add({ targets: txt, y: pos.y - 50, alpha: 0, duration: 1500, onComplete: () => txt.destroy() });
    }

    private updateTendMarker(): void {
        if (this.tendMarker) {
            this.tendMarker.destroy();
            this.tendMarker = null;
        }
        if (!this.snapshot) {
            this.tendNextTile = null;
            return;
        }
        let best: TopicMastery | null = null;
        for (const t of this.snapshot.topics) {
            if (t.dueCount <= 0) {
                continue;
            }
            if (
                !best || t.dueCount > best.dueCount
                || (t.dueCount === best.dueCount && t.averageRecall < best.averageRecall)
            ) {
                best = t;
            }
        }
        if (!best) {
            this.tendNextTile = null;
            return;
        }
        const plant = this.plants.get(best.nodeId);
        if (!plant) {
            return;
        }
        this.tendNextTile = { tileX: plant.spot.tileX, tileY: plant.spot.tileY };
        if (this.reducedMotion) {
            return;
        }
        const ts = DISPLAY.tile;
        this.tendMarker = this.add.circle(
            plant.spot.tileX * ts + ts / 2,
            plant.spot.tileY * ts,
            6,
            0xffe066,
            0.35,
        );
        this.tendMarker.setDepth(plant.spot.tileY + 0.65);
        this.tweens.add({
            targets: this.tendMarker,
            scale: { from: 0.8, to: 1.3 },
            alpha: { from: 0.5, to: 0.15 },
            duration: 900,
            yoyo: true,
            repeat: -1,
        });
    }
}
