// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the ground-flora RENDER layer. Watering redesign + mass-bloom concepts
// (2026-07-03, all "A"), rebuilt same day around MERGED BEDS ("everything doesn't
// merge" fix): bloomed ground is painted as a continuous carpet (flora-carpet.ts) that
// fills each tile edge-to-edge and flows into same-species neighbors — long unbroken
// drifts of color, never per-tile potted clumps. Sparse HERO clumps (real art, per
// species heroDensity) rise from the carpet and carry the life:
//   P-S  HANAMI BANKS      — waterline gradient; gust waves travel the shoreline lines,
//                            petals shed on the gust.
//   B-B  ENDLESS RIBBONS   — the carpet itself fuses each two-row band into one
//                            continuous color ribbon; gusts roll down it.
//   C-P  EMBROIDERY PARTERRE — completed rings lay persistent gold-gravel glints.
//   CARS BIOLUMINAL VEINS  — hero orchids breathe additive glow; completed drifts grow
//                            a glowing root-vein chain reaching toward the Supertrees.
// Shared: heroes/shoots sway on a spatial wind field; band completions celebrate as a
// traveling domino down the line. Pure logic lives in flora.ts. Everything here is
// cosmetic (I4) and honors reduced motion (I9): stages snap, nothing sways, carpet and
// veins render static.
import Phaser from "phaser";

import { ensureTexture, sizeToHeightTiles } from "./assets";
import {
    applyPour,
    bandBloomFraction,
    bandWaveOrder,
    bedEdges,
    type FloraCounts,
    floraHash,
    floraHeightTiles,
    floraKey,
    type FloraLayout,
    type FloraStage,
    floraStage,
    floraTextureKey,
    type FlowerSpot,
    isHeroTile,
    pourProgress,
    type PourResult,
    sectionBloomFraction,
} from "./flora";
import { FloraCarpet } from "./flora-carpet";
import type { GardenSection, TileCoord } from "./worldgen";
import { TILE_SIZE } from "./worldgen";

/** Radius (tiles) around the avatar in which flowers rustle while walking. */
const RUSTLE_RADIUS = 1.05;
/** Minimum ms between rustles of the same flower/carpet tile. */
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
/** Stagger between neighbouring tiles as the gust travels (ms). */
const GUST_STEP_MS = 26;
/** Extra lean a gust adds on top of the ambient sway (deg). */
const GUST_LEAN_DEG = 9;

// --- Glow (CARS heroes) ----------------------------------------------------------------
const GLOW_BASE_ALPHA = 0.2;
const GLOW_PULSE_ALPHA = 0.12;
const GLOW_HEIGHT_TILES = 1.25;

interface FlowerSprite {
    spot: FlowerSpot;
    stage: FloraStage;
    sprite: Phaser.GameObjects.Image;
    baseX: number;
    baseY: number;
    /** Spatial wind phase (radians). */
    swayPhase: number;
    lastRustle: number;
    /** While now < busyUntil a tween owns the angle; the wind field skips it. */
    busyUntil: number;
    /** Additive glow (CARS hero blooms). */
    glow?: Phaser.GameObjects.Image;
}

export class FloraLayer {
    private scene: Phaser.Scene;
    private layout: FloraLayout;
    private counts: FloraCounts;
    private reducedMotion: boolean;
    private allowSpot: (spot: FlowerSpot) => boolean;
    /** Landmark anchors (CARS Supertrees) for section-level ambience. */
    private anchors: Partial<Record<GardenSection, TileCoord>>;
    /** Standing sprites: every sprout/bud shoot + bloomed HERO clumps only. */
    private sprites = new Map<string, FlowerSprite>();
    /** The merged-bed paint layer (bud sprinkle + full bloom carpet). */
    private carpet: FloraCarpet;
    private pipGroup: Phaser.GameObjects.Container | null = null;
    private completedBands = new Set<string>();
    private gravelByBand = new Map<string, Phaser.GameObjects.Container>();
    private veinsByBand = new Map<string, Phaser.GameObjects.Graphics>();
    private carpetRustle = new Map<string, number>();
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
        this.carpet = new FloraCarpet(scene);
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

    private stageAt(spot: FlowerSpot): FloraStage {
        return floraStage(
            this.counts[floraKey(spot.tileX, spot.tileY)] ?? 0,
            spot.watersNeeded,
        );
    }

