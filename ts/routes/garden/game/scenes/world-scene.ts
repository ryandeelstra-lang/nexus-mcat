// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: walkable overworld — tile layers, avatar, plants, juice, day/night (doc 23 §6–§9).
import Phaser from "phaser";

import type { TypedBus } from "../../state/bus";
import type { MasterySnapshot, TopicMastery } from "../../state/mastery";
import { type GrowthStage, stageFor } from "../../state/stage";
import { applyDisplaySize, DISPLAY, ensureTexture, hasAssetKey, sizeToHeightTiles, stageTextureKey } from "../assets";
import { skyStateFor } from "../daynight";
import { planFlora } from "../flora";
import { FloraLayer } from "../flora-layer";
import { sectorFor } from "../sectors/index";
import { buildTerrainModel, paintGround, planDecor, type TerrainModel } from "../terrain";
import { buildWorldPlan, KEEPER_TILE, type PlantSpot, type TileCoord, tileIsSolid, type WorldPlan } from "../worldgen";

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
    const v = dy < 0 ? "up" : dy > 0 ? "down" : "";
    const h = dx < 0 ? "left" : dx > 0 ? "right" : "";
    if (v && h) {
        return `${v}-${h}` as Dir8;
    }
    return (v || h || "down") as Dir8;
}

/** Per-facing art: which walk/idle animation plays and whether it's mirrored. The gardener
 * art has a front (down) and a left-facing side walk cycle plus a back (up) idle; right and
 * the right-leaning diagonals mirror the side frames, and every diagonal borrows the side
 * stride so it animates like a real walk. Due-up has no step art, so it holds the back idle
 * and leans on the walk bob for a sense of stride. */
