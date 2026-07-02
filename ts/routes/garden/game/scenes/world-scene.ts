// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: walkable overworld — tile layers, avatar, plants, gates, juice, day/night (doc 23 §6–§9).
import Phaser from "phaser";

import type { TypedBus } from "../../state/bus";
import type { MasterySnapshot, TopicMastery } from "../../state/mastery";
import { type GrowthStage, stageFor } from "../../state/stage";
import {
    applyDisplaySize,
    DISPLAY,
    ensureTexture,
    regionGrassKey,
    regionPathKey,
    regionThemeFromSection,
    stageTextureKey,
} from "../assets";
import { skyStateFor } from "../daynight";
import {
    buildWorldPlan,
    gateIsOpen,
    type GateSpot,
    KEEPER_TILE,
    type PlantSpot,
    tileIsSolid,
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

export class WorldScene extends Phaser.Scene {
    private bus!: TypedBus;
    private plan!: WorldPlan;
    private snapshot: MasterySnapshot | null = null;
    private flags: GardenFlags = { paraphrase: {}, weeds: {} };
    private reducedMotion = false;
    private panelOpen = false;

    private plants = new Map<string, PlantObject>();
    private gates = new Map<string, Phaser.GameObjects.Image>();
    private stageByNode = new Map<string, GrowthStage>();
    private solidFn!: (x: number, y: number) => boolean;

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
    private nearTarget: "plant" | "keeper" | "gate" | "waystone" | null = null;
    private nearNodeId: string | null = null;
    private nearWaystoneId: string | null = null;

    private skyOverlay!: Phaser.GameObjects.Rectangle;
    private lanternGlows: Phaser.GameObjects.Arc[] = [];
    private tendMarker: Phaser.GameObjects.Arc | null = null;
    private unsubscribers: Array<() => void> = [];

    private avatarTile = { tileX: KEEPER_TILE.tileX + 2, tileY: KEEPER_TILE.tileY };
    private tendNextTile: { tileX: number; tileY: number } | null = null;

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
        this.cameras.main.setZoom(2);

        this.solidFn = (tx, ty) => tileIsSolid(this.plan, tx, ty, this.stageByNode);

        this.renderGround();
        this.renderGates();
        this.renderPropsAndPlants();
        this.spawnLanternGlows();
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
        this.cameras.main.startFollow(this.avatar, true, 0.12, 0.12);
        this.updateInteractPrompt();
        this.bobKeeper(delta);
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
        const ts = DISPLAY.tile;
        const trailSet = new Set<string>();
        for (const r of this.plan.regions) {
            const theme = regionThemeFromSection(r.section);
            for (let y = r.rect.y; y < r.rect.y + r.rect.h; y++) {
                for (let x = r.rect.x; x < r.rect.x + r.rect.w; x++) {
                    const variant = (x + y) % 3;
                    const key = ensureTexture(this, regionGrassKey(theme, variant));
                    const img = this.add.image(x * ts, y * ts, key).setOrigin(0, 0);
                    applyDisplaySize(img);
                    img.setDepth(y);
                }
            }
            for (const t of r.trailTiles) {
                trailSet.add(`${t.tileX},${t.tileY}`);
            }
            for (const t of r.waterTiles) {
                const pondKey = theme === "sakura"
                    ? ensureTexture(this, `tile-sakura-pond-${String((t.tileX + t.tileY) % 6).padStart(2, "0")}`)
                    : ensureTexture(this, regionGrassKey(theme, 0));
                const img = this.add.image(t.tileX * ts, t.tileY * ts, pondKey).setOrigin(0, 0);
                applyDisplaySize(img);
                img.setDepth(t.tileY + 0.1);
            }
            for (const t of r.trailTiles) {
                const variant = (t.tileX + t.tileY) % 3;
                const key = ensureTexture(this, regionPathKey(theme, variant));
                const img = this.add.image(t.tileX * ts, t.tileY * ts, key).setOrigin(0, 0);
                applyDisplaySize(img);
                img.setDepth(t.tileY + 0.2);
            }
        }
        // Center plaza path
        for (const t of this.plan.center.plazaTiles) {
            const key = ensureTexture(this, regionPathKey("sakura", 1));
            const img = this.add.image(t.tileX * ts, t.tileY * ts, key).setOrigin(0, 0);
            applyDisplaySize(img);
            img.setDepth(t.tileY + 0.15);
        }
    }

    private renderPropsAndPlants(): void {
        const ts = DISPLAY.tile;
        const sortables: Array<{ obj: Phaser.GameObjects.Image; depth: number }> = [];

        for (const r of this.plan.regions) {
            for (const p of r.props) {
                const key = ensureTexture(this, p.key);
                const img = this.add.image(p.tileX * ts + ts / 2, p.tileY * ts + ts, key);
                img.setOrigin(0.5, 1);
                applyDisplaySize(img);
                sortables.push({ obj: img, depth: p.tileY + 0.5 });
            }
            for (const spot of r.plants) {
                const stage = this.stageByNode.get(spot.nodeId) ?? "bare-soil";
                const key = ensureTexture(this, stageTextureKey(stage));
                const spr = this.add.image(spot.tileX * ts + ts / 2, spot.tileY * ts + ts, key);
                spr.setOrigin(0.5, 1);
                applyDisplaySize(spr);
                sortables.push({ obj: spr, depth: spot.tileY + 0.6 });
                this.plants.set(spot.nodeId, { nodeId: spot.nodeId, sprite: spr, spot });
            }
        }

        sortables.sort((a, b) => a.depth - b.depth);
        for (const s of sortables) {
            s.obj.setDepth(s.depth);
        }
    }

    private renderGates(): void {
        for (const g of this.plan.gates) {
            this.refreshGateSprite(g);
        }
    }

    private refreshGateSprite(g: GateSpot): void {
        const ts = DISPLAY.tile;
        const open = gateIsOpen(g, this.stageByNode);
        const key = ensureTexture(this, open ? "gate-open" : "gate-closed");
        const existing = this.gates.get(g.id);
        if (existing) {
            existing.setTexture(key);
            return;
        }
        const img = this.add.image(g.tileX * ts + ts / 2, g.tileY * ts + ts / 2, key);
        img.setOrigin(0.5, 0.5);
        applyDisplaySize(img);
        img.setDepth(g.tileY + 0.55);
        this.gates.set(g.id, img);
    }

    private restagePlants(): void {
        this.rebuildStageMap();
        for (const [nodeId, plant] of this.plants) {
            const stage = this.stageByNode.get(nodeId) ?? "bare-soil";
            plant.sprite.setTexture(ensureTexture(this, stageTextureKey(stage)));
            applyDisplaySize(plant.sprite);
        }
        for (const g of this.plan.gates) {
            this.refreshGateSprite(g);
        }
        this.updateTendMarker();
    }

    private spawnAvatar(): void {
        const ts = DISPLAY.tile;
        const sx = (KEEPER_TILE.tileX + 2) * ts + ts / 2;
        const sy = KEEPER_TILE.tileY * ts + ts;
        this.avatar = this.physics.add.sprite(sx, sy, ensureTexture(this, "gardener-idle-down"));
        this.avatar.setOrigin(0.5, 1);
        applyDisplaySize(this.avatar);
        this.avatar.setDepth(KEEPER_TILE.tileY + 0.8);
        this.avatar.setCollideWorldBounds(true);
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

    private spawnKeeper(): void {
        const ts = DISPLAY.tile;
        const kx = KEEPER_TILE.tileX * ts + ts / 2;
        const ky = KEEPER_TILE.tileY * ts + ts;
        this.keeper = this.add.image(kx, ky, ensureTexture(this, "keeper-meditating"));
        this.keeper.setOrigin(0.5, 1);
        applyDisplaySize(this.keeper);
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
        this.spaceKey.on("down", () => {
            if (!this.panelOpen) {
                this.tryInteract();
            }
        });
    }

    private moveAvatar(_delta: number): void {
        if (!this.avatar?.body) {
            return;
        }
        const speed = 90;
        let vx = 0;
        let vy = 0;
        if (this.cursors.left.isDown || this.wasd.A.isDown) {
            vx = -speed;
        } else if (this.cursors.right.isDown || this.wasd.D.isDown) {
            vx = speed;
        }
        if (this.cursors.up.isDown || this.wasd.W.isDown) {
            vy = -speed;
        } else if (this.cursors.down.isDown || this.wasd.S.isDown) {
            vy = speed;
        }

        this.avatar.setVelocity(vx, vy);
        if (vx !== 0 || vy !== 0) {
            this.resolveTileCollision(vx, vy);
        }

        this.avatarTile = {
            tileX: Math.floor(this.avatar.x / DISPLAY.tile),
            tileY: Math.floor((this.avatar.y - DISPLAY.tile * 0.5) / DISPLAY.tile),
        };

        if (Math.abs(vx) > Math.abs(vy)) {
            this.avatar.setTexture(ensureTexture(this, vx < 0 ? "gardener-idle-side-a" : "gardener-idle-side-b"));
        } else if (vy !== 0) {
            const walk = Math.floor(this.time.now / 200) % 2 === 0 ? "gardener-walk-down-a" : "gardener-walk-down-b";
            this.avatar.setTexture(ensureTexture(this, vy < 0 ? "gardener-idle-up" : walk));
        }
        applyDisplaySize(this.avatar);
        this.avatar.setDepth(this.avatarTile.tileY + 0.8);
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

        // Keeper
        if (this.distTiles(ax, ay, KEEPER_TILE.tileX + 0.5, KEEPER_TILE.tileY + 0.5) <= INTERACT_RADIUS) {
            this.nearTarget = "keeper";
        }

        // Plants
        for (const [, plant] of this.plants) {
            const px = plant.spot.tileX + 0.5;
            const py = plant.spot.tileY + 0.5;
            if (this.distTiles(ax, ay, px, py) <= INTERACT_RADIUS) {
                this.nearTarget = "plant";
                this.nearNodeId = plant.nodeId;
                break;
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

        // Gates
        if (!this.nearTarget) {
            for (const g of this.plan.gates) {
                if (this.distTiles(ax, ay, g.tileX + 0.5, g.tileY + 0.5) <= INTERACT_RADIUS) {
                    this.nearTarget = "gate";
                    this.nearNodeId = g.dst;
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
            case "gate":
                if (this.nearNodeId) {
                    this.bus.emit("plant:interact", { nodeId: this.nearNodeId });
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
        );
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
