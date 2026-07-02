// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: Map overlay — realistic base map with waystones (doc 23 §6.4). Toggled via bus
// "map:toggle"; React owns travel rules on "map:travel".
import Phaser from "phaser";

import type { TypedBus } from "../../state/bus";
import { DISPLAY } from "../assets";
import { skyStateFor } from "../daynight";
import { buildWorldPlan, type GardenSection, type WorldPlan } from "../worldgen";

const SECTION_LABELS: Record<GardenSection, string> = {
    "P-S": "Sakura",
    "B-B": "Keukenhof",
    "C-P": "Versailles",
    CARS: "Gardens by the Bay",
};

export class MapScene extends Phaser.Scene {
    private bus!: TypedBus;
    private plan!: WorldPlan;
    private overlayCam!: Phaser.Cameras.Scene2D.Camera;
    private miniRoot!: Phaser.GameObjects.Container;
    private unsubToggle: (() => void) | null = null;
    private visible = false;

    constructor() {
        super({ key: "map", active: false, visible: false });
    }

    create(): void {
        this.bus = this.registry.get("bus") as TypedBus;
        this.plan = buildWorldPlan();

        this.overlayCam = this.cameras.main;
        this.overlayCam.setBackgroundColor(0x0a120e);
        this.overlayCam.setScroll(0, 0);

        this.miniRoot = this.add.container(0, 0);
        this.renderMiniMap();

        this.unsubToggle = this.bus.on("map:toggle", () => {
            this.toggle();
        });

        this.input.keyboard?.on("keydown-ESC", () => this.hide());
        this.input.keyboard?.on("keydown-M", () => this.toggle());

        this.scene.stop();
    }

    shutdown(): void {
        this.unsubToggle?.();
        this.unsubToggle = null;
    }

    private toggle(): void {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    private show(): void {
        this.scene.setVisible(true);
        this.scene.setActive(true);
        this.visible = true;
        this.updateMarkers();
    }

    private hide(): void {
        this.visible = false;
        this.scene.setVisible(false);
        this.scene.setActive(false);
    }

    private renderMiniMap(): void {
        const ts = DISPLAY.tile;
        const scale = 0.35;
        const w = this.plan.widthTiles * ts * scale;
        const h = this.plan.heightTiles * ts * scale;

        const bg = this.add.rectangle(w / 2, h / 2, w + 40, h + 40, 0x1a2b1e, 0.95);
        bg.setStrokeStyle(2, 0x5cb848);
        this.miniRoot.add(bg);

        for (const region of this.plan.regions) {
            const rx = region.rect.x * ts * scale;
            const ry = region.rect.y * ts * scale;
            const rw = region.rect.w * ts * scale;
            const rh = region.rect.h * ts * scale;
            const block = this.add.rectangle(rx + rw / 2, ry + rh / 2, rw, rh, 0x2a4030, 0.8);
            block.setStrokeStyle(1, 0x8fbc8f);
            this.miniRoot.add(block);

            const label = this.add.text(rx + rw / 2, ry + 8, SECTION_LABELS[region.section], {
                fontFamily: "monospace",
                fontSize: "11px",
                color: "#e8f0e2",
            }).setOrigin(0.5, 0);
            this.miniRoot.add(label);

            for (const t of region.trailTiles) {
                const dot = this.add.circle(
                    t.tileX * ts * scale + ts * scale / 2,
                    t.tileY * ts * scale + ts * scale / 2,
                    1.5,
                    0xc4a882,
                );
                this.miniRoot.add(dot);
            }

            // Waystone dot (clickable)
            const ws = region.waystone;
            const wsX = ws.tileX * ts * scale + ts * scale / 2;
            const wsY = ws.tileY * ts * scale + ts * scale / 2;
            const wayDot = this.add.circle(wsX, wsY, 5, 0xffe066);
            wayDot.setInteractive({ useHandCursor: true });
            wayDot.on("pointerdown", () => {
                this.bus.emit("map:travel", { waystoneId: region.section });
                this.hide();
            });
            this.miniRoot.add(wayDot);
        }

        // Center keeper marker
        const k = this.plan.center.keeperTile;
        const keeperDot = this.add.circle(
            k.tileX * ts * scale + ts * scale / 2,
            k.tileY * ts * scale + ts * scale / 2,
            6,
            0x9d4edd,
        );
        this.miniRoot.add(keeperDot);

        this.overlayCam.centerOn(w / 2, h / 2);
        this.overlayCam.setZoom(Math.min(
            (this.scale.width - 40) / (w + 40),
            (this.scale.height - 40) / (h + 40),
        ));
    }

    private updateMarkers(): void {
        const world = this.scene.get("world") as Phaser.Scene & {
            getAvatarTile?: () => { tileX: number; tileY: number };
            getTendNextTile?: () => { tileX: number; tileY: number } | null;
        };
        const ts = DISPLAY.tile;
        const scale = 0.35;

        // Remove old dynamic markers
        this.miniRoot.getAll().filter((o) => o.getData("dynamic")).forEach((o) => o.destroy());

        const avatar = world?.getAvatarTile?.();
        if (avatar) {
            const dot = this.add.circle(
                avatar.tileX * ts * scale + ts * scale / 2,
                avatar.tileY * ts * scale + ts * scale / 2,
                4,
                0x5cb848,
            );
            dot.setData("dynamic", true);
            dot.setStrokeStyle(2, 0xffffff);
            this.miniRoot.add(dot);
        }

        const tend = world?.getTendNextTile?.();
        if (tend) {
            const star = this.add.star(
                tend.tileX * ts * scale + ts * scale / 2,
                tend.tileY * ts * scale + ts * scale / 2,
                5,
                3,
                6,
                0xffe066,
            );
            star.setData("dynamic", true);
            this.miniRoot.add(star);
            const tag = this.add.text(
                tend.tileX * ts * scale,
                tend.tileY * ts * scale - 12,
                "TEND NEXT",
                { fontSize: "8px", color: "#ffe066", fontFamily: "monospace" },
            ).setOrigin(0.5, 1);
            tag.setData("dynamic", true);
            this.miniRoot.add(tag);
        }

        const sky = skyStateFor(new Date());
        const tint = this.add.rectangle(
            this.scale.width / 2,
            this.scale.height / 2,
            this.scale.width,
            this.scale.height,
            sky.tint,
            sky.ambientAlpha * 0.5,
        );
        tint.setScrollFactor(0);
        tint.setData("dynamic", true);
        this.miniRoot.add(tint);
    }
}