interface FacingArt {
    walk: string;
    idle: string;
    flip: boolean;
}
const SIDE_LEFT: FacingArt = { walk: "av-walk-side", idle: "av-idle-side", flip: false };
const SIDE_RIGHT: FacingArt = { walk: "av-walk-side", idle: "av-idle-side", flip: true };
const FACING_ART: Record<Dir8, FacingArt> = {
    "down": { walk: "av-walk-down", idle: "av-idle-down", flip: false },
    "up": { walk: "av-walk-up", idle: "av-idle-up", flip: false },
    "left": SIDE_LEFT,
    "up-left": SIDE_LEFT,
    "down-left": SIDE_LEFT,
    "right": SIDE_RIGHT,
    "up-right": SIDE_RIGHT,
    "down-right": SIDE_RIGHT,
};

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
    private solidFn!: (x: number, y: number) => boolean;
    /** Ground flora (bone-meal watering): preset flowers that grow where you pour. */
    private flora: FloraLayer | null = null;
    private isMovingNow = false;

    private avatar!: Phaser.Physics.Arcade.Sprite;
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

        this.physics.world.setBounds(0, 0, worldW, worldH);
        this.cameras.main.setBounds(0, 0, worldW, worldH);
        // Compact overworld: a lower zoom reveals more of the island so it reads as
        // ~2 screens across (Champions-Island feel) while sprites stay chunky.
        this.cameras.main.setZoom(1.5);

        this.sectorUnlocks = new Set(
            (this.registry.get("sectorUnlocks") as string[] | undefined) ?? [],
        );
        this.solidFn = (tx, ty) =>
            this.lockedRegionAt(tx, ty) !== null
            || tileIsSolid(this.plan, tx, ty, this.stageByNode);

        this.renderGround();
        this.renderDecor();
        this.renderFlora();
        this.renderPropsAndPlants();
        this.renderSectorLocks();
        this.spawnLanternGlows();
        this.spawnCritters();
        this.setupAvatarAnimations();
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

    update(_time: number, delta: number): void {
        this.panelOpen = this.registry.get("panelOpen") as boolean ?? false;
        this.flags = this.registry.get("gardenFlags") as GardenFlags ?? this.flags;

        this.moveAvatar(delta);
        this.updateInteractPrompt();
        this.bobKeeper(delta);
        this.updateCritters();
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
        this.flora = new FloraLayer(
            this,
            planFlora(this.plan, this.terrain),
            counts ?? {},
            this.reducedMotion,
            (spot) => this.lockedRegionAt(spot.tileX, spot.tileY) === null,
        );
    }

    /** Deterministic foliage scatter — trees/bushes/flowers clustered by species. */
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
                img.setDepth(p.tileY + 0.5);
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
            ws.setDepth(r.waystone.tileY + 0.5);

            // Plots render NOTHING until they have real engine state (2026-07-03: no more
            // soil holes/beds — you water the grass and the region's preset flower appears
            // there, growing with real mastery). The invisible sprite keeps the spot alive
            // for watering/growth targeting.
            for (const spot of r.plants) {
                const stage = this.stageByNode.get(spot.nodeId) ?? "bare-soil";
                const key = ensureTexture(this, stageTextureKey(stage));
                const spr = this.add.image(spot.tileX * ts + ts / 2, spot.tileY * ts + ts, key);
                spr.setOrigin(0.5, 1);
                applyDisplaySize(spr);
                spr.setDepth(spot.tileY + 0.6);
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
        this.avatar = this.physics.add.sprite(sx, sy, ensureTexture(this, "gardener-idle-down"));
        this.avatar.setOrigin(0.5, 1);
        this.avatar.play("av-idle-down");
        this.refreshAvatarView();
        this.avatar.setDepth(KEEPER_TILE.tileY + 0.8);
        this.avatar.setCollideWorldBounds(true);
        this.cameras.main.startFollow(this.avatar, true, 0.12, 0.12);
        this.avatarTile = { tileX: KEEPER_TILE.tileX + 2, tileY: KEEPER_TILE.tileY };
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
            gz.setDepth(KEEPER_TILE.tileY - 1.6 + 0.5);
        }
        // The Keeper is a MONK — the meditating sage, not a gardener (2026-07-03).
        const keeperKey = pickFirstAsset(["keeper-meditating", "keeper-gardener"]);
        this.keeper = this.add.image(kx, ky, ensureTexture(this, keeperKey));
        this.keeper.setOrigin(0.5, 1);
        sizeToHeightTiles(this.keeper, 2.2);
        this.keeper.setDepth(KEEPER_TILE.tileY + 0.75);

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

    private moveAvatar(_delta: number): void {
        if (!this.avatar?.body) {
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
        // Normalise so diagonals aren't ~40% faster than the cardinals.
        const inv = moving ? 1 / Math.hypot(dx, dy) : 0;
        const vx = dx * speed * inv;
        const vy = dy * speed * inv;
        this.avatar.setVelocity(vx, vy);
        if (moving) {
            this.resolveTileCollision(vx, vy);
        }

        this.avatarTile = {
            tileX: Math.floor(this.avatar.x / DISPLAY.tile),
            tileY: Math.floor((this.avatar.y - DISPLAY.tile * 0.5) / DISPLAY.tile),
        };

        this.updateAvatarFrame(dx, dy, moving);
        this.refreshAvatarView();
        this.avatar.setDepth(this.avatarTile.tileY + 0.8);
    }

    /** Register the gardener's walk/idle animations once. The frames are individual PNGs
     * (not a sprite-atlas), so each is referenced by texture key; ensureTexture guarantees
     * every key exists (real art or a placeholder) before the animation is created. */
    private setupAvatarAnimations(): void {
        const mk = (key: string, frames: string[], frameRate: number): void => {
            if (this.anims.exists(key)) {
                return;
            }
            for (const f of frames) {
                ensureTexture(this, f);
            }
            this.anims.create({
                key,
                frames: frames.map((f) => ({ key: f })),
                frameRate,
                repeat: -1,
            });
        };
        // Idle poses are single frames; their gentle "breathing" is the scale bob in
        // refreshAvatarView, so it switches off cleanly under prefers-reduced-motion.
        mk("av-idle-down", ["gardener-idle-down"], 1);
        mk("av-idle-up", ["gardener-idle-up"], 1);
        mk("av-idle-side", ["gardener-idle-side-a"], 1);
        // Two contact poses per stride (left foot, right foot). ~8fps + the step bob reads
        // as full, weighted steps instead of the old 2-frame flicker.
        mk("av-walk-down", ["gardener-walk-down-a", "gardener-walk-down-b"], 8);
        mk("av-walk-side", ["gardener-walk-side-a", "gardener-walk-side-b"], 8);
        // No back-facing step art exists, so due-up holds the back idle and the bob strides.
        mk("av-walk-up", ["gardener-idle-up"], 1);
    }

    /** 8-direction walk/idle state machine, driven off the raw movement vector. */
    private updateAvatarFrame(dx: number, dy: number, moving: boolean): void {
        if (moving) {
            this.facing = facing8(dx, dy);
        }
        const art = FACING_ART[this.facing];
        this.avatar.play(moving ? art.walk : art.idle, true);
        this.avatar.setFlipX(art.flip);
    }

    /** Size the avatar to a constant on-screen height with its native aspect preserved —
     * the sliced frames differ in pixel size, and the old code force-fit each into one
     * 32×40 box, which made the character's proportions "pop" every frame. A subtle
     * vertical bob (two dips per stride) then gives the walk weight and smoothness. */
    private refreshAvatarView(): void {
        const frameH = this.avatar.frame.height;
        const scale = frameH > 0 ? DISPLAY.avatarHeight / frameH : 1;
        let bob = 1;
        if (!this.reducedMotion) {
            const t = this.time.now / 1000;
            if (this.isMovingNow) {
                // Due-up has no step frames, so a slightly deeper, faster bob stands in
                // for the missing back-walk stride.
                const up = this.facing === "up";
                const hz = up ? 9 : 8;
                const amp = up ? 0.06 : 0.05;
                bob = 1 + amp * Math.sin(t * Math.PI * hz);
            } else {
                bob = 1 + 0.012 * Math.sin(t * Math.PI * 1.2);
            }
        }
        this.avatar.setScale(scale, scale * bob);
    }

    private resolveTileCollision(vx: number, vy: number): void {
        const ts = DISPLAY.tile;
        const nextX = this.avatar.x + vx * (1 / 60);
        const nextY = this.avatar.y + vy * (1 / 60);
        const tx = Math.floor(nextX / ts);
        const ty = Math.floor((nextY - ts * 0.5) / ts);
        if (this.solidFn(tx, ty)) {
            this.avatar.setVelocity(0, 0);
            // Simple axis separation
            if (
                vx !== 0 && !this.solidFn(Math.floor((this.avatar.x + Math.sign(vx) * 8) / ts), this.avatarTile.tileY)
            ) {
                this.avatar.x += vx * (1 / 60);
            }
            if (
                vy !== 0
                && !this.solidFn(this.avatarTile.tileX, Math.floor((this.avatar.y + Math.sign(vy) * 8 - ts * 0.5) / ts))
            ) {
                this.avatar.y += vy * (1 / 60);
            }
        }
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
        this.avatar.setPosition(ws.tileX * ts + ts / 2, ws.tileY * ts + ts);
        this.avatarTile = { tileX: ws.tileX, tileY: ws.tileY };
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

    /** A pour was paid for — grow the ground flora, persist the counts, celebrate bands. */
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
            const flowers = result.changed.filter((c) => c.spot.bandId === bandId).length;
            this.bus.emit("flora:band-bloomed", { section, bandId, flowers });
            this.fxBandBloomed(bandId);
        }
    }

    /** Band celebration: a sparkle wave along the completed color line. */
    private fxBandBloomed(bandId: string): void {
        if (this.reducedMotion || !this.flora) {
            return;
        }
        const ts = DISPLAY.tile;
        this.flora.bandTiles(bandId).forEach((tile, i) => {
            this.time.delayedCall(i * 40, () => {
                const star = this.add.star(
                    tile.tileX * ts + ts / 2,
                    tile.tileY * ts + ts * 0.4,
                    4,
                    2,
                    5,
                    0xffe066,
                );
                star.setDepth(8650);
                this.tweens.add({
                    targets: star,
                    y: star.y - 10,
                    alpha: 0,
                    duration: 520,
                    onComplete: () => star.destroy(),
                });
            });
        });
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
