// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the generative lofi ENGINE (docs/26 G4.3; doc 23 §11). A self-contained
// Web Audio synth that plays warm, swung, jazzy lofi study music with ZERO binary assets —
// every sound (electric-piano keys, pad, bass, drums, vinyl crackle, reverb) is synthesized
// at runtime. License-clean by construction (the G5.1 audit lever), tiny bundle, and — the
// whole point — every layer's presence is a live AudioParam the director crossfades, so the
// score adapts to region + time-of-day + activity (doc 23 §9.3/§9.5).
//
// Browser-only: this module touches the Web Audio API and must never run during SSR or in a
// node test. The pure decisions live in theory.ts; this file only *renders* them to sound.
import { clamp, clamp01, type LayerMix, midiToFreq, REGION_PROFILES, type RegionProfile } from "./theory";

/** The surface the director drives. Kept minimal so a fake stands in for it in tests. */
export interface MusicEngine {
    start(): Promise<void>;
    stop(): void;
    dispose(): void;
    setRegion(profile: RegionProfile): void;
    setLayerMix(mix: LayerMix): void;
    setCutoff(hz: number): void;
    setMasterVolume(v: number): void;
    setMuted(muted: boolean): void;
    readonly running: boolean;
}

type LayerName = keyof LayerMix;
const LAYER_NAMES: readonly LayerName[] = ["pad", "keys", "bass", "drums", "lead", "vinyl"];

const LOOKAHEAD_MS = 25; // scheduler wakeup cadence
const SCHEDULE_AHEAD_S = 0.12; // how far ahead notes are committed to the audio clock
const RAMP_S = 0.6; // crossfade time for adaptive mix moves

function makeAudioContext(): AudioContext {
    const w = globalThis as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
        throw new Error("Web Audio API unavailable");
    }
    return new Ctor();
}

export class LofiEngine implements MusicEngine {
    private ctx: AudioContext;
    private master: GainNode;
    private warmth: BiquadFilterNode;
    private limiter: DynamicsCompressorNode;
    private dryBus: GainNode;
    private reverbReturn: GainNode;
    private layers: Record<LayerName, GainNode>;
    private noiseBuffer: AudioBuffer;
    private vinylSource: AudioBufferSourceNode | null = null;

    private profile: RegionProfile = REGION_PROFILES.sakura;
    private pendingProfile: RegionProfile | null = null;

    private timer: ReturnType<typeof setInterval> | null = null;
    private nextNoteTime = 0;
    private step = 0; // 0..15 within the bar
    private bar = 0; // 0..3 within the progression
    private leadPhraseActive = false;
    private volume = 0.7;
    private muted = false;
    private started = false;

    constructor(ctx?: AudioContext) {
        this.ctx = ctx ?? makeAudioContext();

        this.master = this.ctx.createGain();
        this.limiter = this.ctx.createDynamicsCompressor();
        this.warmth = this.ctx.createBiquadFilter();
        this.dryBus = this.ctx.createGain();
        this.reverbReturn = this.ctx.createGain();

        // Master chain: [dry + reverb] -> warmth lowpass -> soft limiter -> master -> out.
        this.warmth.type = "lowpass";
        this.warmth.frequency.value = 1800;
        this.warmth.Q.value = 0.6;
        this.limiter.threshold.value = -10;
        this.limiter.ratio.value = 4;
        this.limiter.attack.value = 0.006;
        this.limiter.release.value = 0.18;
        this.master.gain.value = this.muted ? 0 : this.volume;

        this.dryBus.connect(this.warmth);
        this.reverbReturn.connect(this.warmth);
        this.warmth.connect(this.limiter);
        this.limiter.connect(this.master);
        this.master.connect(this.ctx.destination);

        // A gentle plate-ish reverb from a synthesized impulse; the dry bus feeds it.
        const convolver = this.ctx.createConvolver();
        convolver.buffer = this.makeImpulse(2.4, 2.2);
        const reverbSend = this.ctx.createGain();
        reverbSend.gain.value = 0.22;
        this.dryBus.connect(reverbSend);
        reverbSend.connect(convolver);
        convolver.connect(this.reverbReturn);
        this.reverbReturn.gain.value = 0.9;

        // Per-layer gains feed the dry bus; the director ramps these to adapt the mix.
        this.layers = LAYER_NAMES.reduce((acc, name) => {
            const g = this.ctx.createGain();
            g.gain.value = 0;
            g.connect(this.dryBus);
            acc[name] = g;
            return acc;
        }, {} as Record<LayerName, GainNode>);

        this.noiseBuffer = this.makeNoise(2);
    }

    get running(): boolean {
        return this.started && this.timer !== null;
    }

