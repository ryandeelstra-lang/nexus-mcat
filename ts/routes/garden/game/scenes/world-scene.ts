// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: walkable overworld — tile layers, avatar, plants, juice, day/night (doc 23 §6–§9).
import Phaser from "phaser";

import type { TypedBus } from "../../state/bus";
import type { MasterySnapshot, TopicMastery } from "../../state/mastery";
import { type GrowthStage, stageFor } from "../../state/stage";
import { applyDisplaySize, DISPLAY, ensureTexture, hasAssetKey, sizeToHeightTiles, stageTextureKey } from "../assets";
import { baseBoxFor, boxesOverlap, footBoxAt, moveWithSlide, type SolidBox } from "../collision";
import { skyStateFor } from "../daynight";
import { planFlora } from "../flora";
import { FloraLayer } from "../flora-layer";
import { sectorFor } from "../sectors/index";
import { buildTerrainModel, paintGround, planDecor, type TerrainModel } from "../terrain";
import {
    buildWorldPlan,
    type GardenSection,
    KEEPER_TILE,
    type PlantSpot,
    type TileCoord,
    waterIsSolid,
    type WorldPlan,
} from "../worldgen";

export interface GardenFlags {
    paraphrase: Record<string, number>;
    weeds: Record<string, boolean>;
}

interface PlantObject {
    nodeId: string;
    sprite: Phaser.GameObjects.Image;
    spot: PlantSpot;
    marker?: Phaser.GameObjects.Arc;
}

const INTERACT_RADIUS = 1.5;

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
    walkDownA: "gardener-walk-down-a",
    walkDownB: "gardener-walk-down-b",
    walkSideA: "gardener-walk-side-a",
    walkSideB: "gardener-walk-side-b",
    // Synthesized at runtime (leg band mirrored): the source art's two side "walk" frames
    // both lead with the SAME foot, so these fabricate the missing opposite-foot contacts.
    walkSideOppA: "gardener-walk-side-opp-a",
    walkSideOppB: "gardener-walk-side-opp-b",
} as const;

/** One pose of a walk cycle: a texture + whether it's mirrored. Mirroring does double duty —
 * it swaps the leading foot on the front/back views (a front view mirrored still faces the
 * camera) and it faces the left-only side art to the right. */
interface Pose {
    key: string;
    flip: boolean;
}
interface Gait {
    walk: Pose[];
    idle: Pose;
}
const pose = (key: string, flip = false): Pose => ({ key, flip });

/** The three drawable gaits. Front/back swap feet by mirroring the whole frame (the swung
 * watering can reads as a natural arm swing); the side gait alternates each real frame with
 * its synthesized opposite-foot twin so the legs actually scissor. */
type GaitId = "down" | "up" | "side";
const GAIT: Record<GaitId, Gait> = {
    down: {
        walk: [pose(G.walkDownA), pose(G.walkDownA, true), pose(G.walkDownB), pose(G.walkDownB, true)],
        idle: pose(G.idleDown),
    },
    up: {
        // No back-facing step art exists; the vertical bob carries the stride here.
        walk: [pose(G.idleUp)],
        idle: pose(G.idleUp),
    },
    side: {
        walk: [pose(G.walkSideA), pose(G.walkSideOppA), pose(G.walkSideB), pose(G.walkSideOppB)],
        idle: pose(G.idleSide),
    },
};

/** Each of the eight facings → which gait to draw and whether the whole sprite is mirrored.
 * The side art faces left, so right + the right-leaning diagonals flip; every diagonal
 * borrows the side gait so it walks with a real alternating stride. */
