// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: realistic world collision (2026-07-03). Two ideas, both pure:
//
//   1. BASE BOXES — a sprite blocks only at its FEET (a small box at the bottom of its
//      trunk/base), never its full image. Walk north of a bush and your body overlaps its
//      canopy (the bush draws over you via pixel-Y depth); walk south and you draw over it.
//      The box is much narrower than the sprite so brushing past feels natural.
//
//   2. SLIDE MOVEMENT — the avatar's own feet are a small box, moved one axis at a time.
//      Pressing diagonally into a wall keeps the free axis moving (the classic glide), so
//      you never "stick" to a hedge you're pushing against. Large frame deltas are
//      sub-stepped so a slow frame can't tunnel through a thin box.
//
// No Phaser here — the world scene feeds it boxes and a blocked() probe; tests drive it
// directly.

export interface SolidBox {
    left: number;
    top: number;
    w: number;
    h: number;
}

export function boxesOverlap(a: SolidBox, b: SolidBox): boolean {
    return (
        a.left < b.left + b.w
        && a.left + a.w > b.left
        && a.top < b.top + b.h
        && a.top + a.h > b.top
    );
}

/** The avatar's collision footprint: a small box at the feet (x = center, y = soles). */
export const FOOT_W = 14;
export const FOOT_H = 8;

export function footBoxAt(x: number, y: number): SolidBox {
    return { left: x - FOOT_W / 2, top: y - FOOT_H, w: FOOT_W, h: FOOT_H };
}

/**
 * A sprite's base box from its rendered footprint: `widthFactor` of the display width
 * (clamped), `heightPx` tall, anchored at the bottom-center the world uses for depth.
 */
export function baseBoxFor(
    bottomCenterX: number,
    bottomY: number,
    displayWidth: number,
    opts?: { widthFactor?: number; heightPx?: number; maxWidthPx?: number; minWidthPx?: number },
): SolidBox {
    const widthFactor = opts?.widthFactor ?? 0.5;
    const heightPx = opts?.heightPx ?? 13;
    const maxWidthPx = opts?.maxWidthPx ?? 72;
    const minWidthPx = opts?.minWidthPx ?? 8;
    const w = Math.max(minWidthPx, Math.min(maxWidthPx, displayWidth * widthFactor));
    return { left: bottomCenterX - w / 2, top: bottomY - heightPx, w, h: heightPx };
}

/** Largest per-substep travel; anything bigger is split so thin boxes can't be tunnelled. */
const MAX_STEP_PX = 4;

/**
 * Move a point with axis-separated sliding: X first, then Y, each sub-stepped. `blocked`
 * answers "would feet at (x, y) collide?". A blocked axis stops for the rest of the frame;
 * the other keeps going — pushing diagonally against a wall glides along it.
 */
export function moveWithSlide(
    x: number,
    y: number,
    dx: number,
    dy: number,
    blocked: (x: number, y: number) => boolean,
): { x: number; y: number } {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_STEP_PX));
    const sx = dx / steps;
    const sy = dy / steps;
    let cx = x;
    let cy = y;
    let xBlocked = sx === 0;
    let yBlocked = sy === 0;
    // ESCAPE RULE (2026-07-03 QA): a sub-step is refused only when it would take FREE feet
    // into a collision. Feet that are ALREADY overlapping something (a regression or a bad
    // teleport landed us inside geometry) may always move — walking any direction carries you
    // out instead of trapping you forever, and the moment the current spot is clear, normal
    // blocking resumes. Trade-off: while embedded you could cross other solids on the way out;
    // acceptable because the embedded state itself is only reachable through a bug, and the
    // alternative (a permanent softlock) is strictly worse.
    for (let i = 0; i < steps && (!xBlocked || !yBlocked); i++) {
        if (!xBlocked) {
            if (blocked(cx + sx, cy) && !blocked(cx, cy)) {
                xBlocked = true;
            } else {
                cx += sx;
            }
        }
        if (!yBlocked) {
            if (blocked(cx, cy + sy) && !blocked(cx, cy)) {
                yBlocked = true;
            } else {
                cy += sy;
            }
        }
    }
    return { x: cx, y: cy };
}

/**
 * First candidate the probe reports open, or null when every candidate is blocked.
 * Teleports should then stay put — forcing a landing inside geometry (or outside the
 * world rim) is how softlocks are born.
 */
export function firstOpenSpot(
    candidates: ReadonlyArray<{ x: number; y: number }>,
    blocked: (x: number, y: number) => boolean,
): { x: number; y: number } | null {
    for (const c of candidates) {
        if (!blocked(c.x, c.y)) {
            return c;
        }
    }
    return null;
}
