// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: intro cinematic timeline — "The Keeper's Garden" (video/STORYBOARD.md).
// Pure functions of t (seconds). No Phaser. Everything the scene and the DOM overlay
// render derives from these, so any frame can be sought deterministically.

export const FPS = 30;
export const DURATION = 72;
export const TOTAL_FRAMES = DURATION * FPS;

export const VIEW_W = 1920;
export const VIEW_H = 1080;

// ---------------------------------------------------------------------------
// Easing + deterministic RNG
// ---------------------------------------------------------------------------

export function clamp01(v: number): number {
    if (v < 0) {
        return 0;
    }
    return v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function easeInOut(t: number): number {
    const u = clamp01(t);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

export function easeOut(t: number): number {
    const u = clamp01(t);
    return 1 - Math.pow(1 - u, 3);
}

/** Normalized 0→1 progress of t through [from, to]. */
export function span(t: number, from: number, to: number): number {
    return clamp01((t - from) / (to - from));
}

/** mulberry32 — deterministic stream per seed. */
export function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let x = Math.imul(a ^ (a >>> 15), 1 | a);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

export const BEATS = {
    firstLight: { from: 0, to: 8 },
    careSakura: { from: 8, to: 16 },
    peakVersailles: { from: 16, to: 20 },
    peakGbtb: { from: 20, to: 24 },
    departure: { from: 24, to: 31 },
    longSleep: { from: 31, to: 50 },
    student: { from: 50, to: 62 },
    begin: { from: 62, to: 72 },
} as const;

// ---------------------------------------------------------------------------
// Painterly establishing backdrops (region hero art) — Ken Burns segments
// ---------------------------------------------------------------------------

export interface BackdropCue {
    key: string;
    fadeInFrom: number;
    fadeInTo: number;
    fadeOutFrom: number;
    fadeOutTo: number;
    /** Ken Burns: scale + drift (fractions of viewport) across the segment. */
    scaleFrom: number;
    scaleTo: number;
    driftX: number;
    driftY: number;
}

export const BACKDROPS: readonly BackdropCue[] = [
    {
        key: "bg-keukenhof-establishing",
        fadeInFrom: 0,
        fadeInTo: 0,
        fadeOutFrom: 7.4,
        fadeOutTo: 8.4,
        scaleFrom: 1.34,
        scaleTo: 1.46,
        driftX: -0.03,
        driftY: -0.02,
    },
    {
        key: "bg-versailles-establishing",
        fadeInFrom: 15.6,
        fadeInTo: 16.5,
        fadeOutFrom: 19.4,
        fadeOutTo: 20.2,
        scaleFrom: 1.32,
        scaleTo: 1.42,
        driftX: 0.028,
        driftY: -0.018,
    },
    {
        key: "bg-gardens-by-the-bay-establishing",
        fadeInFrom: 19.4,
        fadeInTo: 20.2,
        fadeOutFrom: 23.2,
        fadeOutTo: 24.4,
        scaleFrom: 1.42,
        scaleTo: 1.32,
        driftX: -0.024,
        driftY: 0.02,
    },
] as const;

export function backdropAlpha(cue: BackdropCue, t: number): number {
    if (t < cue.fadeInFrom || t > cue.fadeOutTo) {
        return 0;
    }
    const fin = cue.fadeInTo > cue.fadeInFrom ? span(t, cue.fadeInFrom, cue.fadeInTo) : 1;
    const fout = 1 - span(t, cue.fadeOutFrom, cue.fadeOutTo);
    return clamp01(Math.min(fin, fout));
}

export function backdropPose(cue: BackdropCue, t: number): { scale: number; ox: number; oy: number } {
    const u = span(t, cue.fadeInFrom, cue.fadeOutTo);
    return {
        scale: lerp(cue.scaleFrom, cue.scaleTo, u),
        ox: lerp(0, cue.driftX, u),
        oy: lerp(0, cue.driftY, u),
    };
}

// ---------------------------------------------------------------------------
// Virtual clock — minutes of day fed into the game's own skyStateFor()
// ---------------------------------------------------------------------------

/** Piecewise virtual clock (minutes 0..1440). Night window is 4–8 AM (daynight.ts). */
export function virtualClockMinutes(t: number): number {
    if (t < 8) {
        // Behind the opening backdrop; warm in case of early cross-fade
        return 16 * 60 + 40;
    }
    if (t < 16) {
        return lerp(10 * 60, 10 * 60 + 30, span(t, 8, 16)); // morning, the Keeper at work
    }
    if (t < 24) {
        return 18 * 60; // covered by the Versailles/GBTB backdrops
    }
    if (t < 31) {
        return lerp(3 * 60, 3 * 60 + 40, span(t, 24, 31)); // dusk
    }
    if (t < 47.5) {
        // ~6 strobing day/night cycles, landing on 05:00 night
        const u = span(t, 31, 47.5);
        const total = 6 * 1440 - 180;
        return (480 + u * total) % 1440;
    }
    if (t < 50) {
        return 5 * 60; // cold still night
    }
    if (t < 53) {
        return lerp(7 * 60 + 50, 8 * 60 + 20, span(t, 50, 53)); // the one sunrise
    }
    if (t < 62) {
        return lerp(8 * 60 + 35, 9 * 60 + 30, span(t, 53, 62)); // morning
    }
    return lerp(9 * 60 + 30, 11 * 60, span(t, 62, 72)); // brightening morning
}

export function virtualDate(t: number): Date {
    const m = Math.floor(virtualClockMinutes(t));
    return new Date(2026, 3, 1, Math.floor(m / 60), m % 60);
}

// ---------------------------------------------------------------------------
// Camera rail (world pixels; 32px tiles, world 120x90 tiles)
// ---------------------------------------------------------------------------

export interface CameraPose {
    x: number;
    y: number;
    zoom: number;
}

const TILE = 32;

export function tilePx(tileX: number, tileY: number): { x: number; y: number } {
    return { x: tileX * TILE + TILE / 2, y: tileY * TILE + TILE / 2 };
}

/** Sakura trail y for a given tile x (mirror of worldgen trailSakura, region at 0,0 w58 h42). */
export function sakuraTrailY(x: number): number {
    const streamY = 23;
    return streamY + Math.round(Math.sin(x * 0.35) * 2) - 3;
}

/** Keukenhof trail x for a given tile y (canal at x=82). */
export function keukenhofTrailX(y: number): number {
    return 86 + Math.round(Math.sin(y * 0.4) * 2);
}

/** GBTB skyway walk y (region y48 h42). */
export const GBTB_WALK_Y = 66;

export const KEEPER_HOME = { tileX: 60, tileY: 45 };

// -- Actor paths ------------------------------------------------------------

export interface ActorState {
    x: number;
    y: number;
    alpha: number;
    /** true when translating (adds a stride bob) */
    moving: boolean;
}

/** The Keeper through beats 2–3. Returns null when off-stage. */
export function keeperAt(t: number): ActorState | null {
    // Beat 2 — Sakura morning: walk the trail, tend the hero plant, walk on.
    if (t >= 8 && t < 16) {
        let x: number;
        let moving = true;
        if (t < 9.5) {
            x = lerp(16, 23, easeInOut(span(t, 8, 9.5)));
        } else if (t < 12.5) {
            x = 23; // kneeling at the hero plant
            moving = false;
        } else {
            x = lerp(23, 31, easeInOut(span(t, 12.5, 16)));
        }
        const y = sakuraTrailY(Math.round(x));
        const p = tilePx(x, y);
        return { x: p.x, y: p.y + TILE / 2, alpha: 1, moving };
    }
    // Beat 3 — departure: center → south gate (pause) → into the fog, fading.
    if (t >= 24 && t < 31) {
        let ty: number;
        let moving = true;
        if (t < 27.5) {
            ty = lerp(46, 58, easeInOut(span(t, 24, 27.5)));
        } else if (t < 28.5) {
            ty = 58; // the look back
            moving = false;
        } else {
            ty = lerp(58, 63, span(t, 28.5, 31));
        }
        const alpha = t < 28.5 ? 1 : 1 - easeInOut(span(t, 28.5, 30.6));
        const p = tilePx(60, ty);
        return { x: p.x, y: p.y + TILE / 2, alpha, moving };
    }
    return null;
}

/** The student (gardener avatar), beats 5–6. */
export function studentAt(t: number): ActorState | null {
    if (t < 52) {
        return null;
    }
    if (t < 62) {
        const p = tilePx(60, 72);
        const alpha = easeOut(span(t, 52, 54.5));
        return { x: p.x, y: p.y + TILE / 2, alpha, moving: false };
    }
    // Beat 6: walk north up the plaza path.
    const ty = lerp(72, 61, easeInOut(span(t, 62, 71)));
    const p = tilePx(60, ty);
    return { x: p.x, y: p.y + TILE / 2, alpha: 1, moving: true };
}

// -- Camera -----------------------------------------------------------------

export function cameraAt(t: number): CameraPose {
    // Beat 1 — aerial pull across the blooming world.
    if (t < 8) {
        const u = easeInOut(span(t, 0, 8));
        return {
            x: lerp(930, 1920, u),
            y: lerp(620, 1400, u),
            zoom: lerp(1.25, 0.78, u),
        };
    }
    // Beat 2 — ground-level Sakura vignette, camera glued to the Keeper (game zoom).
    if (t < 24) {
        const k = keeperAt(t);
        if (k) {
            // While he tends, ease onto the midpoint of Keeper + hero plant and
            // push in for an intimate close-up.
            if (t >= 9.5 && t < 12.5) {
                const plant = tilePx(24, 21);
                const u = easeInOut(span(t, 9.5, 10.5));
                return {
                    x: lerp(k.x, (k.x + plant.x) / 2, u),
                    y: lerp(k.y, (k.y + plant.y) / 2, u),
                    zoom: lerp(2.2, 2.7, u),
                };
            }
            // Walking segments: slightly tighter than game zoom, easing out after the tend.
            const settle = t >= 12.5 ? lerp(2.7, 2.2, easeInOut(span(t, 12.5, 13.6))) : 2.2;
            return { x: k.x, y: k.y - 24, zoom: settle };
        }
        // 16–24: covered by the Versailles/GBTB backdrops.
        const p = tilePx(60, 52);
        return { x: p.x, y: p.y, zoom: 1.5 };
    }
    // Beat 3 — fixed frame on the south plaza run.
    if (t < 31) {
        const p = tilePx(60, 52);
        return { x: p.x, y: p.y, zoom: 1.5 };
    }
    // Beat 4 — locked wide.
    if (t < 50) {
        return { x: 1920, y: 1400, zoom: 0.62 };
    }
    // Beat 5 — sunrise hold, then dolly onto the student.
    if (t < 62) {
        if (t < 52) {
            return { x: 1920, y: 1400, zoom: 0.62 };
        }
        const u = easeInOut(span(t, 52, 61));
        return {
            x: 1936,
            y: lerp(2180, 2320, u),
            zoom: lerp(1.6, 2.4, u),
        };
    }
    // Beat 6 — ease into the game's spawn framing beside the Keeper clearing.
    const u = easeInOut(span(t, 62, 69));
    const s = studentAt(t);
    const from = { x: 1936, y: 2320 };
    const spawn = tilePx(61, 47);
    return {
        x: lerp(s ? s.x : from.x, spawn.x, u),
        y: lerp(s ? s.y - 24 : from.y, spawn.y, u),
        zoom: lerp(2.4, 2, easeInOut(span(t, 62, 65))),
    };
}

// ---------------------------------------------------------------------------
// Deterioration (beat 4) — stage index per plant as a wave from the edges in
// ---------------------------------------------------------------------------

const WORLD_W_TILES = 120;
const WORLD_H_TILES = 90;

/** 0 = at a world edge, 1 = world center. */
function centerProximity(tileX: number, tileY: number): number {
    const dx = Math.min(tileX, WORLD_W_TILES - tileX) / (WORLD_W_TILES / 2);
    const dy = Math.min(tileY, WORLD_H_TILES - tileY) / (WORLD_H_TILES / 2);
    return clamp01(Math.min(dx, dy));
}

export type CineStage =
    | "bare-soil"
    | "sprout"
    | "seedling"
    | "growing"
    | "budding"
    | "bloomed"
    | "weedy";

/**
 * Stage for a plant at time t. Perfect bloom through beat 3; regression wave
 * bloomed → weedy → bare-soil through beat 4; bare after.
 */
export function plantStageAt(t: number, tileX: number, tileY: number, seed: number): CineStage {
    const jitter = rng(seed)() * 2.2;
    const onset = 31.5 + centerProximity(tileX, tileY) * 9 + jitter;
    const STEP = 2.6;
    if (t < onset) {
        return "bloomed";
    }
    if (t < onset + STEP) {
        return "weedy";
    }
    return "bare-soil";
}

/** Foliage/flower dressing fades out through the long sleep. */
export function dressingAlphaAt(t: number, seed: number): number {
    const jitter = rng(seed ^ 0x9e3779b9)() * 4;
    const from = 33 + jitter;
    return 1 - 0.85 * easeInOut(span(t, from, from + 9));
}

/** Scattered weeds fade IN during the long sleep and stay. */
export function weedAlphaAt(t: number, seed: number): number {
    const jitter = rng(seed ^ 0x51f15e3d)() * 5;
    const from = 36 + jitter;
    return 0.95 * easeInOut(span(t, from, from + 6));
}

/** Structure decay flips (barn full→empty, waystones dormant, gates locked). */
export const DECAY_FLIP_T = 38;

/** The south gate swings open for the student (beat 6 payoff). */
export const GATE_REOPEN_T = 63.5;

/** Extra multiply-darkness during the long sleep so gravel doesn't glow at night. */
export function nightCapAt(t: number): number {
    const rise = 0.3 * easeInOut(span(t, 33, 40));
    const fall = 0.3 * easeInOut(span(t, 50, 53));
    return clamp01(rise - fall);
}

/** Gray SATURATION-blend wash alpha (desaturation) through beat 4, easing back for sunrise. */
export function desaturationAt(t: number): number {
    const inWash = 0.6 * easeInOut(span(t, 31, 47));
    const recover = 0.35 * easeInOut(span(t, 50, 58));
    return clamp01(inWash - recover);
}

/** Fog layer alpha: departure wisps, thick through the sleep, thinning for the student. */
export function fogAt(t: number): number {
    const departure = 0.35 * easeInOut(span(t, 27, 31));
    const sleep = 0.25 * easeInOut(span(t, 34, 46));
    const thin = 0.42 * easeInOut(span(t, 52, 60));
    return clamp01(departure + sleep - thin);
}

// ---------------------------------------------------------------------------
// FX timings
// ---------------------------------------------------------------------------

/** Hero plant (sakura vignette): watering 9.6–11.2, bloom burst at 11.5. */
export const HERO_PLANT = { tileX: 24, tileY: 21 };
export const HERO_WATER = { from: 9.6, to: 11.2 };
export const HERO_BLOOM_T = 11.5;

export function heroStageAt(t: number): CineStage {
    if (t < BEATS.careSakura.from) {
        return "bloomed"; // aerial beat — everything blooms
    }
    if (t < HERO_BLOOM_T) {
        return "budding";
    }
    if (t < BEATS.longSleep.from) {
        return "bloomed";
    }
    return plantStageAt(t, HERO_PLANT.tileX, HERO_PLANT.tileY, 777);
}

/** The single sprout at the student's feet (beat 5). */
export const SPROUT_T = 58.5;
export const SPROUT_TILE = { tileX: 60, tileY: 70 };

// ---------------------------------------------------------------------------
// DOM overlay: titles, letterbox, white fades
// ---------------------------------------------------------------------------

export interface TitleCue {
    from: number;
    to: number;
    text: string;
    /** larger presentation for the closing line */
    hero?: boolean;
}

export const TITLES: readonly TitleCue[] = [
    { from: 2.2, to: 7.2, text: "Fifty years ago, there was a garden." },
    { from: 9.2, to: 13.4, text: "Its keeper tended every seed." },
    { from: 17.2, to: 22.6, text: "Nothing was forgotten." },
    { from: 24.5, to: 27.8, text: "But a garden this vast needs more than one pair of hands." },
    { from: 28.2, to: 30.8, text: "He left to find a student." },
    { from: 44.0, to: 49.0, text: "Fifty years passed." },
    { from: 65.5, to: 70.5, text: "The garden is waiting.", hero: true },
];

export function titleOpacity(cue: TitleCue, t: number): number {
    const FADE = 0.8;
    if (t < cue.from || t > cue.to) {
        return 0;
    }
    return Math.min(span(t, cue.from, cue.from + FADE), 1 - span(t, cue.to - FADE, cue.to));
}

/** Splash-art overlay (brand-splash-first-light): opens from it, closes into it. */
export function splashFadeAt(t: number): number {
    const open = 1 - easeInOut(span(t, 0.4, 2.2));
    const close = easeInOut(span(t, 70.2, 72));
    return clamp01(open + close);
}

/** Radial vignette strength behind the closing wordmark. */
export function vignetteAt(t: number): number {
    return clamp01(0.55 * Math.min(span(t, 64.5, 66.5), 1 - span(t, 70.2, 71.5)));
}

/** Letterbox bar height as a fraction of viewport height (retracts in beat 6). */
export function letterboxAt(t: number): number {
    return 0.1 * (1 - easeInOut(span(t, 62, 64.5)));
}

/** Wordmark opacity over the closing beat. */
export function wordmarkAt(t: number): number {
    return clamp01(Math.min(span(t, 65, 67), 1 - span(t, 70.8, 72)));
}
