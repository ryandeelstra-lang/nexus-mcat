// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: overgrowth — the absence-neglect ground layer (living-decay spec
// 2026-07-05). Grass tufts creep around OVERDUE plots after ≥1 full day away,
// scaled by how long the garden sat untended; they fade out passively as topics
// recover. DISTINCT from weeds (the protected error-cause mechanism, doc 18):
// no quest, no tag, no click — and weedy plots get NO tufts so the cause icon
// stays the focal care-state. Deterministic like the weather/critters: seeded
// per plot id, no runtime RNG. Muted straw-greens — never red (doc 23 §3).
import type { GrowthStage } from "../state/stage";

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
