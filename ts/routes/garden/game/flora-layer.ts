// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the ground-flora RENDER layer (watering redesign 2026-07-03; mass-bloom
// concepts selected same day — one per garden, all "A"):
//   P-S  HANAMI BANKS      — waterline gradient + wind-gust waves traveling down the
//                            shoreline lines, petals shed on the gust.
//   B-B  ENDLESS RIBBONS   — a completed two-row band snaps into one continuous unbroken
//                            color ribbon (jitter removed, clumps widened to touch) with
//                            a flag-ripple wave rolling down it.
//   C-P  EMBROIDERY PARTERRE — completed rings lay persistent gold-gravel glints between
//                            the roses; the fountain answers (world scene owns the plume).
//   CARS BIOLUMINAL VEINS  — bloomed orchids breathe with an additive glow; a completed
//                            drift grows a glowing root-vein along its chain and reaches
//                            toward the Supertrees.
// Shared: every grown flower sways on a spatial phase so dense patches move as one wind
// field; band completions celebrate as a traveling domino down the line, not a scatter.
// Pure logic lives in flora.ts. Everything here is cosmetic (I4) and honors reduced
// motion (I9): stages snap, nothing sways, veins/gravel render static.
import Phaser from "phaser";

import { ensureTexture, sizeToHeightTiles } from "./assets";
import {
    applyPour,
    bandBloomFraction,
    bandWaveOrder,
    type FloraCounts,
    floraHash,
    floraHeightTiles,
    floraKey,
    type FloraLayout,
    type FloraStage,
    floraStage,
    floraTextureKey,
    type FlowerSpot,
    pourProgress,
    type PourResult,
    sectionBloomFraction,
} from "./flora";
import type { GardenSection, TileCoord } from "./worldgen";
import { TILE_SIZE } from "./worldgen";

/** Flowers sit just above ground decals and below plots/avatar at the same row. */
const DEPTH_OFFSET = 0.3;
/** Radius (tiles) around the avatar in which flowers rustle while walking. */
const RUSTLE_RADIUS = 1.05;
/** Minimum ms between rustles of the same flower. */
const RUSTLE_COOLDOWN_MS = 420;

// --- The wind field (shared sway) ---------------------------------------------------
/** Sway amplitude (deg) per stage — blooms lean the most, sprouts barely nod. */
const SWAY_AMP: Record<FloraStage, number> = { none: 0, sprout: 1.6, bud: 2.8, bloom: 4.2 };
/** Sway speed (radians per ms) and spatial phase gradient (radians per tile). */
const SWAY_SPEED = 1 / 520;
const SWAY_PHASE_X = 0.55;
const SWAY_PHASE_Y = 0.22;

// --- Gusts down completed lines ------------------------------------------------------
/** One completed band hosts a traveling gust roughly this often. */
const GUST_INTERVAL_MS = 6500;
/** Stagger between neighbouring flowers as the gust travels (ms). */
const GUST_STEP_MS = 26;
/** Extra lean a gust adds on top of the ambient sway (deg). */
const GUST_LEAN_DEG = 9;

// --- Ribbons (B-B) ---------------------------------------------------------------------
/** Widen ribboned clumps so neighbours touch — the unbroken line. */
const RIBBON_WIDTH_TILES = 1.14;

// --- Glow (CARS) -------------------------------------------------------------------
const GLOW_BASE_ALPHA = 0.2;
const GLOW_PULSE_ALPHA = 0.12;
const GLOW_HEIGHT_TILES = 1.25;

interface FlowerSprite {
    spot: FlowerSpot;
    stage: FloraStage;
    sprite: Phaser.GameObjects.Image;
    /** Jittered rest anchor (ribboning tweens toward the aligned anchor). */
    baseX: number;
    baseY: number;
    /** Spatial wind phase (radians). */
    swayPhase: number;
    lastRustle: number;
    /** While now < busyUntil a tween owns the angle; the wind field skips it. */
    busyUntil: number;
    /** Additive glow (CARS blooms). */
    glow?: Phaser.GameObjects.Image;
}

