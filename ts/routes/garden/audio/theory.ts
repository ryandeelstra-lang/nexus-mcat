// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the PURE music brain for the adaptive lofi score (docs/26 G4.3; doc 23 §11).
// Everything here is deterministic and node-safe — no Web Audio, no DOM — so the whole
// "what should the music be right now" decision is unit-testable. The Web Audio graph
// (lofi-engine.ts) and the orchestrator (music-director.ts) consume these values; they
// never invent musical decisions of their own.
//
// Integrity fit (docs/26 §1): the score is a PRESENTATION layer, exactly like the living
// sky (doc 23 §9.5). It READS environment signals (region, device local time, activity)
// and drives sound; it reads/writes NO engine truth. It is procedurally generated, so it
// ships zero binary audio assets — license-clean by construction (the G5.1 audit lever).

/** The four great gardens = the four MCAT sections (doc 23 §9.3). */
export type RegionId = "sakura" | "keukenhof" | "versailles" | "gardens-by-the-bay";

export const REGION_IDS: readonly RegionId[] = [
    "sakura",
    "keukenhof",
    "versailles",
    "gardens-by-the-bay",
];

/** A chord = absolute MIDI notes to voice, plus the bass root to anchor it. */
export interface Chord {
    name: string;
    /** Voiced notes (MIDI), mid-register — the electric-piano/pad layer plays these. */
    notes: number[];
    /** Bass root (MIDI), usually an octave or two below the voicing. */
    bass: number;
}

/**
 * A region's musical identity. Distinct key/mode/tempo/timbre per garden so the score
 * audibly "changes with your environment" as you cross a border (doc 23 §9.3 palettes).
 */
export interface RegionProfile {
    id: RegionId;
    /** Human label (for logs / the future audio settings panel). */
    label: string;
    /** Beats per minute — lofi study tempo band (68–78). */
    bpm: number;
    /** Swing amount 0.5 (straight) → ~0.62 (heavy shuffle) applied to off-8ths. */
    swing: number;
    /** The 4-bar chord loop (one chord per bar). */
    progression: Chord[];
    /** MIDI pitch-classes the sparse lead may pick from (the region's scale). */
    leadScale: number[];
    /** Base octave (MIDI) the lead plucks sit in. */
    leadOctave: number;
    /** 0..1 chance a given bar spawns a lead pluck phrase (density of melody). */
    leadDensity: number;
    /** Lead timbre: pluck (koto-ish, short) vs bell (soft, longer) vs marimba. */
    leadVoice: "pluck" | "bell" | "marimba";
    /** Electric-piano detune spread (cents) — a touch of chorus warmth. */
    keysDetuneCents: number;
}

const C = 60; // MIDI middle C, the reference anchor for the voicings below.

/** min9 / maj9 / dom13-flavored voicings keep the lofi jazz color across every region. */
function chord(name: string, bass: number, notes: number[]): Chord {
    return { name, bass, notes };
}

/**
 * Region profiles. Colors chosen to echo each garden's mood (doc 23 §3, §9.3):
 *   Sakura   — wistful, transient (F# minor pentatonic, koto plucks, slow)
 *   Keukenhof— bursting, bright   (C lydian/major, warm keys, most melody)
 *   Versailles—ordered, precise   (D dorian, structured marimba, medium)
 *   Bay      — twilight, dreamy   (E minor lush pads, sparse bells, slowest)
 */
