// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: screen-space grading layer of the intro cinematic — sky tint, golden-hour
// glow, desaturation, moon/stars, clouds, soft fog, drifting petals, sparkles. Lives in
// its own scene so the world camera's zoom never scales these full-frame effects.
import Phaser from "phaser";

import { ensureTexture } from "../assets";
import { skyStateFor } from "../daynight";

import {
    backdropAlpha,
    backdropPose,
    BACKDROPS,
    BEATS,
    clamp01,
    desaturationAt,
    easeInOut,
    fogAt,
    nightCapAt,
    rng,
    span,
    VIEW_H,
    VIEW_W,
    virtualDate,
} from "./timeline";

/** Warm additive glow strength (golden hour open, sunrise, closing morning). */
function warmGlowAt(t: number): number {
    const open = 0.5 * (1 - easeInOut(span(t, 6.5, 9)));
    const sunrise = 0.55 * easeInOut(span(t, 50, 52.5)) * (1 - 0.5 * easeInOut(span(t, 56, 62)));
    const closing = 0.3 * easeInOut(span(t, 62, 66));
    return clamp01(Math.max(open, sunrise, closing));
}

function makeRadialTexture(
    scene: Phaser.Scene,
    key: string,
    size: number,
    stops: Array<[number, string]>,
): void {
    if (scene.textures.exists(key)) {
        return;
    }
    const canvas = scene.textures.createCanvas(key, size, size);
    if (!canvas) {
        return;
    }
    const ctx = canvas.getContext();
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    for (const [at, color] of stops) {
        g.addColorStop(at, color);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    canvas.refresh();
}

export class CineSkyScene extends Phaser.Scene {
    private skyOverlay!: Phaser.GameObjects.Rectangle;
    private desatOverlay!: Phaser.GameObjects.Rectangle;
    private nightCap!: Phaser.GameObjects.Rectangle;
    private warmGlow!: Phaser.GameObjects.Image;
    private moon!: Phaser.GameObjects.Image;
    private stars: Phaser.GameObjects.Image[] = [];
    private clouds: Array<{ sprite: Phaser.GameObjects.Image; seed: number }> = [];
    private fogBlobs: Array<{ sprite: Phaser.GameObjects.Image; seed: number }> = [];
    private petals: Array<{ sprite: Phaser.GameObjects.Image; seed: number }> = [];
    private sparkles: Array<{ sprite: Phaser.GameObjects.Image; seed: number }> = [];
    private backdrops: Phaser.GameObjects.Image[] = [];

    constructor() {
        super("cine-sky");
    }

    create(): void {
        makeRadialTexture(this, "cine-fog-blob", 256, [
            [0, "rgba(226,232,238,0.55)"],
            [0.55, "rgba(226,232,238,0.28)"],
            [1, "rgba(226,232,238,0)"],
        ]);
        makeRadialTexture(this, "cine-warm-glow", 512, [
            [0, "rgba(255,176,102,0.85)"],
            [0.5, "rgba(255,150,80,0.35)"],
            [1, "rgba(255,140,60,0)"],
        ]);

        this.skyOverlay = this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0xffffff, 0);
        this.skyOverlay.setOrigin(0, 0).setDepth(10);
        this.skyOverlay.setBlendMode(Phaser.BlendModes.MULTIPLY);

        this.warmGlow = this.add.image(VIEW_W * 0.68, VIEW_H * 0.1, "cine-warm-glow");
        this.warmGlow.setDepth(15).setDisplaySize(VIEW_W * 1.7, VIEW_H * 1.5).setAlpha(0);
        this.warmGlow.setBlendMode(Phaser.BlendModes.ADD);

        this.desatOverlay = this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x888888, 0);
        this.desatOverlay.setOrigin(0, 0).setDepth(20);
        this.desatOverlay.setBlendMode(Phaser.BlendModes.SATURATION);

        this.nightCap = this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x232c3e, 0);
        this.nightCap.setOrigin(0, 0).setDepth(21);
        this.nightCap.setBlendMode(Phaser.BlendModes.MULTIPLY);

        this.moon = this.add.image(VIEW_W * 0.82, VIEW_H * 0.16, ensureTexture(this, "sky-moon-full"));
        this.moon.setDepth(31).setDisplaySize(110, 110).setAlpha(0);

        for (let i = 0; i < 16; i++) {
            const r = rng(i + 40);
            const star = this.add.image(
                r() * VIEW_W,
                r() * VIEW_H * 0.5,
                ensureTexture(this, `sky-star-${String(i % 12).padStart(2, "0")}`),
            );
            star.setDepth(30).setDisplaySize(20, 20).setAlpha(0);
            this.stars.push(star);
        }
        for (let i = 0; i < 6; i++) {
            const key = ensureTexture(this, `sky-cloud-${String(i * 2).padStart(2, "0")}`);
            const spr = this.add.image(0, 0, key);
            const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
            const scale = 1.4;
            spr.setDepth(40).setDisplaySize(src.width * scale, src.height * scale).setAlpha(0);
            this.clouds.push({ sprite: spr, seed: i * 97 + 5 });
        }
        for (let i = 0; i < 12; i++) {
            const spr = this.add.image(0, 0, "cine-fog-blob");
            spr.setDepth(50).setDisplaySize(820, 460).setAlpha(0);
            this.fogBlobs.push({ sprite: spr, seed: i * 131 + 11 });
        }
        // Painterly establishing backdrops (region hero art), Ken Burns per cue.
        for (let i = 0; i < BACKDROPS.length; i++) {
            const spr = this.add.image(VIEW_W / 2, VIEW_H / 2, ensureTexture(this, BACKDROPS[i].key));
            spr.setDepth(45 + i * 0.1).setAlpha(0);
            this.backdrops.push(spr);
        }

        for (let i = 0; i < 48; i++) {
            const spr = this.add.image(0, 0, ensureTexture(this, `fx-petal-${String(i % 10).padStart(2, "0")}`));
            spr.setDepth(60).setDisplaySize(22, 22).setAlpha(0);
            this.petals.push({ sprite: spr, seed: i * 61 + 3 });
        }
        for (let i = 0; i < 30; i++) {
            const spr = this.add.image(0, 0, ensureTexture(this, `fx-sparkle-${String(i % 9).padStart(2, "0")}`));
            spr.setDepth(61).setDisplaySize(18, 18).setAlpha(0);
            spr.setBlendMode(Phaser.BlendModes.ADD);
            this.sparkles.push({ sprite: spr, seed: i * 43 + 17 });
        }
    }

    applyTime(t: number): void {
        const sky = skyStateFor(virtualDate(t));
        this.skyOverlay.setFillStyle(sky.tint, sky.ambientAlpha);
        this.desatOverlay.setFillStyle(0x888888, desaturationAt(t));
        this.nightCap.setFillStyle(0x232c3e, nightCapAt(t));
        this.warmGlow.setAlpha(warmGlowAt(t));

        const NIGHTNESS: Record<string, number> = { night: 1, dusk: 0.7, evening: 0.25 };
        const nightness = NIGHTNESS[sky.phase] ?? 0;
        this.moon.setAlpha(nightness * 0.95);
        for (let i = 0; i < this.stars.length; i++) {
            const tw = 0.55 + 0.45 * Math.sin(t * 2.2 + i * 1.7);
            this.stars[i].setAlpha(nightness * tw);
        }

        // Backdrop segments (Ken Burns over the painterly hero art).
        let backdropCover = 0;
        for (let i = 0; i < BACKDROPS.length; i++) {
            const cue = BACKDROPS[i];
            const alpha = backdropAlpha(cue, t);
            const spr = this.backdrops[i];
            spr.setAlpha(alpha);
            backdropCover = Math.max(backdropCover, alpha);
            if (alpha > 0) {
                const pose = backdropPose(cue, t);
                const src = this.textures.get(cue.key).getSourceImage() as { width: number; height: number };
                const cover = Math.max(VIEW_W / src.width, VIEW_H / src.height);
                const s = cover * pose.scale;
                spr.setDisplaySize(src.width * s, src.height * s);
                spr.setPosition(VIEW_W / 2 + pose.ox * VIEW_W, VIEW_H / 2 + pose.oy * VIEW_H);
            }
        }

        const sleep = t >= BEATS.longSleep.from && t < BEATS.longSleep.to;
        let baseCloudAlpha = 0.16;
        if (sleep) {
            baseCloudAlpha = 0.5;
        } else if (t < 8) {
            baseCloudAlpha = 0.3;
        }
        const cloudAlpha = baseCloudAlpha * (1 - backdropCover);
        for (const c of this.clouds) {
            const r = rng(c.seed);
            const speed = (26 + r() * 36) * (sleep ? 10 : 1);
            const x = ((r() * (VIEW_W + 700) + t * speed) % (VIEW_W + 700)) - 350;
            const y = r() * VIEW_H * 0.7;
            c.sprite.setPosition(x, y).setAlpha(cloudAlpha * (0.6 + r() * 0.4));
        }

        const fog = fogAt(t);
        for (const f of this.fogBlobs) {
            const r = rng(f.seed);
            const x = ((r() * (VIEW_W + 900) + t * (18 + r() * 22)) % (VIEW_W + 900)) - 450;
            const y = VIEW_H * (0.25 + r() * 0.75) + Math.sin(t * 0.3 + r() * 8) * 30;
            f.sprite.setPosition(x, y).setAlpha(fog * (0.55 + r() * 0.45));
        }

        let petalAlpha = 0;
        if (t < BEATS.departure.to) {
            petalAlpha = 0.9 * (1 - span(t, 28, 31));
        } else if (t >= BEATS.begin.from) {
            petalAlpha = 0.55 * span(t, 63, 66);
        }
        for (const p of this.petals) {
            const r = rng(p.seed);
            const fall = 26 + r() * 34;
            const driftX = 14 + r() * 22;
            const x = ((r() * (VIEW_W + 120) + t * driftX) % (VIEW_W + 120)) - 60;
            const y = ((r() * (VIEW_H + 120) + t * fall) % (VIEW_H + 120)) - 60;
            p.sprite.setPosition(x, y);
            p.sprite.setRotation(t * (0.4 + r() * 0.7) + r() * 6);
            p.sprite.setAlpha(petalAlpha * (0.5 + r() * 0.5));
        }

        const sparkleWindow = t >= BEATS.peakGbtb.from && t < BEATS.peakGbtb.to;
        for (const sp of this.sparkles) {
            const r = rng(sp.seed);
            if (!sparkleWindow) {
                sp.sprite.setAlpha(0);
                continue;
            }
            const tw = Math.max(0, Math.sin(t * (2 + r() * 3) + r() * 10));
            sp.sprite.setPosition(r() * VIEW_W, r() * VIEW_H).setAlpha(0.85 * tw);
        }
    }
}