export class FloraLayer {
    private scene: Phaser.Scene;
    private layout: FloraLayout;
    private counts: FloraCounts;
    private reducedMotion: boolean;
    private allowSpot: (spot: FlowerSpot) => boolean;
    /** Landmark anchors (C-P fountain, CARS Supertrees) for section-level ambience. */
    private anchors: Partial<Record<GardenSection, TileCoord>>;
    private sprites = new Map<string, FlowerSprite>();
    private pipGroup: Phaser.GameObjects.Container | null = null;
    private completedBands = new Set<string>();
    private ribbonedBands = new Set<string>();
    private gravelByBand = new Map<string, Phaser.GameObjects.Container>();
    private veinsByBand = new Map<string, Phaser.GameObjects.Graphics>();
    private lastGustSlot = -1;

    constructor(
        scene: Phaser.Scene,
        layout: FloraLayout,
        initialCounts: FloraCounts,
        reducedMotion: boolean,
        allowSpot: (spot: FlowerSpot) => boolean = () => true,
        anchors: Partial<Record<GardenSection, TileCoord>> = {},
    ) {
        this.scene = scene;
        this.layout = layout;
        this.counts = { ...initialCounts };
        this.reducedMotion = reducedMotion;
        this.allowSpot = allowSpot;
        this.anchors = anchors;
        this.syncAll();
    }

    /** The persisted record (the app layer writes it through to the sidecar). */
    snapshotCounts(): FloraCounts {
        return { ...this.counts };
    }

    /** Tile coordinates of one color band (celebration fx walks along them). */
    bandTiles(bandId: string): TileCoord[] {
        return (this.layout.bands.get(bandId) ?? []).map((key) => {
            const spot = this.layout.spots.get(key)!;
            return { tileX: spot.tileX, tileY: spot.tileY };
        });
    }

    /** Fraction of a section's flowers at full bloom (world scene's grand-crown trigger). */
    sectionBloom(section: GardenSection): number {
        return sectionBloomFraction(this.layout, this.counts, section);
    }

    /** Build sprites + persistent band visuals for every already-watered tile (boot). */
    private syncAll(): void {
        for (const [key, spot] of this.layout.spots) {
            const stage = floraStage(this.counts[key] ?? 0, spot.watersNeeded);
            if (stage !== "none") {
                this.setSprite(key, spot, stage, false);
            }
        }
        for (const bandId of this.layout.bands.keys()) {
            if (bandBloomFraction(this.layout, this.counts, bandId) >= 1) {
                this.completedBands.add(bandId);
                this.applyBandCompletionVisuals(bandId, true);
            }
        }
    }

    /** Deterministic sub-tile jitter so rows read organic, never grid-stamped. */
    private anchorFor(spot: FlowerSpot): { x: number; y: number } {
        const jx = (floraHash(spot.tileX, spot.tileY, 1201) - 0.5) * 10;
        const jy = (floraHash(spot.tileX, spot.tileY, 1202) - 0.5) * 6;
        return {
            x: spot.tileX * TILE_SIZE + TILE_SIZE / 2 + jx,
            y: (spot.tileY + 1) * TILE_SIZE - 2 + jy,
        };
    }

    /** Grid-aligned anchor (ribboned rows sit on the line, no jitter). */
    private alignedAnchorFor(spot: FlowerSpot): { x: number; y: number } {
        return {
            x: spot.tileX * TILE_SIZE + TILE_SIZE / 2,
            y: (spot.tileY + 1) * TILE_SIZE - 2,
        };
    }