export const REGION_PROFILES: Record<RegionId, RegionProfile> = {
    sakura: {
        id: "sakura",
        label: "Sakura Garden",
        bpm: 70,
        swing: 0.58,
        // F#m9 – Dmaj9 – E6/9 – C#m7  (wistful, resolving-but-never-settled)
        progression: [
            chord("F#m9", 42, [C - 6, C - 2, C + 1, C + 4, C + 8]),
            chord("Dmaj9", 38, [C - 3, C + 1, C + 4, C + 8, C + 11]),
            chord("E6/9", 40, [C - 1, C + 2, C + 6, C + 9, C + 11]),
            chord("C#m7", 37, [C - 4, C, C + 3, C + 8]),
        ],
        // F# minor pentatonic (F# A B C# E)
        leadScale: [6, 9, 11, 1, 4],
        leadOctave: 72,
        leadDensity: 0.45,
        leadVoice: "pluck",
        keysDetuneCents: 6,
    },
    keukenhof: {
        id: "keukenhof",
        label: "Keukenhof",
        bpm: 76,
        swing: 0.56,
        // Cmaj9 – Am9 – Fmaj7#11 – G13  (open, bright, hopeful)
        progression: [
            chord("Cmaj9", 36, [C, C + 4, C + 7, C + 11, C + 14]),
            chord("Am9", 33, [C - 3, C, C + 4, C + 7, C + 11]),
            chord("Fmaj7#11", 29, [C - 7, C - 3, C, C + 4, C + 6]),
            chord("G13", 31, [C - 5, C - 1, C + 2, C + 5, C + 9]),
        ],
        // C major / lydian-ish (C D E F# G A B)
        leadScale: [0, 2, 4, 6, 7, 9, 11],
        leadOctave: 72,
        leadDensity: 0.6,
        leadVoice: "marimba",
        keysDetuneCents: 8,
    },
    versailles: {
        id: "versailles",
        label: "Versailles",
        bpm: 74,
        swing: 0.54,
        // Dm9 – Gm7 – Bbmaj7 – A7b9  (formal, symmetric, a little regal tension)
        progression: [
            chord("Dm9", 38, [C - 10, C - 7, C - 3, C, C + 4]),
            chord("Gm7", 31, [C - 5, C - 2, C + 2, C + 5]),
            chord("Bbmaj7", 34, [C - 2, C + 2, C + 5, C + 9]),
            chord("A7b9", 33, [C - 3, C + 1, C + 4, C + 7, C + 8]),
        ],
        // D dorian (D E F G A B C)
        leadScale: [2, 4, 5, 7, 9, 11, 0],
        leadOctave: 74,
        leadDensity: 0.5,
        leadVoice: "marimba",
        keysDetuneCents: 4,
    },
    "gardens-by-the-bay": {
        id: "gardens-by-the-bay",
        label: "Gardens by the Bay",
        bpm: 68,
        swing: 0.6,
        // Em9 – Cmaj7#11 – Am11 – B7sus  (contemplative twilight glow)
        progression: [
            chord("Em9", 40, [C - 5, C - 1, C + 2, C + 6, C + 9]),
            chord("Cmaj7#11", 36, [C, C + 4, C + 6, C + 11]),
            chord("Am11", 33, [C - 3, C, C + 5, C + 7, C + 10]),
            chord("B7sus", 35, [C - 1, C + 4, C + 6, C + 9]),
        ],
        // E minor (E F# G A B C D)
        leadScale: [4, 6, 7, 9, 11, 0, 2],
        leadOctave: 76,
        leadDensity: 0.35,
        leadVoice: "bell",
        keysDetuneCents: 10,
    },
};

/** Best-effort map from a sidecar section string → its themed region (doc 23 §9.3). */
export function regionForSection(section: string): RegionId {
    const s = section.toUpperCase();
    if (s.includes("P") && s.includes("S")) { return "sakura"; // Psych/Soc
     }
    if (s.startsWith("B")) { return "keukenhof"; // Bio/Biochem
     }
    if (s.includes("C") && s.includes("P")) { return "versailles"; // Chem/Phys
     }
    if (s.includes("CARS") || s.startsWith("CA")) { return "gardens-by-the-bay"; }
    return "sakura"; // v1 default region (docs/26 G1)
}

// ─────────────────────────────────────────────────────────────────────────────
// The living-sky clock (doc 23 §9.5) — the exact 4 knobs, reused so the music and
// the visual sky always agree on time-of-day. Purely cosmetic; device local time.
// ─────────────────────────────────────────────────────────────────────────────

export interface SkyClock {
    /** Night window start hour (sun down). Doc 23 §9.5 firm constraint: 4 AM. */
    nightStartHour: number;
    /** Night window end hour (sunrise). Doc 23 §9.5: 8 AM. */
    nightEndHour: number;
}

export const SKY: SkyClock = { nightStartHour: 4, nightEndHour: 8 };

export interface SkyState {
    /** True during the 4-hour night window (4:00–8:00 local). */
    isNight: boolean;
    /**
     * Position through the 20-hour daylight window, 0 at sunrise (8 AM) → 1 at sunset
     * (4 AM next day). During night this is 0. Peak sun (6 PM) sits at 0.5.
     */
    dayProgress: number;
    /** 0 (deep night) → 1 (golden 6 PM peak): the master "brightness" of the moment. */
    brightness: number;
}

