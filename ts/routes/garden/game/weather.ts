// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: ambient weather as PURE screen effects — thin rain streaks, drifting
// snow flecks, and a frost vignette that creeps in from the screen edges while it
// snows, all over the camera (scrollFactor 0). Never touches clouds or the sky tint.
// Deterministic like the critters: everything derives from the scene clock + per-particle
// seeds, no runtime RNG, so the world stays reproducible.
import type Phaser from "phaser";

type WeatherKind = "rain" | "snow";

/** Deterministic per-index pseudo-random in [0, 1) (same trick the shaders use). */
function seeded(i: number, salt: number): number {
    const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
}

const RAIN_COUNT = 70;
const SNOW_COUNT = 55;
const DEPTH = 9400; // above the sky tint (8000), below panels/prompts (9000+ UI text ok — rain reads through)
const FROST_DEPTH = 9390; // frost sits on the "glass" just under the falling flecks
/** Frost overlay alpha at full snow intensity (the texture itself is already soft). */
const FROST_MAX_ALPHA = 0.9;

/**
 * Paint the frost vignette once: icy gradients along every edge, a stronger bloom in
 * each corner, and seeded crystal specks scattered inside the border band. Pure canvas,
 * fully deterministic (same seeded() stream as the particles).
 */
function buildFrostTexture(scene: Phaser.Scene, key: string, w: number, h: number): void {
    if (scene.textures.exists(key)) {
        return;
    }
    const canvas = scene.textures.createCanvas(key, w, h);
    if (!canvas) {
        return;
    }
    const ctx = canvas.getContext();
    const band = Math.max(24, Math.round(Math.min(w, h) * 0.09));
    const icy = (a: number) => `rgba(224, 242, 255, ${a})`;

    const edges: Array<[number, number, number, number, number, number, number, number]> = [
        // [gx1, gy1, gx2, gy2, rx, ry, rw, rh] — gradient runs edge → inward over the band
        [0, 0, 0, band, 0, 0, w, band], // top
        [0, h, 0, h - band, 0, h - band, w, band], // bottom
        [0, 0, band, 0, 0, 0, band, h], // left
        [w, 0, w - band, 0, w - band, 0, band, h], // right
    ];
    for (const [gx1, gy1, gx2, gy2, rx, ry, rw, rh] of edges) {
        const g = ctx.createLinearGradient(gx1, gy1, gx2, gy2);
        g.addColorStop(0, icy(0.5));
        g.addColorStop(1, icy(0));
        ctx.fillStyle = g;
        ctx.fillRect(rx, ry, rw, rh);
    }

    const r = band * 2.2;
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]] as Array<[number, number]>) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, icy(0.45));
        g.addColorStop(1, icy(0));
        ctx.fillStyle = g;
        ctx.fillRect(cx === 0 ? 0 : w - r, cy === 0 ? 0 : h - r, r, r);
    }

    // Tiny crystal specks along the border ring — the "someone breathed on the window" bit.
    const perimeter = 2 * (w + h);
    for (let i = 0; i < 90; i++) {
        const along = seeded(i, 20) * perimeter;
        const inset = seeded(i, 21) * band * 0.8;
        let x: number;
        let y: number;
        if (along < w) {
            x = along;
            y = inset;
        } else if (along < w + h) {
            x = w - inset;
            y = along - w;
        } else if (along < 2 * w + h) {
            x = along - (w + h);
            y = h - inset;
        } else {
            x = inset;
            y = along - (2 * w + h);
        }
        ctx.fillStyle = icy(0.25 + seeded(i, 22) * 0.35);
        ctx.beginPath();
        ctx.arc(x, y, 0.6 + seeded(i, 23) * 1.2, 0, Math.PI * 2);
        ctx.fill();
    }
    canvas.refresh();
}

/** The ambient spell cycle, in seconds (repeats): clear → rain → clear → snow. */
const CYCLE_S = 240;
const RAIN_SPELL: [number, number] = [70, 120];
const SNOW_SPELL: [number, number] = [190, 240];
/** Seconds a spell takes to fade in/out at its edges. */
const FADE_S = 8;

/** Intensity 0..1 of a spell window at cycle-time `t` (soft edges). */
function spellIntensity(t: number, [a, b]: [number, number]): number {
    if (t < a || t > b) {
        return 0;
    }
    const inEdge = Math.min(1, (t - a) / FADE_S);
    const outEdge = Math.min(1, (b - t) / FADE_S);
    return Math.min(inEdge, outEdge);
}

/**
 * Screen-space weather owned by the world scene. `tick()` every frame; `rainBurst()`
 * forces a short rain shower (the sector stones' little blessing).
 */
export class WeatherLayer {
    private scene: Phaser.Scene;
    private reducedMotion: boolean;
    private rainDrops: Phaser.GameObjects.Rectangle[] = [];
    private snowFlecks: Phaser.GameObjects.Arc[] = [];
    private frost: Phaser.GameObjects.Image | null = null;
    private lastTime = 0;
    private burstUntil = 0;