    private setSprite(key: string, spot: FlowerSpot, stage: FloraStage, animate: boolean): void {
        const texture = ensureTexture(this.scene, floraTextureKey(spot.species, stage));
        const existing = this.sprites.get(key);
        if (existing) {
            existing.stage = stage;
            existing.sprite.setTexture(texture);
            sizeToHeightTiles(existing.sprite, floraHeightTiles(spot.species, stage));
            this.syncGlow(existing);
            if (animate && !this.reducedMotion) {
                this.popTween(existing);
            }
            return;
        }
        const { x, y } = this.anchorFor(spot);
        const sprite = this.scene.add.image(x, y, texture);
        sprite.setOrigin(0.5, 1);
        sizeToHeightTiles(sprite, floraHeightTiles(spot.species, stage));
        sprite.setFlipX(floraHash(spot.tileX, spot.tileY, 1203) < 0.5);
        sprite.setDepth(spot.tileY + DEPTH_OFFSET);
        const entry: FlowerSprite = {
            spot,
            stage,
            sprite,
            baseX: x,
            baseY: y,
            swayPhase: spot.tileX * SWAY_PHASE_X + spot.tileY * SWAY_PHASE_Y
                + floraHash(spot.tileX, spot.tileY, 1204) * 0.6,
            lastRustle: 0,
            busyUntil: 0,
        };
        this.sprites.set(key, entry);
        this.syncGlow(entry);
        if (animate && !this.reducedMotion) {
            this.popTween(entry);
        }
    }

    /** CARS blooms breathe with an additive glow (Bioluminal Veins). */
    private syncGlow(entry: FlowerSprite): void {
        const wantsGlow = entry.spot.section === "CARS" && entry.stage === "bloom";
        if (!wantsGlow) {
            entry.glow?.destroy();
            entry.glow = undefined;
            return;
        }
        if (entry.glow) {
            return;
        }
        const glow = this.scene.add.image(
            entry.baseX,
            entry.baseY - TILE_SIZE * 0.3,
            ensureTexture(this.scene, "fx-glow-04"),
        );
        glow.setOrigin(0.5, 0.5);
        sizeToHeightTiles(glow, GLOW_HEIGHT_TILES);
        glow.setTint(entry.spot.species.tint);
        glow.setAlpha(GLOW_BASE_ALPHA);
        glow.setBlendMode(Phaser.BlendModes.ADD);
        glow.setDepth(entry.spot.tileY + DEPTH_OFFSET - 0.02);
        entry.glow = glow;
    }

    /** Squash-and-stretch pop on any growth step. */
    private popTween(entry: FlowerSprite): void {
        const sprite = entry.sprite;
        const sx = sprite.scaleX;
        const sy = sprite.scaleY;
        sprite.setScale(sx * 0.4, sy * 0.4);
        entry.busyUntil = this.scene.time.now + 280;
        this.scene.tweens.add({
            targets: sprite,
            scaleX: sx,
            scaleY: sy,
            duration: 260,
            ease: "Back.easeOut",
        });
    }

    /** The bloom moment for one ground flower: petal burst + a soft ring (species-tinted). */
    private bloomBurst(spot: FlowerSpot): void {
        if (this.reducedMotion) {
            return;
        }
        const { x, y } = this.anchorFor(spot);
        const cy = y - TILE_SIZE * 0.35;
        for (let i = 0; i < 6; i++) {
            const petal = this.scene.add.circle(x, cy, 2, spot.species.tint);
            petal.setDepth(8600);
            const angle = (i / 6) * Math.PI * 2 + floraHash(spot.tileX, spot.tileY, i) * 0.8;
            this.scene.tweens.add({
                targets: petal,
                x: x + Math.cos(angle) * 14,
                y: cy + Math.sin(angle) * 10 - 6,
                alpha: 0,
                duration: 620,
                ease: "Cubic.easeOut",
                onComplete: () => petal.destroy(),
            });
        }
        const ring = this.scene.add.circle(x, cy, 6, spot.species.tint, 0.35);
        ring.setDepth(8599);
        this.scene.tweens.add({
            targets: ring,
            scale: 2.4,
            alpha: 0,
            duration: 700,
            onComplete: () => ring.destroy(),
        });
    }

    /** Dark "wet soil" decals over the splash, fading as the water soaks in. */
    private moistureFx(aimX: number, aimY: number): void {
        if (this.reducedMotion) {
            return;
        }
        const cx = aimX * TILE_SIZE + TILE_SIZE / 2;
        const cy = aimY * TILE_SIZE + TILE_SIZE / 2;
        // Dark + ~0.35 alpha keeps the splash readable even on the near-black CARS grass.
        const wet = this.scene.add.ellipse(cx, cy, TILE_SIZE * 2.6, TILE_SIZE * 2.0, 0x1f2e1e, 0.35);
        wet.setDepth(-4);
        this.scene.tweens.add({
            targets: wet,
            alpha: 0,
            duration: 1400,
            ease: "Sine.easeIn",
            onComplete: () => wet.destroy(),
        });
    }

