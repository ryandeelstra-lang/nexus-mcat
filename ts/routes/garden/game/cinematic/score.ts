// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the intro cinematic's offline score. Reuses the game's music brain
// (theory.ts — the same region progressions, voicings, and lofi synth recipes as
// lofi-engine.ts) but schedules the full 72s deterministically into an
// OfflineAudioContext, beat-mapped to video/STORYBOARD.md. Zero binary assets.
import { type Chord, midiToFreq, REGION_PROFILES } from "../../audio/theory";
import { BEATS, DURATION, HERO_BLOOM_T, rng, SPROUT_T } from "./timeline";

const SAMPLE_RATE = 44100;
const BPM = 72;
const SEC_PER_BEAT = 60 / BPM;
const BAR = SEC_PER_BEAT * 4;
const SIXTEENTH = SEC_PER_BEAT / 4;
const SWING = 0.57;

type LayerName = "pad" | "keys" | "bass" | "drums" | "lead" | "vinyl";
const LAYER_NAMES: readonly LayerName[] = ["pad", "keys", "bass", "drums", "lead", "vinyl"];

interface SegmentMix {
    from: number;
    pad: number;
    keys: number;
    bass: number;
    drums: number;
    lead: number;
    vinyl: number;
    cutoffHz: number;
}

/**
 * The emotional arc, one row per storyboard movement (ramped over ~2s at each edge).
 *
 * `lead` is held at 0 across the whole film on purpose: the melodic lead (marimba/
 * bell/pluck) and the bloom chimes both route through `layers.lead`, and those pure
 * tones read as "high-pitch beeps" over the cinematic. Muting the layer keeps the
 * warm lofi bed (pad + keys + bass + drums + vinyl) while removing every beep.
 */
const SEGMENTS: readonly SegmentMix[] = [
    // Awe — the painted establishing shots. Pad + keys + hiss, no beat yet.
    { from: 0, pad: 0.6, keys: 0.45, bass: 0.35, drums: 0, lead: 0, vinyl: 0.4, cutoffHz: 2200 },
    // The Master's care — the full lofi bed wakes up.
    {
        from: BEATS.careSakura.from,
        pad: 0.55,
        keys: 0.5,
        bass: 0.6,
        drums: 0.45,
        lead: 0,
        vinyl: 0.32,
        cutoffHz: 2600,
    },
    // Departure — drums recede, melancholy.
    { from: BEATS.departure.from, pad: 0.6, keys: 0.4, bass: 0.5, drums: 0.18, lead: 0, vinyl: 0.4, cutoffHz: 1600 },
    // The long sleep — a cold, near-empty bed: pad + vinyl and little else.
    { from: BEATS.longSleep.from, pad: 0.5, keys: 0.12, bass: 0.25, drums: 0, lead: 0, vinyl: 0.5, cutoffHz: 900 },
    // Still night before sunrise — everything holds its breath.
    { from: 47.5, pad: 0.35, keys: 0.06, bass: 0.15, drums: 0, lead: 0, vinyl: 0.55, cutoffHz: 700 },
    // The student / sunrise — gentle rebuild.
    { from: BEATS.student.from, pad: 0.55, keys: 0.42, bass: 0.5, drums: 0.22, lead: 0, vinyl: 0.35, cutoffHz: 2000 },
    // Begin — warm full resolve.
    { from: BEATS.begin.from, pad: 0.62, keys: 0.55, bass: 0.6, drums: 0.42, lead: 0, vinyl: 0.3, cutoffHz: 2700 },
] as const;

