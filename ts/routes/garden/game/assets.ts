// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: asset loader + runtime placeholder textures (doc 23 §9.2). Every texture goes
// through ensureTexture so the game is playable with zero binary assets.
import type Phaser from "phaser";

import { type GrowthStage, STAGE_ORDER } from "../state/stage";

/** Display heights on the 32px tile grid (doc task B). */
export const DISPLAY = {
    tile: 32,
    plantHeight: 48,
    avatarHeight: 40,
    keeperHeight: 56,
    propScale: 1.0,
} as const;

type UrlModule = { default?: string };

const globModules = import.meta.glob("../assets/**/*.png", {
    eager: true,
    query: "?url",
    import: "default",
}) as Record<string, string | UrlModule>;

function basenameKey(path: string): string {
    const file = path.split("/").pop() ?? path;
    return file.replace(/\.png$/i, "");
}

const URL_BY_KEY = new Map<string, string>();
for (const [path, mod] of Object.entries(globModules)) {
    const url = typeof mod === "string" ? mod : mod.default;
    if (url) {
        URL_BY_KEY.set(basenameKey(path), url);
    }
}

let manifestLoaded = false;

// Optional manifest: resolved through a lazy glob so the production build never fails when
// the file is absent (a bare dynamic import would be a hard Rollup resolve error).
const manifestModules = import.meta.glob("../assets/manifest.json", {
    import: "default",
});

async function loadManifest(): Promise<void> {
    if (manifestLoaded) {
        return;
    }
    manifestLoaded = true;
    try {
        for (const loader of Object.values(manifestModules)) {
            const manifest = (await loader()) as Record<string, string>;
            for (const [key, path] of Object.entries(manifest)) {
                if (!URL_BY_KEY.has(key) && path) {
                    URL_BY_KEY.set(key, path);
                }
            }
        }
    } catch {
        // manifest optional until the art pipeline lands
    }
}

export function hasAssetKey(key: string): boolean {
    return URL_BY_KEY.has(key);
}

export function stageTextureKey(stage: GrowthStage): string {
    const idx = STAGE_ORDER.indexOf(stage);
    return `plant-stage-${String(idx).padStart(2, "0")}-${stage}`;
}

export function regionGrassKey(region: string, variant: number): string {
    return `tile-${region}-grass-${String(variant).padStart(2, "0")}`;
}

export function regionPathKey(region: string, variant: number): string {
    return `tile-${region}-path-${String(variant).padStart(2, "0")}`;
}

/** Preload discovered PNG URLs into Phaser (BootScene). */
export async function preloadDiscoveredAssets(scene: Phaser.Scene): Promise<void> {
    await loadManifest();
    for (const [key, url] of URL_BY_KEY) {
        if (!scene.textures.exists(key)) {
            scene.load.image(key, url);
        }
    }
    if (scene.load.totalToLoad > 0) {
        await new Promise<void>((resolve) => {
            scene.load.once("complete", () => resolve());
            scene.load.start();
        });
    }
}

const generated = new Set<string>();

