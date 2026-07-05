// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the garden gnome (feature 2026-07-05) — a small AI-gardener NPC that stands
// somewhere in the plot and carries ONE encouraging insight for the day, but never speaks TO
// you. From afar its bubble is nothing; walk into range and it's a "…"; walk closer still and
// the "…" grows into the full line, typing itself out (three distance stages). The text is
// chosen by the pure daily selector (state/gardener-insight) and pushed in via setText — this
// class owns only the sprite, the idle bob, and the proximity reveal.
import type Phaser from "phaser";

import { DISPLAY, ensureTexture, hasAssetKey } from "./assets";

/** Distance bands (in tiles) for the three-stage reveal. */
const NOTICE_TILES = 8; // farther than this: no bubble at all
const NEAR_TILES = 3.2; // closer than this: the full line types out
/** Full-line type-on speed (chars/sec) once you're near. */
const REVEAL_CPS = 45;
/** Bubble word-wrap width (px) so a long, warm sentence stacks instead of running off-screen. */
const BUBBLE_WRAP_PX = 156;

type Stage = "far" | "dots" | "near";

/** A distinct, friendly character — the alternate gardener art, NOT the meditating Keeper
 *  and NOT the player's own walk frames, so the gnome reads as its own little person. */
function gardenerTextureKey(): string {
    return hasAssetKey("keeper-gardener") ? "keeper-gardener" : "gardener-idle-down";
}

export class Gardener {
    private scene: Phaser.Scene;
    private reducedMotion: boolean;
    private sprite: Phaser.GameObjects.Image;
    private glow?: Phaser.GameObjects.Arc;
    private bubble: Phaser.GameObjects.Text;
    private baseY: number;
    private text = "";
    /** Chars revealed so far while near (fractional; floored when drawn). */
    private revealed = 0;
    private stage: Stage = "far";

    constructor(scene: Phaser.Scene, tileX: number, tileY: number, reducedMotion: boolean) {
        this.scene = scene;
        this.reducedMotion = reducedMotion;
        const ts = DISPLAY.tile;
        const x = tileX * ts + ts / 2;
        const y = tileY * ts + ts;

        this.sprite = scene.add.image(x, y, ensureTexture(scene, gardenerTextureKey()))
            .setOrigin(0.5, 1);
        const h = this.sprite.height;
        this.sprite.setScale(h > 0 ? (ts * 2.0) / h : 1);
        this.sprite.setDepth(y / ts);
        this.baseY = y;

        // A soft warm glow marks the gnome as special (the one who "knows" something) without a
        // HUD marker — just a hint of firefly light. Cut under reduced motion.
        if (!reducedMotion) {
            this.glow = scene.add.circle(x, y - ts * 0.95, 11, 0xffe9a8, 0.25)
                .setDepth(y / ts - 0.01);
        }

        this.bubble = scene.add.text(x, y - this.sprite.displayHeight - 6, "", {
            fontFamily: "monospace",
            fontSize: "9px",
            color: "#f3ffe8",
            backgroundColor: "#26402acc",
            padding: { x: 5, y: 4 },
            align: "center",
            wordWrap: { width: BUBBLE_WRAP_PX },
        }).setOrigin(0.5, 1).setDepth(9000).setVisible(false);
    }

    /** The day's chosen line (from the pure selector). Resets the reveal so a fresh line
     *  types out cleanly the next time the player is near. */
    setText(text: string): void {
        if (text === this.text) {
            return;
        }
        this.text = text;
        this.revealed = 0;
    }

    /** Per-frame: bob, follow, and drive the three-stage proximity reveal. */
    update(avatarX: number, avatarY: number, delta: number): void {
        const ts = DISPLAY.tile;
        const dist = Math.hypot(avatarX - this.sprite.x, avatarY - this.sprite.y) / ts;
        let stage: Stage = "dots";
        if (dist > NOTICE_TILES) {
            stage = "far";
        } else if (dist <= NEAR_TILES) {
            stage = "near";
        }
        if (stage !== this.stage) {
            this.stage = stage;
            // Re-approaching re-types the line — the "…" grows into words each time you close in.
            if (stage !== "near") {
                this.revealed = 0;
            }
        }

        if (!this.reducedMotion) {
            const now = this.scene.time.now / 1000;
            this.sprite.y = this.baseY + Math.sin(now * 2) * 2;
            if (this.glow) {
                this.glow.setAlpha(0.2 + 0.1 * (0.5 + 0.5 * Math.sin(now * 1.4)));
            }
        }
        this.bubble.setPosition(this.sprite.x, this.sprite.y - this.sprite.displayHeight - 6);

        if (stage === "far" || this.text.length === 0) {
            this.bubble.setVisible(false);
            return;
        }
        this.bubble.setVisible(true);
        if (stage === "dots") {
            this.bubble.setText("…");
            return;
        }

        // Near: grow the "…" into the full line.
        if (this.reducedMotion) {
            this.revealed = this.text.length;
        } else if (this.revealed < this.text.length) {
            this.revealed = Math.min(this.text.length, this.revealed + (delta / 1000) * REVEAL_CPS);
        }
        this.bubble.setText(this.text.slice(0, Math.floor(this.revealed)));
    }

    destroy(): void {
        this.sprite.destroy();
        this.glow?.destroy();
        this.bubble.destroy();
    }
}
