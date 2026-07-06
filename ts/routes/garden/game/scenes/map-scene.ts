// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: Map overlay — a live miniature of the actual world (doc 23 §6.4). Every open
// redraws the world scene's display list (ground, flora carpet, plants, props, avatar) into
// a RenderTexture, so the map IS the garden as it currently stands — not a schematic.
// Toggled via bus "map:toggle"; React owns travel rules on "map:travel". Map-first drop-in:
// click any open GRASS tile to teleport there ("glance at the map, pick a spot, and drop
// in") — the world scene validates the landing (grass + unblocked) and executes
// "map:teleport".
import Phaser from "phaser";

import type { TypedBus } from "../../state/bus";
import { DISPLAY } from "../assets";
import { skyStateFor } from "../daynight";
import { buildWorldPlan, type GardenSection, type WorldPlan } from "../worldgen";

/** Mini-map render scale: world px → map px (the overlay camera then fits the viewport). */
const MAP_SCALE = 0.7;

/** World depths ≥ this band are screen-space FX/overlays (sky, weather, prompts,
 * petal bursts) — never part of the miniature. Mirrors the world scene's convention. */
const FX_DEPTH_BAND = 8000;

/** The world-scene display-list surface the snapshot reads (visibility/depth/scroll
 * components live on subclasses, not the GameObject base). */
type WorldDrawable = Phaser.GameObjects.GameObject & {
    visible?: boolean;
    depth?: number;
    scrollFactorX?: number;
};