    /** Restore everything from persisted counts (boot). No animation. */
    private syncAll(): void {
        for (const [key, spot] of this.layout.spots) {
            const stage = floraStage(this.counts[key] ?? 0, spot.watersNeeded);
            if (stage === "none") {
                continue;
            }
            this.carpet.paintCell(spot, stage, bedEdges(this.layout, this.counts, spot));
            if (this.wantsStandingSprite(spot, stage)) {
                this.setSprite(key, spot, stage, false);
            }
        }
        this.carpet.flush();
        for (const bandId of this.layout.bands.keys()) {
            if (bandBloomFraction(this.layout, this.counts, bandId) >= 1) {
                this.completedBands.add(bandId);
                this.applyBandCompletionVisuals(bandId);
            }
        }
    }

    /** Sprout/bud shoots always stand; at bloom only HERO tiles keep a tall clump —
     * everything else becomes pure carpet so drifts merge with no per-tile repetition. */
    private wantsStandingSprite(spot: FlowerSpot, stage: FloraStage): boolean {
        if (stage === "sprout" || stage === "bud") {
            return true;
        }
        return stage === "bloom" && isHeroTile(spot);
    }

    /** Deterministic sub-tile jitter so heroes read organic, never grid-stamped. */
    private anchorFor(spot: FlowerSpot): { x: number; y: number } {
        const jx = (floraHash(spot.tileX, spot.tileY, 1201) - 0.5) * 10;
        const jy = (floraHash(spot.tileX, spot.tileY, 1202) - 0.5) * 6;
        return {
            x: spot.tileX * TILE_SIZE + TILE_SIZE / 2 + jx,
            y: (spot.tileY + 1) * TILE_SIZE - 2 + jy,
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
        // Pixel-Y depth layering (collision redesign 2026-07-03): sort by feet position.
        sprite.setDepth(y / TILE_SIZE);
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

    private removeSprite(key: string): void {
        const entry = this.sprites.get(key);
        if (!entry) {
            return;
        }
        entry.glow?.destroy();
        entry.sprite.destroy();
        this.sprites.delete(key);
    }

    /** CARS hero blooms breathe with an additive glow (Bioluminal Veins). */
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
        glow.setDepth(entry.baseY / TILE_SIZE - 0.05);
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

    /** The bloom moment for one tile: petal burst + a soft ring (species-tinted). */
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
     * A PAID pour lands (the panel ledger already spent the 💧): grow the splash, repaint
     * the merged bed, animate stage changes, celebrate fresh blooms + completed bands.
     */
    applyPour(aimX: number, aimY: number): PourResult {
        const result = applyPour(this.layout, this.counts, aimX, aimY, this.allowSpot);
        this.counts = result.counts;

        // Repaint changed cells AND their grown same-species neighbors (their shared
        // edges just connected), deduped per pour.
        const repaint = new Map<string, FlowerSpot>();
        for (const change of result.changed) {
            const key = floraKey(change.spot.tileX, change.spot.tileY);
            repaint.set(key, change.spot);
            for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
                const nKey = floraKey(change.spot.tileX + dx, change.spot.tileY + dy);
                const n = this.layout.spots.get(nKey);
                if (n && n.species.id === change.spot.species.id) {
                    repaint.set(nKey, n);
                }
            }
        }
        for (const [, spot] of repaint) {
            const stage = this.stageAt(spot);
            if (stage === "bud" || stage === "bloom") {
                this.carpet.paintCell(spot, stage, bedEdges(this.layout, this.counts, spot));
            }
        }
        this.carpet.flush();

        for (const change of result.changed) {
            if (change.stage === change.prevStage || change.stage === "none") {
                continue;
            }
            const key = floraKey(change.spot.tileX, change.spot.tileY);
            if (this.wantsStandingSprite(change.spot, change.stage)) {
                this.setSprite(key, change.spot, change.stage, true);
            } else {
                // Carpet-only bloom: the shoot folds into the painted bed.
                this.removeSprite(key);
            }
            if (change.stage === "bloom") {
                this.bloomBurst(change.spot);
            }
        }

        for (const bandId of result.bandsCompleted) {
            this.completedBands.add(bandId);
            this.celebrateBand(bandId);
            this.applyBandCompletionVisuals(bandId);
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

    /** The traveling wave: heroes tip in sequence down the line; carpet tiles release
     * drifting petals as the gust passes over them. */
    private gustBand(bandId: string): void {
        const order = bandWaveOrder(this.layout, bandId);
        order.forEach((tile, i) => {
            const key = floraKey(tile.tileX, tile.tileY);
            const entry = this.sprites.get(key);
            this.scene.time.delayedCall(i * GUST_STEP_MS, () => {
                if (entry) {
                    entry.busyUntil = this.scene.time.now + 420;
                    this.scene.tweens.add({
                        targets: entry.sprite,
                        angle: { from: GUST_LEAN_DEG, to: -GUST_LEAN_DEG * 0.4 },
                        duration: 190,
                        yoyo: true,
                        ease: "Sine.easeInOut",
                        onComplete: () => entry.sprite.setAngle(0),
                    });
                }
                // Carpet petals ride the gust (~every 4th tile).
                const spot = this.layout.spots.get(key);
                if (spot && (tile.tileX + tile.tileY + i) % 4 === 0) {
                    this.shedPetalAt(spot, 1);
                }
            });
        });
    }

    /** One drifting petal — real petal art for Sakura, tinted fleck elsewhere. */
    private shedPetalAt(spot: FlowerSpot, direction: number): void {
        const x = spot.tileX * TILE_SIZE + TILE_SIZE / 2;
        const y = (spot.tileY + 1) * TILE_SIZE - 2 - TILE_SIZE * 0.4;
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

    /** The domino celebration: gold halo pops travel down the line in order. */
    celebrateBand(bandId: string): void {
        if (this.reducedMotion) {
            return;
        }
        const order = bandWaveOrder(this.layout, bandId);
        order.forEach((tile, i) => {
            this.scene.time.delayedCall(i * 40, () => {
                const spot = this.layout.spots.get(floraKey(tile.tileX, tile.tileY));
                if (!spot) {
                    return;
                }
                const cx = tile.tileX * TILE_SIZE + TILE_SIZE / 2;
                const cy = (tile.tileY + 1) * TILE_SIZE - TILE_SIZE * 0.4;
                const halo = this.scene.add.circle(cx, cy, 5, 0xffe066, 0.5);
                halo.setDepth(8650);
                this.scene.tweens.add({
                    targets: halo,
                    scale: 2.2,
                    alpha: 0,
                    duration: 480,
                    onComplete: () => halo.destroy(),
                });
                this.shedPetalAt(spot, i % 2 === 0 ? 1 : -1);
            });
        });
    }

    /** Persistent per-garden completion visuals (also restored instantly at boot).
     * B-B needs nothing extra — the merged carpet IS the endless ribbon. */
    private applyBandCompletionVisuals(bandId: string): void {
        const section = bandId.split(":")[0] as GardenSection;
        switch (section) {
            case "C-P":
                this.layGoldGravel(bandId);
                break;
            case "CARS":
                this.growVeins(bandId);
                break;
            case "B-B":
            case "P-S":
                break;
            default: {
                const _exhaustive: never = section;
                return _exhaustive;
            }
        }
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
     * reach toward the Supertrees anchor. Persistent; alpha breathes via tween. */
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
    // Rustle (walk-through).
    // -----------------------------------------------------------------------------

    /**
     * Rustle what the avatar walks through: standing sprites wiggle; pure-carpet bloom
     * tiles release a petal underfoot. Per-tile cooldowns keep it cheap and calm.
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
                const key = floraKey(tx + dx, ty + dy);
                const entry = this.sprites.get(key);
                if (entry) {
                    if (now - entry.lastRustle < RUSTLE_COOLDOWN_MS) {
                        continue;
                    }
                    const fx = entry.spot.tileX + 0.5;
                    const fy = entry.spot.tileY + 0.5;
                    if (Math.hypot(fx - ax, fy - ay) > RUSTLE_RADIUS) {
                        continue;
                    }
                    entry.lastRustle = now;
                    this.rustleTween(entry, ax < fx ? 1 : -1);
                    continue;
                }
                // Pure-carpet bloomed tile underfoot → a petal brushes loose.
                const spot = this.layout.spots.get(key);
                if (!spot || this.stageAt(spot) !== "bloom") {
                    continue;
                }
                const last = this.carpetRustle.get(key) ?? 0;
                if (now - last < RUSTLE_COOLDOWN_MS * 2) {
                    continue;
                }
                if (Math.hypot(spot.tileX + 0.5 - ax, spot.tileY + 0.5 - ay) > RUSTLE_RADIUS) {
                    continue;
                }
                this.carpetRustle.set(key, now);
                this.shedPetalAt(spot, ax < spot.tileX + 0.5 ? 1 : -1);
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
        // Bloomed heroes shed one petal as you brush through.
        if (entry.stage === "bloom") {
            this.shedPetalAt(entry.spot, direction);
        }
    }

    destroy(): void {
        for (const [, entry] of this.sprites) {
            entry.sprite.destroy();
            entry.glow?.destroy();
        }
        this.sprites.clear();
        this.carpet.destroy();
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