    /** Droplet pips over the aimed tile: filled = pours so far, hollow = pours to go. */
    private showPips(aimX: number, aimY: number): void {
        const progress = pourProgress(this.layout, this.counts, aimX, aimY);
        if (!progress) {
            return;
        }
        this.pipGroup?.destroy();
        const cx = aimX * TILE_SIZE + TILE_SIZE / 2;
        const topY = aimY * TILE_SIZE - 6;
        const spacing = 7;
        const startX = -((progress.needed - 1) * spacing) / 2;
        const children: Phaser.GameObjects.GameObject[] = [];
        for (let i = 0; i < progress.needed; i++) {
            const filled = i < progress.count;
            const pip = this.scene.add.circle(
                startX + i * spacing,
                0,
                2.5,
                filled ? 0x6ec5ff : 0x1a2b1e,
                filled ? 0.95 : 0.55,
            );
            pip.setStrokeStyle(1, 0x6ec5ff, 0.9);
            children.push(pip);
        }
        const group = this.scene.add.container(cx, topY, children);
        group.setDepth(8700);
        this.pipGroup = group;
        if (this.reducedMotion) {
            this.scene.time.delayedCall(1100, () => {
                if (this.pipGroup === group) {
                    this.pipGroup = null;
                }
                group.destroy();
            });
            return;
        }
        group.y = topY + 4;
        group.setAlpha(0);
        this.scene.tweens.add({
            targets: group,
            y: topY,
            alpha: 1,
            duration: 160,
            ease: "Cubic.easeOut",
        });
        this.scene.tweens.add({
            targets: group,
            alpha: 0,
            delay: 950,
            duration: 260,
            onComplete: () => {
                if (this.pipGroup === group) {
                    this.pipGroup = null;
                }
                group.destroy();
            },
        });
    }

    /**
     * A PAID pour lands (the panel ledger already spent the 💧): grow the splash, animate
     * every stage change, celebrate fresh blooms, and show progress pips at the aim.
     */
    applyPour(aimX: number, aimY: number): PourResult {
        const result = applyPour(this.layout, this.counts, aimX, aimY, this.allowSpot);
        this.counts = result.counts;
        for (const change of result.changed) {
            const key = floraKey(change.spot.tileX, change.spot.tileY);
            if (change.stage !== change.prevStage && change.stage !== "none") {
                this.setSprite(key, change.spot, change.stage, true);
                if (change.stage === "bloom") {
                    this.bloomBurst(change.spot);
                }
            }
        }
        for (const bandId of result.bandsCompleted) {
            this.completedBands.add(bandId);
            this.celebrateBand(bandId);
            this.applyBandCompletionVisuals(bandId, this.reducedMotion);
        }
        this.moistureFx(aimX, aimY);
        this.showPips(aimX, aimY);
        return result;
    }

    // -----------------------------------------------------------------------------
    // The wind field — call once per frame from the world scene's update().
    // -----------------------------------------------------------------------------

    /** Ambient sway + glow breathing + the gust scheduler. Camera-culled, tween-aware. */
    tick(timeMs: number): void {
        if (this.reducedMotion) {
            return;
        }
        const view = this.scene.cameras.main.worldView;
        const minX = view.x - TILE_SIZE * 2;
        const maxX = view.right + TILE_SIZE * 2;
        const minY = view.y - TILE_SIZE * 2;
        const maxY = view.bottom + TILE_SIZE * 2;
        const t = timeMs * SWAY_SPEED;
        for (const [, entry] of this.sprites) {
            const s = entry.sprite;
            if (s.x < minX || s.x > maxX || s.y < minY || s.y > maxY) {
                continue;
            }
            if (timeMs < entry.busyUntil) {
                continue; // a rustle/gust/pop tween owns this sprite right now
            }
            s.setAngle(Math.sin(t + entry.swayPhase) * SWAY_AMP[entry.stage]);
            if (entry.glow) {
                entry.glow.setAlpha(
                    GLOW_BASE_ALPHA + Math.sin(t * 0.8 + entry.swayPhase) * GLOW_PULSE_ALPHA,
                );
            }
        }
        this.scheduleGust(timeMs);
    }