/** The world-scene surface the map talks to (scene-to-scene reads, like getAvatarTile). */
interface WorldSceneApi extends Phaser.Scene {
    getAvatarTile?: () => { tileX: number; tileY: number };
    getTendNextTile?: () => { tileX: number; tileY: number } | null;
    canDropAt?: (tileX: number, tileY: number) => boolean;
}

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
    /** The live miniature of the world, repainted on every open. */
    private worldRT: Phaser.GameObjects.RenderTexture | null = null;
    /** Canvas-renderer only: slow refresh while visible (see show()). */
    private repaintTimer: Phaser.Time.TimerEvent | null = null;
    private mapW = 0;
    private mapH = 0;
    private unsubToggle: (() => void) | null = null;
    private visible = false;
    private reducedMotion = false;

    constructor() {
        super({ key: "map", active: false, visible: false });
    }

    create(): void {
        this.bus = this.registry.get("bus") as TypedBus;
        this.plan = buildWorldPlan();
        this.reducedMotion = this.registry.get("reducedMotion") as boolean ?? false;

        this.overlayCam = this.cameras.main;
        this.overlayCam.setBackgroundColor(0x0a120e);
        this.overlayCam.setScroll(0, 0);

        this.miniRoot = this.add.container(0, 0);
        this.renderMiniMap();

        this.unsubToggle = this.bus.on("map:toggle", () => {
            this.toggle();
        });
        // Phaser never auto-calls a `shutdown()` method — hook the event for the bus cleanup.
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.unsubToggle?.();
            this.unsubToggle = null;
        });

        this.input.keyboard?.on("keydown-ESC", () => this.hide());

        // Start hidden WITHOUT scene.stop(): stopping emits SHUTDOWN, which destroys every
        // display-list child — the whole painted mini-map — so the overlay would reopen as a
        // bare background. Hiding is a visibility/active flag flip only.
        this.hide();
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
        this.input.enabled = true;
        this.visible = true;
        this.bus.emit("map:visible", { open: true });
        this.updateMarkers();
        // Paint LAST: under the Canvas renderer, creating pooled-canvas objects (the marker
        // texts) can invalidate the miniature's backing store; painting after them survives.
        this.paintWorldSnapshot();
        if (this.game.renderer.type === Phaser.CANVAS && !this.repaintTimer) {
            // Canvas-mode insurance: other scenes keep allocating pooled canvases while the
            // map is open (world FX texts), which can wipe the miniature again — refresh it
            // on a slow tick. WebGL renders to its own framebuffer and never needs this.
            this.repaintTimer = this.time.addEvent({
                delay: 400,
                loop: true,
                callback: () => this.paintWorldSnapshot(),
            });
        }
    }

    private hide(): void {
        this.visible = false;
        // Gate input EXPLICITLY: Phaser routes pointer events by scene *status* alone
        // (Systems.canInput ignores the active/visible flags), and SceneManager.create()
        // forces status back to RUNNING after create() returns — clobbering the pause from
        // the boot-time hide() below. Without this line the hidden map keeps a live
        // full-screen click-catcher until the first open, and clicks during play teleport.
        this.input.enabled = false;
        this.scene.setVisible(false);
        this.scene.setActive(false);
        this.bus.emit("map:visible", { open: false });
        this.repaintTimer?.remove();
        this.repaintTimer = null;
    }

    private renderMiniMap(): void {
        const ts = DISPLAY.tile;
        const scale = MAP_SCALE;
        const w = this.plan.widthTiles * ts * scale;
        const h = this.plan.heightTiles * ts * scale;
        this.mapW = w;
        this.mapH = h;

        // Warm wood frame over the deep-forest ground — the map is furniture in the same
        // cabin as the Keeper's parchment, not a debug schematic (neon green banned).
        const bg = this.add.rectangle(w / 2, h / 2, w + 40, h + 40, 0x1a2b1e, 0.95);
        bg.setStrokeStyle(4, 0x6b4a2f);
        this.miniRoot.add(bg);

        // The miniature itself: the world's display list drawn small (paintWorldSnapshot).
        // Its camera maps world px → map px once; every open just clears and redraws.
        // Integer texture size — fractional canvas dimensions corrupt the backing store.
        this.worldRT = this.add.renderTexture(0, 0, Math.round(w), Math.round(h)).setOrigin(0, 0);
        this.worldRT.camera.setZoom(scale);
        this.worldRT.camera.centerOn(this.plan.widthTiles * ts / 2, this.plan.heightTiles * ts / 2);
        this.miniRoot.add(this.worldRT);

        // Whole-map click-catcher: click a spot to drop in there (open grass only). Added
        // beneath everything interactive so the waystone dots (added later) win their clicks.
        const clickZone = this.add.zone(w / 2, h / 2, w, h);
        clickZone.setInteractive({ useHandCursor: true });
        clickZone.on(
            "pointerdown",
            (_pointer: Phaser.Input.Pointer, localX: number, localY: number) => {
                this.tryDropIn(
                    Math.floor(localX / (ts * scale)),
                    Math.floor(localY / (ts * scale)),
                    localX,
                    localY,
                );
            },
        );
        this.miniRoot.add(clickZone);

        for (const region of this.plan.regions) {
            const rx = region.rect.x * ts * scale;
            const ry = region.rect.y * ts * scale;
            const rw = region.rect.w * ts * scale;

            const label = this.add.text(rx + rw / 2, ry + 8, SECTION_LABELS[region.section], {
                fontFamily: "\"Varela Round\", Inter, system-ui, sans-serif",
                fontSize: "16px",
                color: "#f6ead8",
                backgroundColor: "#1a2b1eb0",
                padding: { x: 8, y: 3 },
            }).setOrigin(0.5, 0);
            this.miniRoot.add(label);

            // Waystone dot (clickable fast-travel; the stone itself is in the miniature)
            const ws = region.waystone;
            const wsX = ws.tileX * ts * scale + ts * scale / 2;
            const wsY = ws.tileY * ts * scale + ts * scale / 2;
            const wayDot = this.add.circle(wsX, wsY, 9, 0xffe066);
            wayDot.setStrokeStyle(2, 0x1a2b1e);
            wayDot.setInteractive({ useHandCursor: true });
            wayDot.on("pointerdown", () => {
                this.bus.emit("map:travel", { waystoneId: region.section });
                this.hide();
            });
            this.miniRoot.add(wayDot);
        }

        const hint = this.add.text(
            w / 2,
            h + 16,
            "click any grassy spot to drop in there · gold dots fast-travel · Esc closes",
            {
                fontFamily: "\"Varela Round\", Inter, system-ui, sans-serif",
                fontSize: "13px",
                color: "#cbbd9d",
            },
        ).setOrigin(0.5, 0.5);
        this.miniRoot.add(hint);

        this.overlayCam.centerOn(w / 2, h / 2);
        this.overlayCam.setZoom(Math.min(
            (this.scale.width - 40) / (w + 40),
            (this.scale.height - 40) / (h + 40),
        ));
    }

    /** Redraw the world into the miniature — called on every open, so the map always shows
     * the garden exactly as it stands right now: painted ground, the flora carpet, grown
     * plants, props, critters, the Keeper, the avatar. Skips the screen-space FX band
     * (sky tint, weather, prompts — depth ≥ 8000), camera-fixed objects (scrollFactor 0),
     * transient particles, and anything hidden. Depth-sorting the copy (stable, so equal
     * depths keep add order) reproduces the world's own painter order. */
    private paintWorldSnapshot(): void {
        const rt = this.worldRT;
        const world = this.scene.get("world");
        if (!rt || !world) {
            return;
        }
        const drawables = (world.children.list as WorldDrawable[])
            .filter((o) =>
                (o.visible ?? true)
                && (o.depth ?? 0) < FX_DEPTH_BAND
                && (o.scrollFactorX ?? 1) !== 0
                && !(o instanceof Phaser.GameObjects.Particles.ParticleEmitter)
            )
            .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
        rt.clear();
        rt.draw(drawables);
    }

    /** Click → tile: teleport when the world approves the landing; flash a denial else. */
    private tryDropIn(tileX: number, tileY: number, mapX: number, mapY: number): void {
        if (!this.visible) {
            // Belt-and-braces: a closed map must never move the avatar, whatever input
            // path delivered the click.
            return;
        }
        const world = this.scene.get("world") as WorldSceneApi;
        if (world?.canDropAt?.(tileX, tileY)) {
            this.bus.emit("map:teleport", { tileX, tileY });
            this.hide();
            return;
        }
        // Denied (water/path/props): a brief red ring; the map stays open.
        const ring = this.add.circle(mapX, mapY, 10);
        ring.setStrokeStyle(3, 0xd8484a, 0.9);
        this.miniRoot.add(ring);
        if (this.reducedMotion) {
            this.time.delayedCall(420, () => ring.destroy());
        } else {
            this.tweens.add({
                targets: ring,
                scale: 2.2,
                alpha: 0,
                duration: 420,
                ease: "Cubic.easeOut",
                onComplete: () => ring.destroy(),
            });
        }
    }

    private updateMarkers(): void {
        const world = this.scene.get("world") as WorldSceneApi;
        const ts = DISPLAY.tile;
        const scale = MAP_SCALE;

        // Remove old dynamic markers
        this.miniRoot.getAll().filter((o) => o.getData("dynamic")).forEach((o) => o.destroy());

        const avatar = world?.getAvatarTile?.();
        // Off-map means the Overlook (the floating stats island east of the plan rect)
        // — the miniature only knows the garden, so the dot would float outside the frame.
        const onMap = avatar
            && avatar.tileX >= 0 && avatar.tileX < this.plan.widthTiles
            && avatar.tileY >= 0 && avatar.tileY < this.plan.heightTiles;
        if (avatar && onMap) {
            const dot = this.add.circle(
                avatar.tileX * ts * scale + ts * scale / 2,
                avatar.tileY * ts * scale + ts * scale / 2,
                7,
                0x5cb848,
            );
            dot.setData("dynamic", true);
            dot.setStrokeStyle(3, 0xffffff);
            this.miniRoot.add(dot);
        }

        const tend = world?.getTendNextTile?.();
        if (tend) {
            const star = this.add.star(
                tend.tileX * ts * scale + ts * scale / 2,
                tend.tileY * ts * scale + ts * scale / 2,
                5,
                5,
                10,
                0xffe066,
            );
            star.setData("dynamic", true);
            this.miniRoot.add(star);
            const tag = this.add.text(
                tend.tileX * ts * scale,
                tend.tileY * ts * scale - 16,
                "Tend next",
                {
                    fontSize: "12px",
                    color: "#ffe066",
                    fontFamily: "\"Varela Round\", Inter, system-ui, sans-serif",
                },
            ).setOrigin(0.5, 1);
            tag.setData("dynamic", true);
            this.miniRoot.add(tag);
        }

        // The same mood the actual screen has: the world's sky tint, multiplied over the
        // miniature (half strength keeps the map readable at night).
        const sky = skyStateFor(new Date());
        const tint = this.add.rectangle(
            this.mapW / 2,
            this.mapH / 2,
            this.mapW + 40,
            this.mapH + 40,
            sky.tint,
            sky.ambientAlpha * 0.5,
        );
        tint.setBlendMode(Phaser.BlendModes.MULTIPLY);
        tint.setData("dynamic", true);
        this.miniRoot.add(tint);
    }
}
