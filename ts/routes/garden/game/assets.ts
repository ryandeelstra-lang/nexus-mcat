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
        // Production glob URLs are emitted relative to the CHUNK ("../assets/x.hash.png");
        // Phaser would resolve them against the page URL and 404. Absolutize against this
        // module's own URL so both dev ("/...") and prod resolve correctly.
        URL_BY_KEY.set(basenameKey(path), new URL(url, import.meta.url).href);
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

/** Resolve a bundled asset's URL by basename key (e.g. "keeper-portrait") for the DOM layer. */
export function assetUrl(key: string): string | undefined {
    return URL_BY_KEY.get(key);
}

/** All discovered asset keys (the cinematic renderer uses this for selective preloads). */
export function allAssetKeys(): string[] {
    return [...URL_BY_KEY.keys()];
}

/**
 * Texture key for a growth stage. With a region theme (e.g. "keukenhof") this
 * prefers that region's own species art — tulips in Keukenhof, roses in
 * Versailles, orchids in Gardens by the Bay, cherry in Sakura — and falls back
 * to the global set whenever the themed sprite hasn't shipped.
 */
export function stageTextureKey(stage: GrowthStage, theme?: string): string {
    const idx = String(STAGE_ORDER.indexOf(stage)).padStart(2, "0");
    if (theme) {
        const themed = `plant-${theme}-stage-${idx}-${stage}`;
        if (URL_BY_KEY.has(themed)) {
            return themed;
        }
    }
    return `plant-stage-${idx}-${stage}`;
}

/** Reverse-parse the stage name out of any plant texture key (global or themed). */
const STAGE_KEY_RE = /^plant(?:-[a-z0-9-]+)?-stage-\d{2}-(.+)$/;