    /** Every GUST_INTERVAL, one completed band hosts a traveling wind wave. */
    private scheduleGust(timeMs: number): void {
        const slot = Math.floor(timeMs / GUST_INTERVAL_MS);
        if (slot === this.lastGustSlot || this.completedBands.size === 0) {
            return;
        }
        this.lastGustSlot = slot;
        const bands = [...this.completedBands].sort();
        const bandId = bands[slot % bands.length];
        this.gustBand(bandId);
    }

    /** The traveling lean: each flower down the line tips in sequence; blooms shed petals. */
    private gustBand(bandId: string): void {
        const order = bandWaveOrder(this.layout, bandId);
        order.forEach((tile, i) => {
            const entry = this.sprites.get(floraKey(tile.tileX, tile.tileY));
            if (!entry) {
                return;
            }
            this.scene.time.delayedCall(i * GUST_STEP_MS, () => {
                entry.busyUntil = this.scene.time.now + 420;
                this.scene.tweens.add({
                    targets: entry.sprite,
                    angle: { from: GUST_LEAN_DEG, to: -GUST_LEAN_DEG * 0.4 },
                    duration: 190,
                    yoyo: true,
                    ease: "Sine.easeInOut",
                    onComplete: () => entry.sprite.setAngle(0),
                });
                // Roughly every 4th bloom sheds a drifting petal on the gust.
                if (entry.stage === "bloom" && (tile.tileX + tile.tileY + i) % 4 === 0) {
                    this.shedPetal(entry, 1);
                }
            });
        });
    }

    /** One drifting petal — real petal art for Sakura, tinted fleck elsewhere. */
    private shedPetal(entry: FlowerSprite, direction: number): void {
        const { spot } = entry;
        const x = entry.baseX;
        const y = entry.baseY - TILE_SIZE * 0.4;
        let petal: Phaser.GameObjects.Image | Phaser.GameObjects.Arc;
        if (spot.section === "P-S") {
            const idx = Math.floor(floraHash(spot.tileX, spot.tileY, 1301) * 10);
            const img = this.scene.add.image(
                x,
                y,
                ensureTexture(this.scene, `fx-petal-${String(idx).padStart(2, "0")}`),
            );
            img.setOrigin(0.5, 0.5);
            sizeToHeightTiles(img, 0.16);
            petal = img;
        } else {
            petal = this.scene.add.circle(x, y, 2, spot.species.tint, 0.9);
        }
        petal.setDepth(8600);
        this.scene.tweens.add({
            targets: petal,
            x: x + direction * (14 + floraHash(spot.tileX, spot.tileY, 1302) * 10),
            y: y + 10,
            alpha: 0,
            angle: 140 * direction,
            duration: 900,
            ease: "Sine.easeIn",
            onComplete: () => petal.destroy(),
        });
    }

    // -----------------------------------------------------------------------------
    // Band completion — the magnificent moments.
    // -----------------------------------------------------------------------------

    /** The domino celebration: halo pops travel down the line (not a random scatter). */
    celebrateBand(bandId: string): void {
        if (this.reducedMotion) {
            return;
        }
        const order = bandWaveOrder(this.layout, bandId);
        order.forEach((tile, i) => {
            this.scene.time.delayedCall(i * 40, () => {
                const entry = this.sprites.get(floraKey(tile.tileX, tile.tileY));
                if (!entry) {
                    return;
                }
                const halo = this.scene.add.circle(
                    entry.baseX,
                    entry.baseY - TILE_SIZE * 0.35,
                    5,
                    0xffe066,
                    0.5,
                );
                halo.setDepth(8650);
                this.scene.tweens.add({
                    targets: halo,
                    scale: 2.2,
                    alpha: 0,
                    duration: 480,
                    onComplete: () => halo.destroy(),
                });
                this.shedPetal(entry, i % 2 === 0 ? 1 : -1);
            });
        });
    }

