// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: real-time sky state from local clock (doc 23 §9.5). Pure — no Phaser.

/** Night window: 4:00 AM – 8:00 AM local (§9.5). */
export const NIGHT_START_HOUR = 4;
export const NIGHT_END_HOUR = 8;
/** Solar peak at midpoint of the 20-hour day window = 6:00 PM (§9.5). */
export const PEAK_HOUR = 18;

export type SkyPhase =
    | "night"
    | "sunrise"
    | "morning"
    | "peak"
    | "evening"
    | "dusk";

export interface SkyState {
    phase: SkyPhase;
    /** Normalized 0→1 across the 20-hour sun-up window (§9.5). */
    dayProgress: number;
    tint: number;
    ambientAlpha: number;
    sunPosition: { t: number };
}

function minutesOfDay(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

function isNightMinutes(m: number): boolean {
    const start = NIGHT_START_HOUR * 60;
    const end = NIGHT_END_HOUR * 60;
    return m >= start && m < end;
}

/** Map clock minutes to dayProgress 0→1 for the 8:00–4:00 (next day) up-window. */
export function dayProgressForMinutes(m: number): number {
    const nightStart = NIGHT_START_HOUR * 60;
    const nightEnd = NIGHT_END_HOUR * 60;
    if (m >= nightStart && m < nightEnd) {
        return 0;
    }
    // After 8 AM same calendar day, or before 4 AM next cycle
    const upStart = nightEnd; // 8:00 = 480
    const upEnd = 24 * 60 + nightStart; // 4:00 next day = 1680
    let adjusted = m;
    if (m < nightStart) {
        adjusted = m + 24 * 60;
    }
    return (adjusted - upStart) / (upEnd - upStart);
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

function lerpColor(c1: number, c2: number, t: number): number {
    const r1 = (c1 >> 16) & 0xff;
    const g1 = (c1 >> 8) & 0xff;
    const b1 = c1 & 0xff;
    const r2 = (c2 >> 16) & 0xff;
    const g2 = (c2 >> 8) & 0xff;
    const b2 = c2 & 0xff;
    const r = Math.round(lerp(r1, r2, t));
    const g = Math.round(lerp(g1, g2, t));
    const bl = Math.round(lerp(b1, b2, t));
    return (r << 16) | (g << 8) | bl;
}

const COLORS = {
    night: 0x1a2844,
    sunrise: 0xffb088,
    morning: 0xfff4d6,
    peak: 0xffe066,
    evening: 0xc87840,
    dusk: 0x503868,
} as const;

function phaseForMinutes(m: number, progress: number): SkyPhase {
    if (isNightMinutes(m)) {
        return "night";
    }
    if (m >= NIGHT_END_HOUR * 60 && m < NIGHT_END_HOUR * 60 + 30) {
        return "sunrise";
    }
    if (progress < 0.35) {
        return "morning";
    }
    if (progress >= 0.45 && progress <= 0.55) {
        return "peak";
    }
    const hour = Math.floor(m / 60);
    if (hour >= 21 || hour < NIGHT_START_HOUR) {
        return progress > 0.85 ? "dusk" : "evening";
    }
    if (progress > 0.55 && progress <= 0.85) {
        return "evening";
    }
    return "morning";
}

function tintForPhase(phase: SkyPhase, progress: number): number {
    switch (phase) {
        case "night":
            return COLORS.night;
        case "sunrise":
            return lerpColor(COLORS.night, COLORS.sunrise, 0.7);
        case "morning":
            return lerpColor(COLORS.sunrise, COLORS.morning, Math.min(1, progress / 0.35));
        case "peak":
            return COLORS.peak;
        case "evening":
            return lerpColor(COLORS.peak, COLORS.evening, (progress - 0.55) / 0.3);
        case "dusk":
            return lerpColor(COLORS.evening, COLORS.dusk, Math.min(1, (progress - 0.85) / 0.15));
        default: {
            const _exhaustive: never = phase;
            return _exhaustive;
        }
    }
}

function ambientForPhase(phase: SkyPhase): number {
    switch (phase) {
        case "night":
            return 0.55;
        case "sunrise":
            return 0.25;
        case "morning":
            return 0.12;
        case "peak":
            return 0.08;
        case "evening":
            return 0.2;
        case "dusk":
            return 0.4;
        default: {
            const _exhaustive: never = phase;
            return _exhaustive;
        }
    }
}

/** Compute cosmetic sky state from device local time (§9.5). */
export function skyStateFor(date: Date): SkyState {
    const m = minutesOfDay(date);
    const night = isNightMinutes(m);
    const progress = night ? 0 : dayProgressForMinutes(m);
    const phase = phaseForMinutes(m, progress);
    return {
        phase,
        dayProgress: progress,
        tint: tintForPhase(phase, progress),
        ambientAlpha: ambientForPhase(phase),
        sunPosition: { t: progress },
    };
}