export function stageFromTextureKey(key: string): GrowthStage | null {
    const m = STAGE_KEY_RE.exec(key);
    return m ? (m[1] as GrowthStage) : null;
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
    // NOTE: Phaser's totalToLoad is only computed by start() — gate on the PENDING list
    // (load.list) or the loader never runs and every texture silently falls back.
    if (scene.load.list.size > 0) {
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
        case "flourishing":
            // A denser double ring of petals — visibly richer than "bloomed".
            g.fillStyle(0x3d7a32, 1);
            g.fillCircle(w / 2, h - 16, 9);
            g.fillStyle(0xf9c5d5, 1);
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
                g.fillCircle(w / 2 + Math.cos(a) * 11, h - 34 + Math.sin(a) * 11, 6);
            }
            g.fillStyle(0xfde4ec, 1);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
                g.fillCircle(w / 2 + Math.cos(a) * 5, h - 34 + Math.sin(a) * 5, 4);
            }
            g.fillStyle(0xffe066, 0.6);
            g.fillCircle(w / 2, h - 34, 15);
            break;
        case "radiant":
            // The pinnacle: flourishing plus a golden halo and sparkle dots.
            g.fillStyle(0xffe066, 0.25);
            g.fillCircle(w / 2, h - 32, 15);
            g.fillStyle(0x3d7a32, 1);
            g.fillCircle(w / 2, h - 16, 9);
            g.fillStyle(0xf9c5d5, 1);
            for (let i = 0; i < 8; i++) {
                const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
                g.fillCircle(w / 2 + Math.cos(a) * 11, h - 33 + Math.sin(a) * 11, 6);
            }
            g.fillStyle(0xfff3f8, 1);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
                g.fillCircle(w / 2 + Math.cos(a) * 5, h - 33 + Math.sin(a) * 5, 4);
            }
            g.fillStyle(0xffe066, 0.9);
            g.fillCircle(w / 2, h - 33, 3);
            g.fillStyle(0xfffbe6, 1);
            g.fillCircle(w / 2 - 12, h - 44, 1.5);
            g.fillCircle(w / 2 + 13, h - 40, 1.5);
            g.fillCircle(w / 2 + 2, h - 48, 1.5);
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

    const placeholderStage = stageFromTextureKey(key);
    if (placeholderStage) {
        drawPlantStage(g, placeholderStage);
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

    // Ground-flora growth stages (watering redesign 2026-07-03). The bloom uses real
    // per-region art; sprout/bud are generated pixel shoots so every species grows the
    // same readable way. Bud keys carry their species tint: "flora-bud-e87ea1".
    if (key === "flora-sprout") {
        g.fillStyle(0x3d7a32, 1);
        g.fillRect(7, 8, 2, 6);
        g.fillStyle(0x5cb848, 1);
        g.fillRect(4, 6, 3, 2);
        g.fillRect(9, 5, 3, 2);
        g.fillRect(6, 4, 2, 2);
        g.generateTexture(key, 16, 14);
        g.destroy();
        generated.add(key);
        return;
    }

    if (key.startsWith("flora-bud-") || key.startsWith("flora-bloom-")) {
        const isBloom = key.startsWith("flora-bloom-");
        const tint = parseInt(key.slice(key.lastIndexOf("-") + 1), 16);
        g.fillStyle(0x3d7a32, 1);
        g.fillRect(7, 10, 2, 8);
        g.fillStyle(0x5cb848, 1);
        g.fillRect(4, 12, 3, 2);
        g.fillRect(9, 11, 3, 2);
        if (isBloom) {
            g.fillStyle(tint, 1);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
                g.fillCircle(8 + Math.cos(a) * 4, 6 + Math.sin(a) * 4, 3);
            }
            g.fillStyle(0xffe066, 0.9);
            g.fillCircle(8, 6, 2);
        } else {
            // A closed bud: species-tinted teardrop over green sepals.
            g.fillStyle(0x4a8f3a, 1);
            g.fillCircle(8, 9, 3);
            g.fillStyle(tint, 1);
            g.fillCircle(8, 7, 3);
            g.fillRect(7, 3, 2, 3);
        }
        g.generateTexture(key, 16, 18);
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

    if (key.startsWith("foliage-")) {
        g.fillStyle(0x5b3d2a, 1);
        g.fillRect(20, 30, 8, 14);
        g.fillStyle(0x4a7c3f, 1);
        g.fillCircle(24, 20, 16);
        g.generateTexture(key, 48, 48);
        g.destroy();
        generated.add(key);
        return;
    }

    if (key.startsWith("struct-")) {
        g.fillStyle(0x8b6914, 1);
        g.fillRect(8, 16, 32, 28);
        g.fillStyle(0xb33951, 1);
        g.fillTriangle(4, 18, 24, 2, 44, 18);
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

/** Per-stage display heights in tiles (art is aspect-preserved, so wide flat
 * stages like bare soil must not be as tall as the bloomed plant). Typed over
 * GrowthStage so a new stage cannot silently fall back to the generic height. */
const STAGE_HEIGHT_TILES: Record<GrowthStage, number> = {
    "bare-soil": 0.85,
    "sprout": 0.9,
    "seedling": 1.1,
    "growing": 1.35,
    "budding": 1.4,
    "bloomed": 1.65,
    "flourishing": 1.85,
    "radiant": 2.1,
    "drooping": 1.1,
    "weedy": 1.4,
};

/** Display heights (in tiles) for named world sprites; aspect ratio is preserved. */
const HEIGHT_TILES: Array<[RegExp, number]> = [
    [/^struct-landmark-keukenhof-windmill/, 5.5],
    [/^struct-landmark-versailles-fountain/, 4.0],
    [/^struct-landmark-gardens-supertrees/, 5.5],
    [/^struct-landmark-sakura-pond/, 3.2],
    [/^struct-bridge-/, 3.6],
    [/^struct-waystone-/, 2.4],
    [/^struct-gate-/, 1.8],
    [/^struct-gazebo/, 4.2],
    [/^struct-/, 4.0],
    [/^prop-sakura-cherry-tree/, 3.0],
    [/^prop-sakura-lantern/, 1.3],
    [/^prop-keukenhof-10$/, 3.4],
    [/^prop-keukenhof-36$/, 3.8],
    [/^prop-versailles-r0-03$/, 3.0],
    [/^prop-versailles-sig-01$/, 3.2],
    [/^prop-gardens-by-the-bay-09$/, 3.6],
    [/^prop-/, 1.5],
    [/^foliage-/, 1.4],
];

/** Scale a sprite to a height in tiles, preserving the source aspect ratio. */
export function sizeToHeightTiles(
    sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
    hTiles: number,
): void {
    const src = sprite.texture.getSourceImage();
    const h = hTiles * DISPLAY.tile;
    const w = src.height > 0 ? (src.width / src.height) * h : h;
    sprite.setDisplaySize(w, h);
}

/** Apply canonical display size for a sprite key. */
export function applyDisplaySize(sprite: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite): void {
    const key = sprite.texture.key;
    const sizeStage = stageFromTextureKey(key);
    if (sizeStage) {
        sizeToHeightTiles(
            sprite,
            STAGE_HEIGHT_TILES[sizeStage] ?? DISPLAY.plantHeight / DISPLAY.tile,
        );
    } else if (key.startsWith("gardener-")) {
        sprite.setDisplaySize(32, DISPLAY.avatarHeight);
    } else if (key.startsWith("keeper-")) {
        sprite.setDisplaySize(40, DISPLAY.keeperHeight);
    } else if (key.startsWith("tile-")) {
        sprite.setDisplaySize(DISPLAY.tile, DISPLAY.tile);
    } else {
        for (const [re, h] of HEIGHT_TILES) {
            if (re.test(key)) {
                sizeToHeightTiles(sprite, h);
                return;
            }
        }
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
    ensureTexture(scene, "gardener-walk-down-c");
    ensureTexture(scene, "gardener-walk-down-d");
    ensureTexture(scene, "gardener-walk-up-a");
    ensureTexture(scene, "gardener-walk-up-b");
    ensureTexture(scene, "gardener-walk-up-c");
    ensureTexture(scene, "gardener-walk-up-d");
    ensureTexture(scene, "gardener-walk-side-a");
    ensureTexture(scene, "gardener-walk-side-b");
    ensureTexture(scene, "gardener-walk-side-c");
    ensureTexture(scene, "gardener-walk-side-d");
    ensureTexture(scene, "gardener-walk-downleft-a");
    ensureTexture(scene, "gardener-walk-downleft-b");
    ensureTexture(scene, "gardener-walk-downleft-c");
    ensureTexture(scene, "gardener-walk-downleft-d");
    ensureTexture(scene, "gardener-walk-upleft-a");
    ensureTexture(scene, "gardener-walk-upleft-b");
    ensureTexture(scene, "gardener-walk-upleft-c");
    ensureTexture(scene, "gardener-walk-upleft-d");
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