    /** Persistent per-garden completion visuals (also restored instantly at boot). */
    private applyBandCompletionVisuals(bandId: string, instant: boolean): void {
        const section = bandId.split(":")[0] as GardenSection;
        switch (section) {
            case "B-B":
                this.ribbonizeBand(bandId, instant);
                break;
            case "C-P":
                this.layGoldGravel(bandId);
                break;
            case "CARS":
                this.growVeins(bandId);
                break;
            case "P-S":
                break; // Hanami Banks lives in the recurring gusts + petals
            default: {
                const _exhaustive: never = section;
                return _exhaustive;
            }
        }
    }

    /** ENDLESS RIBBONS: align every clump to the row and widen it so neighbours touch —
     * the per-tile flowers fuse into one continuous unbroken color line. */
    private ribbonizeBand(bandId: string, instant: boolean): void {
        if (this.ribbonedBands.has(bandId)) {
            return;
        }
        this.ribbonedBands.add(bandId);
        const order = bandWaveOrder(this.layout, bandId);
        order.forEach((tile, i) => {
            const entry = this.sprites.get(floraKey(tile.tileX, tile.tileY));
            if (!entry) {
                return;
            }
            const aligned = this.alignedAnchorFor(entry.spot);
            const targetWidth = TILE_SIZE * RIBBON_WIDTH_TILES;
            const apply = (): void => {
                entry.baseX = aligned.x;
                entry.baseY = aligned.y;
                entry.sprite.setFlipX(entry.spot.tileX % 2 === 0);
                if (instant) {
                    entry.sprite.setPosition(aligned.x, aligned.y);
                    entry.sprite.setDisplaySize(targetWidth, entry.sprite.displayHeight);
                    entry.glow?.setPosition(aligned.x, aligned.y - TILE_SIZE * 0.3);
                    return;
                }
                entry.busyUntil = this.scene.time.now + 340;
                this.scene.tweens.add({
                    targets: entry.sprite,
                    x: aligned.x,
                    y: aligned.y,
                    displayWidth: targetWidth,
                    duration: 300,
                    ease: "Sine.easeOut",
                });
            };
            if (instant) {
                apply();
            } else {
                this.scene.time.delayedCall(i * GUST_STEP_MS, apply);
            }
        });
    }

    /** EMBROIDERY PARTERRE: persistent gold-gravel glints settle between a completed
     * ring's roses (two deterministic flecks per tile, forever). */
    private layGoldGravel(bandId: string): void {
        if (this.gravelByBand.has(bandId)) {
            return;
        }
        const container = this.scene.add.container(0, 0);
        container.setDepth(-3);
        for (const tile of this.bandTiles(bandId)) {
            for (let i = 0; i < 2; i++) {
                const gx = tile.tileX * TILE_SIZE
                    + 4 + floraHash(tile.tileX, tile.tileY, 1400 + i) * (TILE_SIZE - 8);
                const gy = tile.tileY * TILE_SIZE
                    + 4 + floraHash(tile.tileX, tile.tileY, 1410 + i) * (TILE_SIZE - 8);
                const fleck = this.scene.add.circle(gx, gy, 1.5, 0xe7c860, 0.6);
                container.add(fleck);
            }
        }
        this.gravelByBand.set(bandId, container);
        if (!this.reducedMotion) {
            container.setAlpha(0);
            this.scene.tweens.add({ targets: container, alpha: 1, duration: 900 });
        }
    }

