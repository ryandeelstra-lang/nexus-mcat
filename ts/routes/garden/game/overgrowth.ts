// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: overgrowth — the absence-neglect ground layer (living-decay spec
// 2026-07-05). Grass tufts creep around OVERDUE plots after ≥1 full day away,
// scaled by how long the garden sat untended; they fade out passively as topics
// recover. DISTINCT from weeds (the protected error-cause mechanism, doc 18):
// no quest, no tag, no click — and weedy plots get NO tufts so the cause icon
// stays the focal care-state. Deterministic like the weather/critters: seeded
// per plot id, no runtime RNG. Muted straw-greens — never red (doc 23 §3).
import type Phaser from "phaser";

import type { GrowthStage } from "../state/stage";
import { DISPLAY, sizeToHeightTiles } from "./assets";

/** No tufts until a full day away — active players never watch neglect spawn. */
export const OVERGROWTH_MIN_DAYS = 1;
/** The ramp saturates here: five days reads as fully overgrown. */
export const OVERGROWTH_MAX_DAYS = 5;
export const OVERGROWTH_MAX_TUFTS = 6;

/** Deterministic per-index pseudo-random in [0, 1) (same trick weather.ts uses). */
function seeded(i: number, salt: number): number {
    const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/** FNV-ish string hash for a stable per-plot salt (same trick worldgen uses). */
function hashString(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** Tuft count for one plot. Engine truth in, a small bounded integer out. */
export function tuftCountFor(input: {
    daysAway: number;
    dueCount: number;
    stage: GrowthStage;
}): number {
    if (input.stage === "weedy" || input.dueCount <= 0) {
        return 0;
    }
    if (input.daysAway < OVERGROWTH_MIN_DAYS) {
        return 0;
    }
    const ramp = Math.min(input.daysAway, OVERGROWTH_MAX_DAYS) / OVERGROWTH_MAX_DAYS;
    const base = Math.round(ramp * (OVERGROWTH_MAX_TUFTS - 1));
    const boost = input.dueCount >= 10 ? 1 : 0;
    return Math.min(OVERGROWTH_MAX_TUFTS, Math.max(1, base + boost));
}

export interface TuftPlacement {
    /** Offset from the plot center, in tiles (spills onto neighboring tiles). */
    dx: number;
    dy: number;
    /** Tuft height in tiles — small, ground-hugging. */
    size: number;
    flip: boolean;
}

/** Seeded ring scatter around a plot — stable across boots, index-stable as the
 * count grows (placement i never moves, so fading in more tufts only ADDS). */
export function tuftPlacements(nodeId: string, count: number): TuftPlacement[] {
    const salt = hashString(nodeId) % 1000;
    const out: TuftPlacement[] = [];
    for (let i = 0; i < count; i++) {
        const angle = seeded(i, salt) * Math.PI * 2;
        const dist = 0.6 + seeded(i, salt + 1) * 0.9;
        out.push({
            dx: Math.cos(angle) * dist,
            // flattened vertically so the scatter reads as ground, not a halo
            dy: Math.sin(angle) * dist * 0.7,
            size: 0.28 + seeded(i, salt + 2) * 0.22,
            flip: seeded(i, salt + 3) > 0.5,
        });
    }
    return out;
}

/** Two tiny procedural tuft textures — dry-grass blades fanning from a base.
 * Procedural primitives are the as-built idiom for ambient ground/screen life
 * (weather streaks, critter arcs, frost canvas) — this is NOT plant-stage art. */
function buildTuftTextures(scene: Phaser.Scene): void {
    for (let variant = 0; variant < 2; variant++) {
        const key = `overgrowth-tuft-${String(variant).padStart(2, "0")}`;
        if (scene.textures.exists(key)) {
            continue;
        }
        const g = scene.add.graphics();
        // Muted straw-greens (doc 23 §3: neglect is dry, never red/dead).
        const colors = [0x8a9662, 0xa39d6b, 0x76855a];
        const blades = 4 + variant;
        for (let i = 0; i < blades; i++) {
            const bx = 2 + seeded(i, 40 + variant) * 12;
            const lean = (seeded(i, 42 + variant) - 0.5) * 6;
            const h = 6 + seeded(i, 44 + variant) * 5;
            g.fillStyle(colors[i % colors.length], 0.9);
            g.fillTriangle(bx - 1.2, 12, bx + 1.2, 12, bx + lean, 12 - h);
        }
        g.generateTexture(key, 16, 12);
        g.destroy();
    }
}

export interface OvergrowthPlotInput {
    nodeId: string;
    tileX: number;
    tileY: number;
    stage: GrowthStage;
    dueCount: number;
}

const TUFT_ALPHA = 0.9;
const FADE_MS = 350;

/**
 * The ground-neglect layer, owned by the world scene (the WeatherLayer pattern:
 * self-contained, destroyable, never touches sky/collision). World-space sprites,
 * walk-through, depth just under each plot's plant. `sync()` on boot and on every
 * mastery:refreshed — it diffs per plot and fades tufts in/out (snap when
 * reduced-motion). Tufts are STATE, not motion, so reduced-motion players still
 * see the overgrowth — only the fade is skipped.
 */
export class OvergrowthLayer {
    private scene: Phaser.Scene;
    private reducedMotion: boolean;
    private tufts = new Map<string, Phaser.GameObjects.Image[]>();

    constructor(scene: Phaser.Scene, reducedMotion: boolean) {
        this.scene = scene;
        this.reducedMotion = reducedMotion;
        buildTuftTextures(scene);
    }

    count(nodeId: string): number {
        return this.tufts.get(nodeId)?.length ?? 0;
    }

    sync(plots: OvergrowthPlotInput[], daysAway: number): void {
        const ts = DISPLAY.tile;
        for (const plot of plots) {
            const want = tuftCountFor({
                daysAway,
                dueCount: plot.dueCount,
                stage: plot.stage,
            });
            const have = this.tufts.get(plot.nodeId) ?? [];
            if (want === have.length) {
                continue;
            }
            if (want < have.length) {
                for (const img of have.slice(want)) {
                    this.fadeOut(img);
                }
                this.tufts.set(plot.nodeId, have.slice(0, want));
                continue;
            }
            const placements = tuftPlacements(plot.nodeId, want);
            for (let i = have.length; i < want; i++) {
                const p = placements[i];
                const x = (plot.tileX + 0.5 + p.dx) * ts;
                const y = (plot.tileY + 1 + p.dy) * ts;
                const variant = `overgrowth-tuft-${String(i % 2).padStart(2, "0")}`;
                const img = this.scene.add.image(x, y, variant);
                img.setOrigin(0.5, 1);
                sizeToHeightTiles(img, p.size);
                img.setFlipX(p.flip);
                // Just under the plot's plant (plants sit at y/ts) — behind the stem,
                // above the painted ground. Walk-through: no solid box, ever.
                img.setDepth(y / ts - 0.5);
                if (this.reducedMotion) {
                    img.setAlpha(TUFT_ALPHA);
                } else {
                    img.setAlpha(0);
                    this.scene.tweens.add({
                        targets: img,
                        alpha: TUFT_ALPHA,
                        duration: FADE_MS,
                        ease: "Sine.easeOut",
                    });
                }
                have.push(img);
            }
            this.tufts.set(plot.nodeId, have);
        }
    }

    private fadeOut(img: Phaser.GameObjects.Image): void {
        if (this.reducedMotion) {
            img.destroy();
            return;
        }
        this.scene.tweens.add({
            targets: img,
            alpha: 0,
            duration: FADE_MS,
            ease: "Sine.easeIn",
            onComplete: () => img.destroy(),
        });
    }

    destroy(): void {
        for (const imgs of this.tufts.values()) {
            for (const img of imgs) {
                img.destroy();
            }
        }
        this.tufts.clear();
    }
}