/** Which region progression colors each stretch of the film. */
function progressionAt(
    t: number,
): {
    chords: Chord[];
    leadScale: number[];
    leadOctave: number;
    leadVoice: "pluck" | "bell" | "marimba";
    leadDensity: number;
} {
    if (t < BEATS.careSakura.from) {
        const p = REGION_PROFILES.keukenhof; // bright, hopeful awe
        return {
            chords: p.progression,
            leadScale: p.leadScale,
            leadOctave: p.leadOctave,
            leadVoice: "marimba",
            leadDensity: 0.3,
        };
    }
    if (t < BEATS.peakVersailles.from) {
        const p = REGION_PROFILES.sakura; // the koto care vignette
        return {
            chords: p.progression,
            leadScale: p.leadScale,
            leadOctave: p.leadOctave,
            leadVoice: "pluck",
            leadDensity: 0.55,
        };
    }
    if (t < BEATS.departure.from) {
        const p = REGION_PROFILES.versailles;
        return {
            chords: p.progression,
            leadScale: p.leadScale,
            leadOctave: p.leadOctave,
            leadVoice: "marimba",
            leadDensity: 0.5,
        };
    }
    if (t < BEATS.student.from) {
        const p = REGION_PROFILES["gardens-by-the-bay"]; // contemplative dusk + sleep
        return {
            chords: p.progression,
            leadScale: p.leadScale,
            leadOctave: p.leadOctave,
            leadVoice: "bell",
            leadDensity: t < BEATS.longSleep.from ? 0.35 : 0.15,
        };
    }
    const p = REGION_PROFILES.keukenhof; // the hopeful return
    return {
        chords: p.progression,
        leadScale: p.leadScale,
        leadOctave: p.leadOctave,
        leadVoice: "marimba",
        leadDensity: 0.5,
    };
}

interface Buses {
    ctx: OfflineAudioContext;
    layers: Record<LayerName, GainNode>;
    noise: AudioBuffer;
}

function makeNoise(ctx: OfflineAudioContext, seconds: number, rand: () => number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
        data[i] = rand() * 2 - 1;
    }
    return buf;
}

function makeImpulse(ctx: OfflineAudioContext, seconds: number, decay: number, rand: () => number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            data[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, decay);
        }
    }
    return buf;
}

function env(g: GainNode, time: number, peak: number, attack: number, release: number): void {
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + attack + release);
}

// ── voices (same recipes as lofi-engine.ts, offline-scheduled) ───────────────

function playPad(b: Buses, midis: number[], time: number, dur: number, detune: number, rand: () => number): void {
    for (const m of midis) {
        const osc = b.ctx.createOscillator();
        const g = b.ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.value = midiToFreq(m - 12);
        osc.detune.value = (rand() - 0.5) * detune;
        const lp = b.ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 900;
        osc.connect(lp);
        lp.connect(g);
        g.connect(b.layers.pad);
        env(g, time, 0.12, dur * 0.4, dur * 0.6);
        osc.start(time);
        osc.stop(time + dur + 0.1);
    }
}

function playKeys(b: Buses, midis: number[], time: number, dur: number, detune: number, vel = 1): void {
    for (const m of midis) {
        const a = b.ctx.createOscillator();
        const c = b.ctx.createOscillator();
        const g = b.ctx.createGain();
        a.type = "triangle";
        c.type = "sine";
        a.frequency.value = midiToFreq(m);
        c.frequency.value = midiToFreq(m);
        c.detune.value = detune;
        a.connect(g);
        c.connect(g);
        g.connect(b.layers.keys);
        env(g, time, 0.16 * vel, 0.01, dur);
        a.start(time);
        c.start(time);
        a.stop(time + dur + 0.1);
        c.stop(time + dur + 0.1);
    }
}

function playBass(b: Buses, midi: number, time: number, dur: number, vel = 1): void {
    const osc = b.ctx.createOscillator();
    const g = b.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = midiToFreq(midi - 12);
    osc.connect(g);
    g.connect(b.layers.bass);
    env(g, time, 0.4 * vel, 0.012, dur);
    osc.start(time);
    osc.stop(time + dur + 0.1);
}

function playLead(b: Buses, midi: number, time: number, dur: number, voice: "pluck" | "bell" | "marimba"): void {
    const osc = b.ctx.createOscillator();
    const g = b.ctx.createGain();
    osc.frequency.value = midiToFreq(midi);
    if (voice === "bell") {
        osc.type = "sine";
        const mod = b.ctx.createOscillator();
        const modGain = b.ctx.createGain();
        mod.frequency.value = midiToFreq(midi) * 2.01;
        modGain.gain.value = midiToFreq(midi) * 1.4;
        mod.connect(modGain);
        modGain.connect(osc.frequency);
        mod.start(time);
        mod.stop(time + dur + 0.2);
        env(g, time, 0.18, 0.005, dur * 1.6);
    } else if (voice === "marimba") {
        osc.type = "sine";
        env(g, time, 0.22, 0.004, dur * 0.8);
    } else {
        osc.type = "triangle";
        env(g, time, 0.2, 0.004, dur);
    }
    osc.connect(g);
    g.connect(b.layers.lead);
    osc.start(time);
    osc.stop(time + dur * 1.8 + 0.1);
}