const FACING_GAIT: Record<Dir8, { gait: GaitId; flip: boolean }> = {
    "down": { gait: "down", flip: false },
    "up": { gait: "up", flip: false },
    "left": { gait: "side", flip: false },
    "up-left": { gait: "side", flip: false },
    "down-left": { gait: "side", flip: false },
    "right": { gait: "side", flip: true },
    "up-right": { gait: "side", flip: true },
    "down-right": { gait: "side", flip: true },
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
    private nearTarget: "plant" | "keeper" | "waystone" | "flavor" | "trial" | null = null;
    private nearNodeId: string | null = null;
    private nearWaystoneId: string | null = null;
    private nearFlavorIdx: number | null = null;
    private nearTrialSection: string | null = null;
    /** Sections unlocked by their full MCAT test (registry-fed; locked regions are veiled+solid). */
    private sectorUnlocks = new Set<string>();
    private sectorVeils = new Map<string, Phaser.GameObjects.Rectangle>();
    private trialStones = new Map<string, Phaser.GameObjects.Container>();
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
    private lanternGlows: Phaser.GameObjects.Arc[] = [];
    private tendMarker: Phaser.GameObjects.Arc | null = null;
    private unsubscribers: Array<() => void> = [];

    private avatarTile = { tileX: KEEPER_TILE.tileX + 2, tileY: KEEPER_TILE.tileY };
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

        this.plan = buildWorldPlan();
        this.rebuildStageMap();

        const ts = DISPLAY.tile;
        const worldW = this.plan.widthTiles * ts;
        const worldH = this.plan.heightTiles * ts;

        this.cameras.main.setBounds(0, 0, worldW, worldH);
        // Compact overworld: a lower zoom reveals more of the island so it reads as
        // ~2 screens across (Champions-Island feel) while sprites stay chunky.
        this.cameras.main.setZoom(1.5);

        this.sectorUnlocks = new Set(
            (this.registry.get("sectorUnlocks") as string[] | undefined) ?? [],
        );

        this.renderGround();
        this.renderDecor();
        this.renderFlora();
        this.renderPropsAndPlants();
        this.renderSectorLocks();
        this.spawnLanternGlows();
        this.spawnCritters();
        this.setupAvatarTextures();
        this.spawnAvatar();
        this.spawnKeeper();
        this.setupInput();
        this.setupSky();
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

        this.scene.launch("map");
    }

    shutdown(): void {
        for (const off of this.unsubscribers) {
            off();
        }
        this.unsubscribers = [];
        this.flora?.destroy();
        this.flora = null;
    }

    /** Map overlay reads avatar position. */
    getAvatarTile(): { tileX: number; tileY: number } {
        return this.avatarTile;
    }

    getTendNextTile(): { tileX: number; tileY: number } | null {
        return this.tendNextTile;
    }

    update(time: number, delta: number): void {
        this.panelOpen = this.registry.get("panelOpen") as boolean ?? false;
        this.flags = this.registry.get("gardenFlags") as GardenFlags ?? this.flags;

        this.moveAvatar(delta);
        this.updateInteractPrompt();
        this.bobKeeper(delta);
        this.updateCritters();
        // The living wind: grown flowers sway as one field; completed lines host gusts.
        this.flora?.tick(time);
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

    /** The preset ground flora: every grass tile's flower, restored from persisted pours.
     * Pours inside a still-locked garden don't grow anything — the mist keeps it asleep. */
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
            (spot) => this.lockedRegionAt(spot.tileX, spot.tileY) === null,
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
            for (const spot of r.plants) {
                const stage = this.stageByNode.get(spot.nodeId) ?? "bare-soil";
                const key = ensureTexture(this, stageTextureKey(stage));
                const spr = this.add.image(spot.tileX * ts + ts / 2, spot.tileY * ts + ts, key);
                spr.setOrigin(0.5, 1);
                applyDisplaySize(spr);
                spr.setDepth(spr.y / ts);
                spr.setVisible(stage !== "bare-soil");
                this.plants.set(spot.nodeId, { nodeId: spot.nodeId, sprite: spr, spot });
            }
        }
    }

    /** The section of the LOCKED region containing this tile, or null (open ground/plaza). */
    private lockedRegionAt(tileX: number, tileY: number): string | null {
        for (const r of this.plan.regions) {
            if (this.sectorUnlocks.has(r.section)) {
                continue;
            }
            if (
                tileX >= r.rect.x && tileX < r.rect.x + r.rect.w
                && tileY >= r.rect.y && tileY < r.rect.y + r.rect.h
            ) {
                return r.section;
            }
        }
        return null;
    }

    /** Each locked garden sleeps under a mist veil with a glowing trial stone at its mouth:
     * take that garden's full MCAT test to lift it (placeholder panel until tests upload). */
    private renderSectorLocks(): void {
        const ts = DISPLAY.tile;
        for (const r of this.plan.regions) {
            if (this.sectorUnlocks.has(r.section)) {
                continue;
            }
            const veil = this.add.rectangle(
                r.rect.x * ts,
                r.rect.y * ts,
                r.rect.w * ts,
                r.rect.h * ts,
                0x101820,
                0.42,
            );
            veil.setOrigin(0, 0);
            veil.setDepth(7000);
            this.sectorVeils.set(r.section, veil);

            const mouth = sectorFor(r.section)?.entrance
                ?? { tileX: r.rect.x + Math.floor(r.rect.w / 2), tileY: r.rect.y + r.rect.h - 1 };
            const sx = mouth.tileX * ts + ts / 2;
            const sy = mouth.tileY * ts + ts;
            const stoneKey = pickFirstAsset(["struct-waystone-active", "struct-waystone-dormant"]);
            const stone = this.add.image(0, 0, ensureTexture(this, stoneKey));
            stone.setOrigin(0.5, 1);
            sizeToHeightTiles(stone, 2.2);
            const label = this.add.text(0, -2.4 * ts, "🔒 Trial", {
                fontFamily: "monospace",
                fontSize: "11px",
                color: "#ffe066",
                backgroundColor: "#1a2b1ecc",
                padding: { x: 4, y: 2 },
            }).setOrigin(0.5, 1);
            const group = this.add.container(sx, sy, [stone, label]);
            group.setDepth(7001);
            this.trialStones.set(r.section, group);
        }
    }

    private unlockSectorVisuals(section: string): void {
        this.sectorUnlocks.add(section);
        const veil = this.sectorVeils.get(section);
        const stone = this.trialStones.get(section);
        this.sectorVeils.delete(section);
        this.trialStones.delete(section);
        if (this.reducedMotion) {
            veil?.destroy();
            stone?.destroy();
            return;
        }
        if (veil) {
            this.tweens.add({
                targets: veil,
                alpha: 0,
                duration: 900,
                onComplete: () => veil.destroy(),
            });
        }
        if (stone) {
            this.tweens.add({
                targets: stone,
                alpha: 0,
                y: stone.y - 12,
                duration: 700,
                onComplete: () => stone.destroy(),
            });
        }
    }

    private restagePlants(): void {
        this.rebuildStageMap();
        for (const [nodeId, plant] of this.plants) {
            const stage = this.stageByNode.get(nodeId) ?? "bare-soil";
            plant.sprite.setTexture(ensureTexture(this, stageTextureKey(stage)));
            applyDisplaySize(plant.sprite);
            plant.sprite.setVisible(stage !== "bare-soil");
        }
        this.updateTendMarker();
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

    /** Would the avatar's FEET at (x, y) collide? World rim, water (minus fords), locked
     * gardens, and every standing thing's base box. */
    private footBlocked(x: number, y: number): boolean {
        const ts = DISPLAY.tile;
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
            if (this.lockedRegionAt(tx, ty) !== null) {
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

        this.interactKey.on("down", () => this.tryInteract());
        // Space is the tending verb (docs 2026-07-03): near a person/marker it interacts
        // (talk to the Keeper, use a waystone); on open ground it WATERS where you stand
        // and the garden wakes there. Planting seeds is gone — you water the ground itself.
        this.spaceKey.on("down", () => {
            if (this.panelOpen) {
                return;
            }
            if (
                this.nearTarget === "keeper" || this.nearTarget === "waystone"
                || this.nearTarget === "flavor" || this.nearTarget === "trial"
            ) {
                this.tryInteract();
            } else {
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
        const nodeId = this.nearestPlotNode(6);
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

    /** The nearest plot within `maxTiles` of the avatar (or null on open ground). Plots
     * inside a still-locked garden don't drink — take the trial first. */
    private nearestPlotNode(maxTiles: number): string | null {
        const ax = this.avatarTile.tileX + 0.5;
        const ay = this.avatarTile.tileY + 0.5;
        let best: string | null = null;
        let bestD = maxTiles;
        for (const [, plant] of this.plants) {
            if (this.lockedRegionAt(plant.spot.tileX, plant.spot.tileY) !== null) {
                continue;
            }
            const d = this.distTiles(ax, ay, plant.spot.tileX + 0.5, plant.spot.tileY + 0.5);
            if (d < bestD) {
                bestD = d;
                best = plant.nodeId;
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

    /** Prepare the gardener's runtime textures. Guarantees every real frame exists (art or a
     * placeholder), then fabricates the opposite-foot side contacts the source art lacks. */
    private setupAvatarTextures(): void {
        for (const key of Object.values(G)) {
            if (key !== G.walkSideOppA && key !== G.walkSideOppB) {
                ensureTexture(this, key);
            }
        }
        this.makeLegMirrorTexture(G.walkSideA, G.walkSideOppA);
        this.makeLegMirrorTexture(G.walkSideB, G.walkSideOppB);
    }

    /** Build `dstKey` from `srcKey` with the lower `frac` of the frame (the legs/boots)
     * mirrored horizontally about the leg band's opaque centroid — swapping which foot leads
     * while the upper body and the held watering can stay put. This turns the art's two
     * same-foot side poses into a real alternating stride. */
    private makeLegMirrorTexture(srcKey: string, dstKey: string, frac = 0.44): void {
        if (this.textures.exists(dstKey)) {
            return;
        }
        const img = this.textures.get(srcKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
        const w = Math.floor(img.width);
        const h = Math.floor(img.height);
        if (w <= 0 || h <= 0) {
            return;
        }
        const tex = this.textures.createCanvas(dstKey, w, h);
        if (!tex) {
            return;
        }
        const ctx = tex.getContext();
        const cut = Math.floor(h * (1 - frac));
        const bandH = h - cut;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        // Opaque centroid of the leg band → the vertical axis we mirror the boots about.
        const band = ctx.getImageData(0, cut, w, bandH);
        let sumX = 0;
        let count = 0;
        for (let y = 0; y < bandH; y++) {
            for (let x = 0; x < w; x++) {
                if (band.data[(y * w + x) * 4 + 3] > 40) {
                    sumX += x;
                    count++;
                }
            }
        }
        const cx = count > 0 ? sumX / count : w / 2;
        ctx.clearRect(0, cut, w, bandH);
        ctx.save();
        ctx.translate(2 * cx, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, cut, w, bandH, 0, cut, w, bandH);
        ctx.restore();
        tex.refresh();
    }

    /** 8-direction walk/idle driver. Advances a smooth, frame-rate-independent step clock and
     * draws the current pose (texture + mirror); diagonals walk with the side gait. */
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
        // Per-pose mirror (foot swap) XOR facing mirror (right-facing side art).
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
                // Due-up has no step frames, so it leans on a slightly deeper bob.
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

        // Trial stones (locked gardens) — checked first so the lock always answers.
        for (const [section, group] of this.trialStones) {
            if (
                this.distTiles(ax, ay, group.x / ts - 0.5 + 0.5, group.y / ts - 1 + 0.5)
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

        if (this.nearTarget && !this.panelOpen) {
            this.interactPrompt.setVisible(true);
            this.interactPrompt.setPosition(this.avatar.x, this.avatar.y - ts);
        } else {
            this.interactPrompt.setVisible(false);
        }
    }

    private tryInteract(): void {
        if (this.panelOpen || !this.nearTarget) {
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
                    this.bus.emit("sector:trial", { section: this.nearTrialSection });
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
        if (!region || !this.avatar || !this.sectorUnlocks.has(waystoneId)) {
            return; // a locked garden cannot be fast-travelled into — take its trial first
        }
        const ts = DISPLAY.tile;
        const ws = region.waystone;
        // Arrive one tile SOUTH of the stone (never inside its base box), sliding further
        // south if something occupies that spot.
        let y = (ws.tileY + 2) * ts;
        for (let tries = 0; tries < 4 && this.footBlocked(ws.tileX * ts + ts / 2, y); tries++) {
            y += ts;
        }
        this.avatar.setPosition(ws.tileX * ts + ts / 2, y);
        this.avatarTile = {
            tileX: Math.floor(this.avatar.x / ts),
            tileY: Math.floor((this.avatar.y - ts * 0.5) / ts),
        };
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

    private setupBus(): void {
        this.unsubscribers.push(
            this.bus.on("mastery:refreshed", () => {
                this.snapshot = this.registry.get("masterySnapshot") as MasterySnapshot;
                this.restagePlants();
            }),
            this.bus.on("plant:watered", ({ nodeId }) => this.fxWatered(nodeId)),
            this.bus.on("growth:tick", ({ nodeId, fast }) => this.fxGrowthTick(nodeId, fast)),
            this.bus.on("plant:bloomed", ({ nodeId }) => this.fxBloomed(nodeId)),
            this.bus.on("map:travel", ({ waystoneId }) => this.teleportToWaystone(waystoneId)),
            this.bus.on("sector:unlocked", ({ section }) => this.unlockSectorVisuals(section)),
            this.bus.on("flora:water", ({ aimTileX, aimTileY }) => this.onFloraWater(aimTileX, aimTileY)),
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