    constructor(scene: Phaser.Scene, reducedMotion: boolean) {
        this.scene = scene;
        this.reducedMotion = reducedMotion;
        if (reducedMotion) {
            return; // weather is motion — reduced-motion players get a still, clear sky
        }
        const w = scene.scale.width;
        const h = scene.scale.height;
        for (let i = 0; i < RAIN_COUNT; i++) {
            const streak = scene.add.rectangle(
                seeded(i, 1) * w,
                seeded(i, 2) * h,
                1.5,
                10,
                0xbfe3ff,
                0.35,
            );
            streak.setScrollFactor(0);
            streak.setDepth(DEPTH);
            streak.setAngle(-8); // slight diagonal — rain leans with the wind
            streak.setVisible(false);
            this.rainDrops.push(streak);
        }
        for (let i = 0; i < SNOW_COUNT; i++) {
            const fleck = scene.add.circle(
                seeded(i, 3) * w,
                seeded(i, 4) * h,
                1 + seeded(i, 5), // radius 1–2
                0xffffff,
                0.6,
            );
            fleck.setScrollFactor(0);
            fleck.setDepth(DEPTH);
            fleck.setVisible(false);
            this.snowFlecks.push(fleck);
        }
        const frostKey = `weather-frost-${w}x${h}`;
        buildFrostTexture(scene, frostKey, w, h);
        if (scene.textures.exists(frostKey)) {
            this.frost = scene.add.image(0, 0, frostKey)
                .setOrigin(0, 0)
                .setScrollFactor(0)
                .setDepth(FROST_DEPTH)
                .setAlpha(0)
                .setVisible(false);
            this.layoutFrost();
        }
    }

    /**
     * Camera zoom scales scrollFactor-0 objects around the viewport CENTER, so the
     * on-screen window for screen-space content is a centered (w/zoom, h/zoom) rect —
     * a frost image left at (0,0,w,h) would have all its border detail cropped
     * off-screen. Pin the image to that visible rect (re-checked every tick: the world
     * camera re-zooms on viewport resize).
     */
    private layoutFrost(): void {
        if (!this.frost) {
            return;
        }
        const zoom = this.scene.cameras.main?.zoom || 1;
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;
        const visibleW = w / zoom;
        const visibleH = h / zoom;
        this.frost.setPosition((w - visibleW) / 2, (h - visibleH) / 2);
        this.frost.setDisplaySize(visibleW, visibleH);
    }

    /** Force a light rain shower for `ms` (default ~6 s), regardless of the ambient cycle. */
    rainBurst(ms = 6000): void {
        if (this.reducedMotion) {
            return;
        }
        this.burstUntil = Math.max(this.burstUntil, this.scene.time.now + ms);
    }

    /** Current intensity per kind at scene-time `timeMs` (ambient cycle + any burst). */
    private intensity(timeMs: number, kind: WeatherKind): number {
        const t = (timeMs / 1000) % CYCLE_S;
        let level = spellIntensity(t, kind === "rain" ? RAIN_SPELL : SNOW_SPELL);
        if (kind === "rain" && timeMs < this.burstUntil) {
            const remaining = (this.burstUntil - timeMs) / 1000;
            // Ramp the burst out over its final FADE_S seconds; full strength before that.
            level = Math.max(level, Math.min(1, remaining / FADE_S) * 0.9);
        }
        return level;
    }

    tick(timeMs: number): void {
        if (this.reducedMotion) {
            return;
        }
        const dt = this.lastTime === 0 ? 0 : Math.min(100, timeMs - this.lastTime) / 1000;
        this.lastTime = timeMs;
        const w = this.scene.scale.width;
        const h = this.scene.scale.height;

        const rain = this.intensity(timeMs, "rain");
        for (let i = 0; i < this.rainDrops.length; i++) {
            const streak = this.rainDrops[i];
            // Light rain: only a fraction of the pool falls at partial intensity.
            const active = rain > 0 && seeded(i, 6) < rain;
            streak.setVisible(active);
            if (!active) {
                continue;
            }
            streak.setAlpha(0.2 + 0.25 * rain);
            const speed = 300 + seeded(i, 7) * 120;
            streak.y += speed * dt;
            streak.x -= speed * 0.14 * dt; // matches the -8° lean
            if (streak.y > h + 12) {
                streak.y = -12;
                streak.x = seeded(i, 8) * w + ((timeMs / 1000) % 1) * 7;
            }
            if (streak.x < -8) {
                streak.x += w + 16;
            }
        }

        const snow = this.intensity(timeMs, "snow");
        for (let i = 0; i < this.snowFlecks.length; i++) {
            const fleck = this.snowFlecks[i];
            const active = snow > 0 && seeded(i, 9) < snow;
            fleck.setVisible(active);
            if (!active) {
                continue;
            }
            fleck.setAlpha(0.35 + 0.35 * snow);
            const speed = 28 + seeded(i, 10) * 24;
            fleck.y += speed * dt;
            // Gentle sinusoidal sway, phase-shifted per fleck.
            fleck.x += Math.sin(timeMs / 900 + seeded(i, 11) * Math.PI * 2) * 12 * dt;
            if (fleck.y > h + 6) {
                fleck.y = -6;
                fleck.x = seeded(i, 12) * w;
            }
        }

        // Frost creeps in from the edges with the snow and melts away with it.
        if (this.frost) {
            const frostAlpha = snow * FROST_MAX_ALPHA;
            this.frost.setVisible(frostAlpha > 0.01);
            this.frost.setAlpha(frostAlpha);
            this.layoutFrost();
        }
    }

    destroy(): void {
        for (const streak of this.rainDrops) {
            streak.destroy();
        }
        for (const fleck of this.snowFlecks) {
            fleck.destroy();
        }
        this.frost?.destroy();
        this.frost = null;
        this.rainDrops = [];
        this.snowFlecks = [];
    }
}
