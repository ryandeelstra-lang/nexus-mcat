// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the ground-flora RENDER layer (watering redesign, 2026-07-03). Pure logic
// lives in flora.ts; this class owns the Phaser side: lazily-built flower sprites, the
// grow/bloom animations, the pour moisture + droplet-pip feedback over the aimed tile,
// and the walk-through RUSTLE. Everything here is cosmetic (I4) and honors reduced
// motion (I9): stages snap, nothing wiggles, pips render statically.
import type Phaser from "phaser";

import { ensureTexture, sizeToHeightTiles } from "./assets";
import {
    applyPour,
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
} from "./flora";
import { TILE_SIZE } from "./worldgen";

/** Flowers sit just above ground decals and below plots/avatar at the same row. */
const DEPTH_OFFSET = 0.3;
/** Radius (tiles) around the avatar in which flowers rustle while walking. */
const RUSTLE_RADIUS = 1.05;
/** Minimum ms between rustles of the same flower. */
const RUSTLE_COOLDOWN_MS = 420;

interface FlowerSprite {
    spot: FlowerSpot;
    stage: FloraStage;
    sprite: Phaser.GameObjects.Image;
    lastRustle: number;
}

export class FloraLayer {
    private scene: Phaser.Scene;
    private layout: FloraLayout;
    private counts: FloraCounts;
    private reducedMotion: boolean;
    private allowSpot: (spot: FlowerSpot) => boolean;
    private sprites = new Map<string, FlowerSprite>();
    private pipGroup: Phaser.GameObjects.Container | null = null;

    constructor(
        scene: Phaser.Scene,
        layout: FloraLayout,
        initialCounts: FloraCounts,
        reducedMotion: boolean,
        allowSpot: (spot: FlowerSpot) => boolean = () => true,
    ) {
        this.scene = scene;
        this.layout = layout;
        this.counts = { ...initialCounts };
        this.reducedMotion = reducedMotion;
        this.allowSpot = allowSpot;
        this.syncAll();
    }

    /** The persisted record (the app layer writes it through to the sidecar). */
    snapshotCounts(): FloraCounts {
        return { ...this.counts };
    }

    /** Tile coordinates of one color band (celebration fx walks along them). */
    bandTiles(bandId: string): Array<{ tileX: number; tileY: number }> {
        return (this.layout.bands.get(bandId) ?? []).map((key) => {
            const spot = this.layout.spots.get(key)!;
            return { tileX: spot.tileX, tileY: spot.tileY };
        });
    }

    /** Build sprites for every already-watered tile (boot / restore). No animation. */
    private syncAll(): void {
        for (const [key, spot] of this.layout.spots) {
            const stage = floraStage(this.counts[key] ?? 0, spot.watersNeeded);
            if (stage !== "none") {
                this.setSprite(key, spot, stage, false);
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

    private setSprite(key: string, spot: FlowerSpot, stage: FloraStage, animate: boolean): void {
        const texture = ensureTexture(this.scene, floraTextureKey(spot.species, stage));
        const existing = this.sprites.get(key);
        if (existing) {
            existing.stage = stage;
            existing.sprite.setTexture(texture);
            sizeToHeightTiles(existing.sprite, floraHeightTiles(spot.species, stage));
            if (animate && !this.reducedMotion) {
                this.popTween(existing.sprite);
            }
            return;
        }
        const { x, y } = this.anchorFor(spot);
        const sprite = this.scene.add.image(x, y, texture);
        sprite.setOrigin(0.5, 1);
        sizeToHeightTiles(sprite, floraHeightTiles(spot.species, stage));
        sprite.setFlipX(floraHash(spot.tileX, spot.tileY, 1203) < 0.5);
        sprite.setDepth(spot.tileY + DEPTH_OFFSET);
        this.sprites.set(key, { spot, stage, sprite, lastRustle: 0 });
        if (animate && !this.reducedMotion) {
            this.popTween(sprite);
        }
    }

    /** Squash-and-stretch pop on any growth step. */
    private popTween(sprite: Phaser.GameObjects.Image): void {
        const sx = sprite.scaleX;
        const sy = sprite.scaleY;
        sprite.setScale(sx * 0.4, sy * 0.4);
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
        const wet = this.scene.add.ellipse(cx, cy, TILE_SIZE * 2.6, TILE_SIZE * 2.0, 0x2b3d2a, 0.28);
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
        this.moistureFx(aimX, aimY);
        this.showPips(aimX, aimY);
        return result;
    }

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
            const { x, y } = this.anchorFor(entry.spot);
            const petal = this.scene.add.circle(x, y - TILE_SIZE * 0.4, 2, entry.spot.species.tint, 0.9);
            petal.setDepth(8600);
            this.scene.tweens.add({
                targets: petal,
                x: x + direction * 10,
                y: y + 2,
                alpha: 0,
                angle: 120,
                duration: 640,
                ease: "Sine.easeIn",
                onComplete: () => petal.destroy(),
            });
        }
    }

    destroy(): void {
        for (const [, entry] of this.sprites) {
            entry.sprite.destroy();
        }
        this.sprites.clear();
        this.pipGroup?.destroy();
        this.pipGroup = null;
    }
}