function kick(b: Buses, time: number): void {
    const osc = b.ctx.createOscillator();
    const g = b.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    osc.connect(g);
    g.connect(b.layers.drums);
    env(g, time, 0.7, 0.004, 0.16);
    osc.start(time);
    osc.stop(time + 0.24);
}

function snare(b: Buses, time: number): void {
    const src = b.ctx.createBufferSource();
    src.buffer = b.noise;
    const bp = b.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = b.ctx.createGain();
    src.connect(bp);
    bp.connect(g);
    g.connect(b.layers.drums);
    env(g, time, 0.35, 0.003, 0.12);
    src.start(time);
    src.stop(time + 0.2);
}

function hat(b: Buses, time: number, vel: number): void {
    const src = b.ctx.createBufferSource();
    src.buffer = b.noise;
    const hp = b.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = b.ctx.createGain();
    src.connect(hp);
    hp.connect(g);
    g.connect(b.layers.drums);
    env(g, time, 0.14 * vel, 0.002, 0.03);
    src.start(time);
    src.stop(time + 0.08);
}

function pop(b: Buses, time: number): void {
    const src = b.ctx.createBufferSource();
    src.buffer = b.noise;
    const bp = b.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 3200;
    const g = b.ctx.createGain();
    src.connect(bp);
    bp.connect(g);
    g.connect(b.layers.vinyl);
    env(g, time, 0.5, 0.001, 0.02);
    src.start(time);
    src.stop(time + 0.05);
}

/** The bloom chime — a rising 3-note bell figure (the game's paraphrase-gate payoff). */
function chime(b: Buses, time: number, rootMidi: number): void {
    const steps = [0, 7, 12];
    steps.forEach((s, i) => {
        playLead(b, rootMidi + s, time + i * 0.16, 0.9, "bell");
    });
}

// ── the score itself ─────────────────────────────────────────────────────────