function drawPlantStage(g: Phaser.GameObjects.Graphics, stage: GrowthStage): void {
    const w = 32;
    const h = 48;
    g.clear();
    g.fillStyle(0x6b4a2f, 1);
    g.fillEllipse(w / 2, h - 6, 22, 10);

    switch (stage) {
        case "bare-soil":
            g.fillStyle(0x5a4030, 1);
            g.fillRect(10, h - 14, 12, 4);
            break;
        case "sprout":
            g.lineStyle(3, 0x4a8f3a, 1);
            g.lineBetween(w / 2, h - 10, w / 2, h - 28);
            break;
        case "seedling":
            g.lineStyle(3, 0x3d7a32, 1);
            g.lineBetween(w / 2, h - 10, w / 2, h - 30);
            g.fillStyle(0x5cb848, 1);
            g.fillEllipse(w / 2 - 8, h - 26, 10, 6);
            g.fillEllipse(w / 2 + 8, h - 26, 10, 6);
            break;
        case "growing":
            g.fillStyle(0x3d7a32, 1);
            g.fillCircle(w / 2, h - 22, 12);
            g.fillStyle(0x5cb848, 1);
            g.fillCircle(w / 2 - 10, h - 18, 8);
            g.fillCircle(w / 2 + 10, h - 18, 8);
            break;
        case "budding":
            g.fillStyle(0x3d7a32, 1);
            g.fillCircle(w / 2, h - 20, 10);
            g.fillStyle(0x8b6914, 1);
            g.fillCircle(w / 2, h - 32, 9);
            break;
        case "bloomed":
            g.fillStyle(0x3d7a32, 1);
            g.fillCircle(w / 2, h - 18, 8);
            g.fillStyle(0xf9c5d5, 1);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
                g.fillCircle(w / 2 + Math.cos(a) * 10, h - 34 + Math.sin(a) * 10, 6);
            }
            g.fillStyle(0xffe066, 0.5);
            g.fillCircle(w / 2, h - 34, 14);
            break;
        case "drooping":
            g.lineStyle(3, 0x4a8f3a, 1);
            g.beginPath();
            // A bent-over stem: two segments approximate the droop curve (Phaser's
            // Graphics path API has no quadratic bezier).
            g.moveTo(w / 2, h - 10);
            g.lineTo(w / 2 + 10, h - 22);
            g.lineTo(w / 2 + 14, h - 8);
            g.strokePath();
            g.fillStyle(0x5cb848, 1);
            g.fillEllipse(w / 2 + 10, h - 10, 8, 5);
            break;
        case "weedy":
            g.fillStyle(0x3d7a32, 1);
            g.fillCircle(w / 2, h - 20, 10);
            g.fillStyle(0x2a4020, 1);
            g.fillTriangle(w / 2 - 12, h - 8, w / 2 - 8, h - 20, w / 2 - 4, h - 8);
            g.fillTriangle(w / 2 + 12, h - 8, w / 2 + 8, h - 20, w / 2 + 4, h - 8);
            break;
        default: {
            const _exhaustive: never = stage;
            return _exhaustive;
        }
    }
}

function generatePlaceholder(scene: Phaser.Scene, key: string): void {
    if (generated.has(key) || scene.textures.exists(key)) {
        return;
    }
    const g = scene.make.graphics({ x: 0, y: 0 }, false);

    if (key.startsWith("plant-stage-")) {
        const stage = key.replace(/^plant-stage-\d{2}-/, "") as GrowthStage;
        drawPlantStage(g, stage);
        g.generateTexture(key, 32, 48);
        g.destroy();
        generated.add(key);
        return;
    }

    if (key.startsWith("tile-")) {
        const isPath = key.includes("-path-");
        const isPond = key.includes("-pond-");
        const region = key.split("-")[1] ?? "sakura";
        const palette: Record<string, { grass: number; path: number; pond: number }> = {
            sakura: { grass: 0x7dba6a, path: 0xc4a882, pond: 0x2e4756 },
            keukenhof: { grass: 0x5cb848, path: 0xd4c4a0, pond: 0x2a9d8f },
            versailles: { grass: 0x2f5d3a, path: 0xeae3d2, pond: 0x3a6ea5 },
            "gardens-by-the-bay": { grass: 0x141b34, path: 0x9d4edd, pond: 0x0e7c7b },
        };
        const regionPalette = palette[region];
        let fill = 0x6b8e4e;
        if (regionPalette) {
            if (isPond) {
                fill = regionPalette.pond;
            } else if (isPath) {
                fill = regionPalette.path;
            } else {
                fill = regionPalette.grass;
            }
        }
        g.fillStyle(fill, 1);
        g.fillRect(0, 0, DISPLAY.tile, DISPLAY.tile);
        if (isPath) {
            g.fillStyle(0x000000, 0.08);
            g.fillRect(2, 2, DISPLAY.tile - 4, DISPLAY.tile - 4);
        }
        g.generateTexture(key, DISPLAY.tile, DISPLAY.tile);
        g.destroy();
        generated.add(key);
        return;
    }

    if (key.startsWith("gardener-")) {
        g.fillStyle(0x4a7c59, 1);
        g.fillCircle(16, 10, 8);
        g.fillStyle(0x8b5a2b, 1);
        g.fillRect(10, 18, 12, 16);
        g.fillStyle(0x3d2817, 1);
        g.fillRect(8, 32, 6, 8);
        g.fillRect(18, 32, 6, 8);
        g.generateTexture(key, 32, 40);
        g.destroy();
        generated.add(key);
        return;
    }

    if (key.startsWith("keeper-")) {
        g.fillStyle(0x6b5b95, 1);
        g.fillCircle(20, 14, 10);
        g.fillStyle(0x4a4060, 1);
        g.fillRect(12, 24, 16, 22);
        g.fillStyle(0xffe066, 0.6);
        g.fillCircle(20, 8, 6);
        g.generateTexture(key, 40, 56);
        g.destroy();
        generated.add(key);
        return;
    }

    if (key.startsWith("prop-")) {
        if (key.includes("lantern")) {
            g.fillStyle(0xb33951, 1);
            g.fillRect(8, 12, 16, 20);
            g.fillStyle(0xffe066, 0.8);
            g.fillCircle(16, 22, 6);
        } else if (key.includes("bridge")) {
            g.fillStyle(0xb33951, 1);
            g.fillEllipse(24, 20, 40, 16);
        } else if (key.includes("cherry") || key.includes("tree") || key.includes("supertree")) {
            g.fillStyle(0x5b3d2a, 1);
            g.fillRect(14, 20, 8, 24);
            g.fillStyle(0xf9c5d5, 1);
            g.fillCircle(18, 14, 16);
        } else {
            g.fillStyle(0x7dba6a, 1);
            g.fillCircle(16, 16, 14);
        }
        g.generateTexture(key, 48, 48);
        g.destroy();
        generated.add(key);
        return;
    }

    if (key === "gate-open") {
        g.lineStyle(2, 0x5cb848, 1);
        g.strokeRect(4, 0, 24, 32);
        g.generateTexture(key, 32, 32);
        g.destroy();
        generated.add(key);
        return;
    }

    if (key.startsWith("gate")) {
        g.fillStyle(0x8b6914, 1);
        g.fillRect(4, 0, 24, 32);
        g.lineStyle(2, 0x5a4030, 1);
        g.strokeRect(4, 0, 24, 32);
        g.generateTexture(key, 32, 32);
        g.destroy();
        generated.add(key);
        return;
    }

    if (key.startsWith("fx-")) {
        g.fillStyle(0x6ec5ff, 1);
        g.fillCircle(4, 4, 4);
        g.generateTexture(key, 8, 8);
        g.destroy();
        generated.add(key);
        return;
    }

    g.fillStyle(0xff00ff, 0.3);
    g.fillRect(0, 0, 16, 16);
    g.lineStyle(1, 0xff00ff, 1);
    g.strokeRect(0, 0, 16, 16);
    g.generateTexture(key, 16, 16);
    g.destroy();
    generated.add(key);
}