    /** BIOLUMINAL VEINS: a glowing root-vein traces the completed drift's chain, plus one
     * reach toward the Supertrees anchor. Persistent; alpha breathes in tick(). */
    private growVeins(bandId: string): void {
        if (this.veinsByBand.has(bandId)) {
            return;
        }
        const order = bandWaveOrder(this.layout, bandId);
        if (order.length === 0) {
            return;
        }
        const g = this.scene.add.graphics();
        g.setBlendMode(Phaser.BlendModes.ADD);
        g.setDepth(-3.5);
        const px = (t: TileCoord): [number, number] => [
            t.tileX * TILE_SIZE + TILE_SIZE / 2,
            t.tileY * TILE_SIZE + TILE_SIZE * 0.7,
        ];
        g.lineStyle(2, 0x35c4ac, 0.5);
        const [sx, sy] = px(order[0]);
        g.beginPath();
        g.moveTo(sx, sy);
        for (let i = 1; i < order.length; i++) {
            const [x, y] = px(order[i]);
            g.lineTo(x, y);
        }
        g.strokePath();
        // The reach: drift centroid toward the Supertrees.
        const anchor = this.anchors.CARS;
        if (anchor) {
            let cx = 0;
            let cy = 0;
            for (const t of order) {
                cx += t.tileX;
                cy += t.tileY;
            }
            cx /= order.length;
            cy /= order.length;
            g.lineStyle(2, 0x8a5cf6, 0.35);
            g.beginPath();
            g.moveTo(cx * TILE_SIZE + TILE_SIZE / 2, cy * TILE_SIZE + TILE_SIZE / 2);
            g.lineTo(
                anchor.tileX * TILE_SIZE + TILE_SIZE / 2,
                anchor.tileY * TILE_SIZE + TILE_SIZE * 0.8,
            );
            g.strokePath();
        }
        g.setAlpha(this.reducedMotion ? 0.3 : 0);
        this.veinsByBand.set(bandId, g);
        if (!this.reducedMotion) {
            this.scene.tweens.add({
                targets: g,
                alpha: { from: 0, to: 0.55 },
                duration: 1100,
                yoyo: true,
                repeat: -1,
                ease: "Sine.easeInOut",
            });
        }
    }

    // -----------------------------------------------------------------------------
    // Rustle (walk-through) — unchanged behavior, tween-ownership aware.
    // -----------------------------------------------------------------------------

    /**
     * Rustle flowers the avatar is walking through: a quick wiggle (angle sway) with a
     * per-flower cooldown, plus one drifting petal off bloomed flowers. Call every frame
     * while the avatar is moving; guards keep it cheap.
     */
    rustle(worldX: number, worldY: number): void {
        if (this.reducedMotion) {
            return;
        }
        const now = this.scene.time.now;
        const ax = worldX / TILE_SIZE;
        const ay = (worldY - TILE_SIZE * 0.5) / TILE_SIZE;
        const tx = Math.floor(ax);
        const ty = Math.floor(ay);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const entry = this.sprites.get(floraKey(tx + dx, ty + dy));
                if (!entry || now - entry.lastRustle < RUSTLE_COOLDOWN_MS) {
                    continue;
                }
                const fx = entry.spot.tileX + 0.5;
                const fy = entry.spot.tileY + 0.5;
                if (Math.hypot(fx - ax, fy - ay) > RUSTLE_RADIUS) {
                    continue;
                }
                entry.lastRustle = now;
                this.rustleTween(entry, ax < fx ? 1 : -1);
            }
        }
    }

    private rustleTween(entry: FlowerSprite, direction: number): void {
        const sprite = entry.sprite;
        entry.busyUntil = this.scene.time.now + 600;
        this.scene.tweens.add({
            targets: sprite,
            angle: { from: 7 * direction, to: -5 * direction },
            duration: 90,
            yoyo: true,
            repeat: 2,
            ease: "Sine.easeInOut",
            onComplete: () => sprite.setAngle(0),
        });
        // Bloomed flowers shed one petal as you brush through.
        if (entry.stage === "bloom") {
            this.shedPetal(entry, direction);
        }
    }

    destroy(): void {
        for (const [, entry] of this.sprites) {
            entry.sprite.destroy();
            entry.glow?.destroy();
        }
        this.sprites.clear();
        this.pipGroup?.destroy();
        this.pipGroup = null;
        for (const [, c] of this.gravelByBand) {
            c.destroy();
        }
        this.gravelByBand.clear();
        for (const [, g] of this.veinsByBand) {
            g.destroy();
        }
        this.veinsByBand.clear();
    }
}