/** Fractional local hour (0..24), pure given an explicit Date. */
export function localHour(date: Date): number {
    return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** Compute the sky state from a Date (doc 23 §9.5 table). Deterministic + testable. */
export function skyState(date: Date, clock: SkyClock = SKY): SkyState {
    const h = localHour(date);
    const { nightStartHour: ns, nightEndHour: ne } = clock;
    if (h >= ns && h < ne) {
        return { isNight: true, dayProgress: 0, brightness: 0.12 };
    }
    // Daylight window: [ne .. ns+24), length 24 - (ne - ns) hours (default 20h).
    const dayHours = 24 - (ne - ns);
    const sinceSunrise = h >= ne ? h - ne : h + 24 - ne;
    const dayProgress = clamp01(sinceSunrise / dayHours);
    // Raised cosine peaking at the midpoint (0.5 → 6 PM), floored so day never goes dark.
    const arc = 0.5 - 0.5 * Math.cos(dayProgress * 2 * Math.PI); // 0 at ends, 1 at mid
    const brightness = 0.35 + 0.65 * arc;
    return { isNight: false, dayProgress, brightness };
}

// ─────────────────────────────────────────────────────────────────────────────
// Activity → mood. The garden bus tells us WHAT the player is doing; we translate
// that into how present each musical layer should be (a lofi "adaptive mix").
// ─────────────────────────────────────────────────────────────────────────────

/**
 * wandering — full lofi bed (the default overworld vibe).
 * studying  — the card panel is open at the Keeper: pull melody/drums back so the
 *             score becomes true, non-distracting study background (I8's spirit for
 *             audio — never fight the MCAT text).
 * bloom     — the paraphrase-gate bloom moment: duck the whole bed hard for a beat so
 *             the bloom chime rings out (doc 23 §9.4/§11 contrast rule, "duck under bloom").
 * harvest   — session-end summary: a warmer, fuller resolve.
 */
export type Mood = "wandering" | "studying" | "bloom" | "harvest";

/** Per-layer target gains (0..1, pre-master). The engine crossfades toward these. */
export interface LayerMix {
    pad: number;
    keys: number;
    bass: number;
    drums: number;
    lead: number;
    vinyl: number;
}

/** Baseline "full bed" mix, before time-of-day + mood adjustments. */
const BASE_MIX: LayerMix = {
    pad: 0.55,
    keys: 0.5,
    bass: 0.6,
    drums: 0.5,
    lead: 0.45,
    vinyl: 0.32,
};

function scaleMix(mix: LayerMix, f: Partial<LayerMix>): LayerMix {
    return {
        pad: mix.pad * (f.pad ?? 1),
        keys: mix.keys * (f.keys ?? 1),
        bass: mix.bass * (f.bass ?? 1),
        drums: mix.drums * (f.drums ?? 1),
        lead: mix.lead * (f.lead ?? 1),
        vinyl: mix.vinyl * (f.vinyl ?? 1),
    };
}

/**
 * The core "environment brain": given the sky + what the player is doing, produce the
 * target layer mix and the master low-pass "warmth" cutoff. This is the single function
 * the director leans on every tick, and it is fully pure/testable.
 */
export interface ToneTargets {
    mix: LayerMix;
    /** Master low-pass cutoff (Hz). Night = darker/warmer; golden peak = brightest. */
    cutoffHz: number;
}

export function toneTargets(sky: SkyState, mood: Mood): ToneTargets {
    let mix = { ...BASE_MIX };

    // Time-of-day shaping: night is sparse, warm, vinyl-forward; day is full + bright.
    if (sky.isNight) {
        mix = scaleMix(mix, { drums: 0.4, lead: 0.5, pad: 1.15, vinyl: 1.35 });
    } else {
        // Lerp drum/lead presence with brightness so dawn is gentle, 6 PM is lively.
        const b = sky.brightness;
        mix = scaleMix(mix, {
            drums: 0.6 + 0.4 * b,
            lead: 0.7 + 0.3 * b,
            pad: 1.1 - 0.1 * b,
            vinyl: 1.15 - 0.25 * b,
        });
    }

    // Mood shaping (multiplicative so it composes with time-of-day).
    switch (mood) {
        case "wandering":
            break;
        case "studying":
            // Recede: keep a soft pad + beat + vinyl, tuck melody away for focus.
            mix = scaleMix(mix, { keys: 0.5, lead: 0.15, drums: 0.55, pad: 1.05 });
            break;
        case "bloom":
            // Duck the bed hard for the chime's contrast moment.
            mix = scaleMix(mix, {
                pad: 0.35,
                keys: 0.25,
                bass: 0.4,
                drums: 0.2,
                lead: 0.15,
                vinyl: 0.6,
            });
            break;
        case "harvest":
            // Fuller, warmer resolve.
            mix = scaleMix(mix, { pad: 1.15, keys: 1.15, lead: 1.1, drums: 1.05 });
            break;
        default: {
            const _exhaustive: never = mood;
            return _exhaustive;
        }
    }

    mix = clampMix(mix);

    // Warmth: 700 Hz (deep night) → ~2600 Hz (golden peak). Studying/bloom pull it down
    // for a mellower, less "present" background.
    let cutoffHz = 700 + 1900 * sky.brightness;
    if (mood === "studying") { cutoffHz *= 0.7; }
    if (mood === "bloom") { cutoffHz *= 0.55; }
    cutoffHz = clamp(cutoffHz, 500, 4000);

    return { mix, cutoffHz };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small pure helpers (also exercised by the engine).
// ─────────────────────────────────────────────────────────────────────────────

/** MIDI note → frequency (Hz), A4 (69) = 440. */
export function midiToFreq(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

export function clamp(x: number, lo: number, hi: number): number {
    if (x < lo) {
        return lo;
    }
    if (x > hi) {
        return hi;
    }
    return x;
}

export function clamp01(x: number): number {
    return clamp(x, 0, 1);
}

function clampMix(mix: LayerMix): LayerMix {
    return {
        pad: clamp01(mix.pad),
        keys: clamp01(mix.keys),
        bass: clamp01(mix.bass),
        drums: clamp01(mix.drums),
        lead: clamp01(mix.lead),
        vinyl: clamp01(mix.vinyl),
    };
}