/** Ensure a texture exists — sliced art if present, else generated placeholder. */
export function ensureTexture(scene: Phaser.Scene, key: string): string {
    if (scene.textures.exists(key)) {
        return key;
    }
    generatePlaceholder(scene, key);
    return key;
}

/** Apply canonical display size for a sprite key. */
export function applyDisplaySize(sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    const key = sprite.texture.key;
    if (key.startsWith("plant-stage-")) {
        sprite.setDisplaySize(32, DISPLAY.plantHeight);
    } else if (key.startsWith("gardener-")) {
        sprite.setDisplaySize(32, DISPLAY.avatarHeight);
    } else if (key.startsWith("keeper-")) {
        sprite.setDisplaySize(40, DISPLAY.keeperHeight);
    } else if (key.startsWith("tile-")) {
        sprite.setDisplaySize(DISPLAY.tile, DISPLAY.tile);
    } else if (key.startsWith("prop-")) {
        sprite.setDisplaySize(48 * DISPLAY.propScale, 48 * DISPLAY.propScale);
    }
}

/** Generate all stage placeholders up front (BootScene). */
export function ensureAllStageTextures(scene: Phaser.Scene): void {
    for (const stage of STAGE_ORDER) {
        ensureTexture(scene, stageTextureKey(stage));
    }
    ensureTexture(scene, "gardener-idle-down");
    ensureTexture(scene, "gardener-idle-up");
    ensureTexture(scene, "gardener-idle-side-a");
    ensureTexture(scene, "gardener-idle-side-b");
    ensureTexture(scene, "gardener-walk-down-a");
    ensureTexture(scene, "gardener-walk-down-b");
    ensureTexture(scene, "fx-droplet");
    ensureTexture(scene, "keeper-meditating");
    ensureTexture(scene, "gate-closed");
    ensureTexture(scene, "gate-open");
}

export function regionThemeFromSection(section: string): string {
    switch (section) {
        case "P-S":
            return "sakura";
        case "B-B":
            return "keukenhof";
        case "C-P":
            return "versailles";
        case "CARS":
            return "gardens-by-the-bay";
        default:
            return "sakura";
    }
}
