// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the graded-wilt visual (living-decay spec 2026-07-05). The shipped
// per-theme drooping PNG stays the ONLY art; deeper decay reads through runtime
// transforms on that sprite — extra lean, a dry straw tint, a slight sag. Never
// red, never dead: level 1 is exactly the art as shipped (doc 23 §8 "thirsty").
import type { WiltLevel } from "../state/stage";

export interface WiltVisual {
    /** Extra lean in degrees (origin is the plant base, so it tips at the stem). */
    angle: number;
    /** Multiply tint pulling the art toward dry straw; null = untouched. */
    tint: number | null;
    /** Vertical sag factor applied AFTER applyDisplaySize; 1 = none. */
    sag: number;
}

export const WILT_VISUALS: Record<WiltLevel, WiltVisual> = {
    1: { angle: 0, tint: null, sag: 1 },
    2: { angle: 6, tint: 0xd9d4b8, sag: 1 },
    3: { angle: 11, tint: 0xc9c09a, sag: 0.92 },
};

/** The slice of Phaser.GameObjects.Image we touch (duck-typed: tests need no canvas). */
export interface WiltSprite {
    displayWidth: number;
    displayHeight: number;
    setAngle(deg: number): unknown;
    setTint(color: number): unknown;
    clearTint(): unknown;
    setDisplaySize(w: number, h: number): unknown;
}

/**
 * Apply (or, with null, fully clear) a wilt level. Call AFTER setTexture +
 * applyDisplaySize on every restage — a recovered plant must snap back upright
 * the instant it is watered (doc 23 §8 reversibility).
 */
export function applyWilt(sprite: WiltSprite, level: WiltLevel | null): void {
    const v = level === null ? null : WILT_VISUALS[level];
    sprite.setAngle(v ? v.angle : 0);
    if (v?.tint != null) {
        sprite.setTint(v.tint);
    } else {
        sprite.clearTint();
    }
    if (v && v.sag !== 1) {
        sprite.setDisplaySize(sprite.displayWidth, sprite.displayHeight * v.sag);
    }
}