    async start(): Promise<void> {
        if (this.ctx.state === "suspended") {
            await this.ctx.resume();
        }
        if (this.started) {
            return;
        }
        this.started = true;
        this.startVinyl();
        this.nextNoteTime = this.ctx.currentTime + 0.08;
        this.step = 0;
        this.bar = 0;
        this.timer = setInterval(() => this.scheduler(), LOOKAHEAD_MS);
    }

    stop(): void {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.started = false;
        this.vinylSource?.stop();
        this.vinylSource = null;
    }

    dispose(): void {
        this.stop();
        void this.ctx.close();
    }

    setRegion(profile: RegionProfile): void {
        // Swap on the next bar boundary so the change lands musically, not mid-phrase.
        this.pendingProfile = profile;
    }

    setLayerMix(mix: LayerMix): void {
        const now = this.ctx.currentTime;
        for (const name of LAYER_NAMES) {
            const g = this.layers[name].gain;
            g.cancelScheduledValues(now);
            g.setValueAtTime(g.value, now);
            g.linearRampToValueAtTime(clamp01(mix[name]), now + RAMP_S);
        }
    }

    setCutoff(hz: number): void {
        const now = this.ctx.currentTime;
        const f = this.warmth.frequency;
        f.cancelScheduledValues(now);
        f.setValueAtTime(f.value, now);
        f.linearRampToValueAtTime(clamp(hz, 400, 6000), now + RAMP_S);
    }

    setMasterVolume(v: number): void {
        this.volume = clamp01(v);
        this.applyMaster();
    }

    setMuted(muted: boolean): void {
        this.muted = muted;
        this.applyMaster();
    }

    private applyMaster(): void {
        const now = this.ctx.currentTime;
        const g = this.master.gain;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(this.muted ? 0 : this.volume, now + 0.25);
    }

    // ── scheduling ────────────────────────────────────────────────────────────