export async function renderScore(): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * DURATION), SAMPLE_RATE);
    const rand = rng(0x5c02e);

    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    const warmth = ctx.createBiquadFilter();
    const dryBus = ctx.createGain();
    const reverbReturn = ctx.createGain();

    warmth.type = "lowpass";
    warmth.Q.value = 0.6;
    limiter.threshold.value = -10;
    limiter.ratio.value = 4;
    limiter.attack.value = 0.006;
    limiter.release.value = 0.18;

    dryBus.connect(warmth);
    reverbReturn.connect(warmth);
    warmth.connect(limiter);
    limiter.connect(master);
    master.connect(ctx.destination);

    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx, 2.4, 2.2, rand);
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.22;
    dryBus.connect(reverbSend);
    reverbSend.connect(convolver);
    convolver.connect(reverbReturn);
    reverbReturn.gain.value = 0.9;

    const layers = LAYER_NAMES.reduce((acc, name) => {
        const g = ctx.createGain();
        g.gain.value = 0;
        g.connect(dryBus);
        acc[name] = g;
        return acc;
    }, {} as Record<LayerName, GainNode>);

    const buses: Buses = { ctx, layers, noise: makeNoise(ctx, 2, rand) };

    // Master arc: fade in over the splash, fade fully out into the closing splash.
    master.gain.setValueAtTime(0.0001, 0);
    master.gain.exponentialRampToValueAtTime(0.8, 1.6);
    master.gain.setValueAtTime(0.8, 69.5);
    master.gain.linearRampToValueAtTime(0.0001, DURATION - 0.05);

    // Layer mixes + warmth ramp segment-to-segment.
    warmth.frequency.setValueAtTime(SEGMENTS[0].cutoffHz, 0);
    for (const name of LAYER_NAMES) {
        layers[name].gain.setValueAtTime(SEGMENTS[0][name], 0);
    }
    for (let i = 1; i < SEGMENTS.length; i++) {
        const s = SEGMENTS[i];
        const rampStart = Math.max(0, s.from - 1);
        for (const name of LAYER_NAMES) {
            const g = layers[name].gain;
            g.setValueAtTime(SEGMENTS[i - 1][name], rampStart);
            g.linearRampToValueAtTime(s[name], s.from + 1);
        }
        warmth.frequency.setValueAtTime(SEGMENTS[i - 1].cutoffHz, rampStart);
        warmth.frequency.linearRampToValueAtTime(s.cutoffHz, s.from + 1);
    }

    // Continuous vinyl hiss bed.
    {
        const src = ctx.createBufferSource();
        src.buffer = buses.noise;
        src.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 2600;
        bp.Q.value = 0.4;
        const g = ctx.createGain();
        g.gain.value = 0.06;
        src.connect(bp);
        bp.connect(g);
        g.connect(layers.vinyl);
        src.start(0);
        src.stop(DURATION);
    }

    // The beat grid — one pass over every sixteenth of the 72 seconds.
    const totalSteps = Math.floor(DURATION / SIXTEENTH);
    let leadPhraseActive = false;
    for (let i = 0; i < totalSteps; i++) {
        const rawT = i * SIXTEENTH;
        const step = i % 16;
        const barIdx = Math.floor(i / 16);
        const prog = progressionAt(rawT);
        const chord = prog.chords[barIdx % prog.chords.length];
        const detune = 7;

        const swung = step % 4 === 2 ? rawT + (SWING - 0.5) * 2 * SIXTEENTH : rawT;
        const t = swung + (rand() - 0.5) * 0.008;
        if (t < 0 || t > DURATION - 0.3) {
            continue;
        }

        if (step === 0) {
            playPad(buses, chord.notes, t, BAR * 1.05, detune, rand);
            playKeys(buses, chord.notes, t, SIXTEENTH * 6, detune);
            leadPhraseActive = rand() < prog.leadDensity;
        }
        if (step === 10) {
            playKeys(buses, chord.notes, t, SIXTEENTH * 4, detune, 0.5);
        }

        if (step === 0) { playBass(buses, chord.bass, t, SIXTEENTH * 6); }
        if (step === 8) { playBass(buses, chord.bass, t, SIXTEENTH * 5); }
        if (step === 14) { playBass(buses, chord.bass + 7, t, SIXTEENTH * 2, 0.7); }

        if (step === 0 || step === 10) { kick(buses, t); }
        if (step === 4 || step === 12) { snare(buses, t); }
        if (step % 2 === 0) { hat(buses, t, step % 4 === 0 ? 0.5 : 0.32); }

        if (leadPhraseActive && (step === 4 || step === 7 || step === 12)) {
            if (rand() < 0.8) {
                const pc = prog.leadScale[Math.floor(rand() * prog.leadScale.length)];
                const midi = prog.leadOctave + pc + (rand() < 0.25 ? 12 : 0);
                playLead(buses, midi, t, SIXTEENTH * 3, prog.leadVoice);
            }
        }

        if (rand() < 0.05) { pop(buses, t); }
    }

    // Story accents: the hero-plant bloom, and the sprout at the student's feet.
    chime(buses, HERO_BLOOM_T, 84);
    chime(buses, SPROUT_T, 79);

    return ctx.startRendering();
}

/** Encode an AudioBuffer as 16-bit PCM WAV bytes. */
export function encodeWav(buffer: AudioBuffer): Uint8Array {
    const channels = buffer.numberOfChannels;
    const frames = buffer.length;
    const dataLen = frames * channels * 2;
    const out = new ArrayBuffer(44 + dataLen);
    const view = new DataView(out);
    const writeStr = (off: number, s: string): void => {
        for (let i = 0; i < s.length; i++) {
            view.setUint8(off + i, s.charCodeAt(i));
        }
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + dataLen, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, dataLen, true);
    let off = 44;
    const chans: Float32Array[] = [];
    for (let c = 0; c < channels; c++) {
        chans.push(buffer.getChannelData(c));
    }
    for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
            const v = Math.max(-1, Math.min(1, chans[c][i]));
            view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
            off += 2;
        }
    }
    return new Uint8Array(out);
}