    private scheduler(): void {
        const secPerBeat = 60 / this.profile.bpm;
        const sixteenth = secPerBeat / 4;
        while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD_S) {
            this.scheduleStep(this.nextNoteTime, sixteenth);
            this.advance(sixteenth);
        }
    }

    private advance(sixteenth: number): void {
        this.nextNoteTime += sixteenth;
        this.step += 1;
        if (this.step >= 16) {
            this.step = 0;
            this.bar = (this.bar + 1) % this.profile.progression.length;
            if (this.bar === 0 && this.pendingProfile) {
                this.profile = this.pendingProfile;
                this.pendingProfile = null;
            }
        }
    }

    private scheduleStep(time: number, sixteenth: number): void {
        const p = this.profile;
        const chord = p.progression[this.bar];
        // Lofi swing: push the offbeat 8ths (steps 2,6,10,14) a touch late.
        const swung = this.step % 4 === 2 ? time + (p.swing - 0.5) * 2 * sixteenth : time;
        const t = swung + (Math.random() - 0.5) * 0.008; // subtle human timing

        // Pad + keys comp land on the downbeat of each bar (new chord).
        if (this.step === 0) {
            this.playPad(chord.notes, t, sixteenth * 16 * 1.05);
            this.playKeys(chord.notes, t, sixteenth * 6);
            this.leadPhraseActive = Math.random() < p.leadDensity;
        }
        // A soft key stab on the "and" of beat 2 for movement.
        if (this.step === 10) {
            this.playKeys(chord.notes, t, sixteenth * 4, 0.5);
        }

        // Bass: root on beats 1 & 3; a walking fifth lead-in before the bar turns.
        if (this.step === 0) { this.playBass(chord.bass, t, sixteenth * 6); }
        if (this.step === 8) { this.playBass(chord.bass, t, sixteenth * 5); }
        if (this.step === 14) { this.playBass(chord.bass + 7, t, sixteenth * 2, 0.7); }

        // Boom-bap-ish lofi drums.
        if (this.step === 0 || this.step === 10) { this.kick(t); }
        if (this.step === 4 || this.step === 12) { this.snare(t); }
        if (this.step % 2 === 0) { this.hat(t, this.step % 4 === 0 ? 0.5 : 0.32); }

        // Sparse region-flavored lead plucks.
        if (this.leadPhraseActive && (this.step === 4 || this.step === 7 || this.step === 12)) {
            if (Math.random() < 0.8) { this.playLead(this.pickLeadMidi(), t, sixteenth * 3); }
        }

        // Occasional vinyl pop for texture.
        if (Math.random() < 0.06) { this.pop(t); }
    }

    private pickLeadMidi(): number {
        const p = this.profile;
        const pc = p.leadScale[Math.floor(Math.random() * p.leadScale.length)];
        const octaveJitter = Math.random() < 0.25 ? 12 : 0;
        return p.leadOctave + pc + octaveJitter;
    }

    // ── voices ────────────────────────────────────────────────────────────────

    private env(
        gainNode: GainNode,
        time: number,
        peak: number,
        attack: number,
        release: number,
    ): void {
        const g = gainNode.gain;
        g.setValueAtTime(0.0001, time);
        g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + attack);
        g.exponentialRampToValueAtTime(0.0001, time + attack + release);
    }

    private playPad(midis: number[], time: number, dur: number): void {
        for (const m of midis) {
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = "sawtooth";
            osc.frequency.value = midiToFreq(m - 12); // an octave down = warm bed
            osc.detune.value = (Math.random() - 0.5) * this.profile.keysDetuneCents;
            const lp = this.ctx.createBiquadFilter();
            lp.type = "lowpass";
            lp.frequency.value = 900;
            osc.connect(lp);
            lp.connect(g);
            g.connect(this.layers.pad);
            this.env(g, time, 0.12, dur * 0.4, dur * 0.6);
            osc.start(time);
            osc.stop(time + dur + 0.1);
        }
    }

    private playKeys(midis: number[], time: number, dur: number, vel = 1): void {
        for (const m of midis) {
            const a = this.ctx.createOscillator();
            const b = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            a.type = "triangle";
            b.type = "sine";
            a.frequency.value = midiToFreq(m);
            b.frequency.value = midiToFreq(m);
            b.detune.value = this.profile.keysDetuneCents;
            a.connect(g);
            b.connect(g);
            g.connect(this.layers.keys);
            this.env(g, time, 0.16 * vel, 0.01, dur);
            a.start(time);
            b.start(time);
            a.stop(time + dur + 0.1);
            b.stop(time + dur + 0.1);
        }
    }

    private playBass(midi: number, time: number, dur: number, vel = 1): void {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = midiToFreq(midi - 12);
        osc.connect(g);
        g.connect(this.layers.bass);
        this.env(g, time, 0.4 * vel, 0.012, dur);
        osc.start(time);
        osc.stop(time + dur + 0.1);
    }

    private playLead(midi: number, time: number, dur: number): void {
        const voice = this.profile.leadVoice;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.frequency.value = midiToFreq(midi);
        if (voice === "bell") {
            osc.type = "sine";
            const mod = this.ctx.createOscillator();
            const modGain = this.ctx.createGain();
            mod.frequency.value = midiToFreq(midi) * 2.01;
            modGain.gain.value = midiToFreq(midi) * 1.4;
            mod.connect(modGain);
            modGain.connect(osc.frequency);
            mod.start(time);
            mod.stop(time + dur + 0.2);
            this.env(g, time, 0.18, 0.005, dur * 1.6);
        } else if (voice === "marimba") {
            osc.type = "sine";
            this.env(g, time, 0.22, 0.004, dur * 0.8);
        } else {
            osc.type = "triangle"; // koto-ish pluck
            this.env(g, time, 0.2, 0.004, dur);
        }
        osc.connect(g);
        g.connect(this.layers.lead);
        osc.start(time);
        osc.stop(time + dur * 1.8 + 0.1);
    }

    private kick(time: number): void {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(120, time);
        osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
        osc.connect(g);
        g.connect(this.layers.drums);
        this.env(g, time, 0.7, 0.004, 0.16);
        osc.start(time);
        osc.stop(time + 0.24);
    }

    private snare(time: number): void {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1900;
        bp.Q.value = 0.8;
        const g = this.ctx.createGain();
        src.connect(bp);
        bp.connect(g);
        g.connect(this.layers.drums);
        this.env(g, time, 0.35, 0.003, 0.12); // soft, brushed — never a harsh crack
        src.start(time);
        src.stop(time + 0.2);
    }

    private hat(time: number, vel: number): void {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const hp = this.ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 7000;
        const g = this.ctx.createGain();
        src.connect(hp);
        hp.connect(g);
        g.connect(this.layers.drums);
        this.env(g, time, 0.14 * vel, 0.002, 0.03);
        src.start(time);
        src.stop(time + 0.08);
    }

    private pop(time: number): void {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 3200;
        const g = this.ctx.createGain();
        src.connect(bp);
        bp.connect(g);
        g.connect(this.layers.vinyl);
        this.env(g, time, 0.5, 0.001, 0.02);
        src.start(time);
        src.stop(time + 0.05);
    }

    private startVinyl(): void {
        // A continuous filtered-noise hiss bed — the lofi "tape/vinyl" floor.
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        src.loop = true;
        const bp = this.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 2600;
        bp.Q.value = 0.4;
        const g = this.ctx.createGain();
        g.gain.value = 0.06;
        src.connect(bp);
        bp.connect(g);
        g.connect(this.layers.vinyl);
        src.start();
        this.vinylSource = src;
    }

    // ── buffers ─────────────────────────────────────────────────────────────

    private makeNoise(seconds: number): AudioBuffer {
        const len = Math.floor(this.ctx.sampleRate * seconds);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buf;
    }

    private makeImpulse(seconds: number, decay: number): AudioBuffer {
        const len = Math.floor(this.ctx.sampleRate * seconds);
        const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
            }
        }
        return buf;
    }
}
