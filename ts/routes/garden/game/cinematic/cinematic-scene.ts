// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the intro cinematic world — "The Keeper's Garden" (video/STORYBOARD.md).
// Every visual is a pure function of timeline t via applyTime(t), so the headless
// renderer can seek any frame deterministically. Uses ONLY shipped game assets +
// the game's worldgen layout (doc 23 §6). Screen-space grading lives in CineSkyScene.
import Phaser from "phaser";

import { BLOOMED_TIER, type GrowthStage } from "../../state/stage";
import {
    allAssetKeys,
    applyDisplaySize,
    DISPLAY,
    ensureTexture,
    regionThemeFromSection,
    stageTextureKey,
} from "../assets";
import { buildWorldPlan, KEEPER_TILE, type WorldPlan } from "../worldgen";

import {
    BEATS,
    cameraAt,
    DECAY_FLIP_T,
    dressingAlphaAt,
    easeOut,
    GATE_REOPEN_T,
    HERO_BLOOM_T,
    HERO_PLANT,
    HERO_WATER,
    heroStageAt,
    keeperAt,
    plantStageAt,
    rng,
    span,
    SPROUT_T,
    SPROUT_TILE,
    studentAt,
    weedAlphaAt,
} from "./timeline";

const TS = DISPLAY.tile;

interface PlantSprite {
    sprite: Phaser.GameObjects.Image;
    glow: Phaser.GameObjects.Image;
    tileX: number;
    tileY: number;
    seed: number;
    region: string;
}

interface DressSprite {
    sprite: Phaser.GameObjects.Image;
    seed: number;
}

/** Curated ground variants — full-grass tiles only (others are stone/parterre features). */
const GRASS_VARIANTS: Record<string, number[]> = {
    sakura: [0, 0, 0, 1],
    keukenhof: [0, 1, 2, 4, 5, 8, 9, 10],
    versailles: [1],
    "gardens-by-the-bay": [0, 1, 2],
};

/** Curated path variants per region. */
const PATH_VARIANTS: Record<string, number[]> = {
    sakura: [0, 1, 2],
    keukenhof: [0, 2, 4],
    versailles: [0],
    "gardens-by-the-bay": [1, 2, 3],
};

/** Interior (edge-free) pond variants per region. */
const POND_VARIANTS: Record<string, number[]> = {
    sakura: [3, 4],
    keukenhof: [0, 1, 2, 3],
    "gardens-by-the-bay": [0, 1],
};

/** Fixed display widths (px) for oversized structure renders. */
const STRUCT_WIDTH: Record<string, number> = {
    "struct-gazebo": 150,
    "struct-home-base": 140,
    "struct-shop": 120,
    "struct-barn-full": 110,
    "struct-barn-empty": 110,
    "struct-waystone-active": 40,
    "struct-waystone-dormant": 40,
    "struct-gate-open": 64,
    "struct-gate-locked": 64,
    "struct-landmark-sakura-pond": 150,
    "struct-landmark-keukenhof-windmill": 110,
    "struct-landmark-versailles-fountain": 150,
    "struct-landmark-gardens-supertrees": 170,
    "struct-bridge-sakura": 96,
};

function pick(list: number[], n: number): number {
    return list[n % list.length];
}

/** Frame name for a border-trimmed view of a tile slice (kills baked-in grid lines). */
const TRIM_FRAME = "trim";
const TRIM_FRACTION = 0.08;

export class CinematicScene extends Phaser.Scene {
    private plan!: WorldPlan;

    private plants: PlantSprite[] = [];
    private dressing: DressSprite[] = [];
    private weeds: DressSprite[] = [];

    private barn!: Phaser.GameObjects.Image;
    private waystones: Phaser.GameObjects.Image[] = [];
    private gates: Phaser.GameObjects.Image[] = [];
    private southGate!: Phaser.GameObjects.Image;

    private keeper!: Phaser.GameObjects.Image;
    private keeperGlow!: Phaser.GameObjects.Image;
    private student!: Phaser.GameObjects.Image;
    private sprout!: Phaser.GameObjects.Image;
    private sproutSpark!: Phaser.GameObjects.Arc;

    private droplets: Array<{ sprite: Phaser.GameObjects.Image; seed: number }> = [];
    private burstPetals: Array<{ sprite: Phaser.GameObjects.Arc; angle: number }> = [];
    private burstHalo!: Phaser.GameObjects.Image;

    constructor() {
        super("cine");
    }

    create(): void {
        this.plan = buildWorldPlan();

        this.renderSeamFiller();
        this.renderGround();
        this.renderEntrancePath();
        this.renderStructures();
        this.renderDressing();
        this.renderPlants();
        this.renderWeeds();
        this.renderActors();
        this.renderWorldFx();

        this.applyTime(0);
        this.registry.set("cineReady", true);
    }

    // -- world construction ------------------------------------------------

    /** Add a tile image using a border-trimmed frame stretched to the 32px grid. */
    private trimmedTile(x: number, y: number, key: string, depth: number): void {
        ensureTexture(this, key);
        const tex = this.textures.get(key);
        if (!tex.has(TRIM_FRAME)) {
            const src = tex.getSourceImage() as { width: number; height: number };
            const ix = Math.round(src.width * TRIM_FRACTION);
            const iy = Math.round(src.height * TRIM_FRACTION);
            tex.add(TRIM_FRAME, 0, ix, iy, src.width - ix * 2, src.height - iy * 2);
        }
        const img = this.add.image(x * TS, y * TS, key, TRIM_FRAME).setOrigin(0, 0);
        img.setDisplaySize(TS, TS);
        img.setDepth(depth);
    }

    private groundTile(x: number, y: number, theme: string): void {
        const v = pick(GRASS_VARIANTS[theme] ?? [0], (x * 7 + y * 13) >>> 0);
        this.trimmedTile(x, y, `tile-${theme}-grass-${String(v).padStart(2, "0")}`, y);
    }

    private pathTile(x: number, y: number, theme: string, depth: number): void {
        const v = pick(PATH_VARIANTS[theme] ?? [0], (x * 5 + y * 3) >>> 0);
        this.trimmedTile(x, y, `tile-${theme}-path-${String(v).padStart(2, "0")}`, depth);
    }

    /** Fill the seams between the four region rects so wide shots read continuous. */
    private renderSeamFiller(): void {
        for (let y = 0; y < 90; y++) {
            for (let x = 58; x < 62; x++) {
                this.groundTile(x, y, y < 45 ? "sakura" : "versailles");
            }
        }
        for (let x = 0; x < 120; x++) {
            if (x >= 58 && x < 62) {
                continue;
            }
            for (let y = 42; y < 48; y++) {
                this.groundTile(x, y, x < 60 ? "sakura" : "keukenhof");
            }
        }
    }

    private renderGround(): void {
        for (const r of this.plan.regions) {
            const theme = regionThemeFromSection(r.section);
            for (let y = r.rect.y; y < r.rect.y + r.rect.h; y++) {
                for (let x = r.rect.x; x < r.rect.x + r.rect.w; x++) {
                    this.groundTile(x, y, theme);
                }
            }
            const pondTheme = theme === "versailles" ? "keukenhof" : theme;
            const pondVariants = POND_VARIANTS[pondTheme] ?? [0];
            for (const t of r.waterTiles) {
                // Soft stone bank beneath each water tile so streams read as carved
                // channels instead of floating blue squares.
                const bank = this.add.rectangle(
                    t.tileX * TS + TS / 2,
                    t.tileY * TS + TS / 2,
                    TS + 8,
                    TS + 8,
                    0x4d4636,
                    0.85,
                );
                bank.setDepth(t.tileY + 0.09);
                const v = pick(pondVariants, (t.tileX * 11 + t.tileY * 17) >>> 0);
                this.trimmedTile(
                    t.tileX,
                    t.tileY,
                    `tile-${pondTheme}-pond-${String(v).padStart(2, "0")}`,
                    t.tileY + 0.1,
                );
            }
            for (const t of r.trailTiles) {
                this.pathTile(t.tileX, t.tileY, theme, t.tileY + 0.2);
            }
        }
        // Circular gravel apron around the Keeper's gazebo (not the full plaza rect —
        // a solid 30x26 slab reads as a dead rectangle in wide shots).
        for (const t of this.plan.center.plazaTiles) {
            const d = Math.hypot(t.tileX - KEEPER_TILE.tileX, t.tileY - KEEPER_TILE.tileY);
            if (d <= 6.5) {
                this.pathTile(t.tileX, t.tileY, "versailles", t.tileY + 0.15);
            }
        }
        // Spoke paths from the apron to the four region gates.
        for (let x = 45; x < 76; x++) {
            this.pathTile(x, 45, "versailles", 45 + 0.15);
        }
        for (let y = 33; y < 58; y++) {
            this.pathTile(60, y, "versailles", y + 0.15);
        }
    }

    /** South entrance path (plaza rim → world edge) for departure/arrival beats. */
    private renderEntrancePath(): void {
        for (let y = 58; y < 80; y++) {
            for (let x = 59; x <= 61; x++) {
                this.pathTile(x, y, "versailles", y + 0.2);
            }
        }
    }

    private structAt(key: string, tileX: number, tileY: number): Phaser.GameObjects.Image {
        const img = this.add.image(tileX * TS + TS / 2, tileY * TS + TS, ensureTexture(this, key));
        img.setOrigin(0.5, 1);
        const targetW = STRUCT_WIDTH[key] ?? 96;
        const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
        img.setDisplaySize(targetW, targetW * (src.height / src.width));
        img.setDepth(tileY + 0.5);
        return img;
    }

    private retexture(img: Phaser.GameObjects.Image, key: string): void {
        if (img.texture.key === key) {
            return;
        }
        const targetW = STRUCT_WIDTH[key] ?? 96;
        const src = this.textures.get(ensureTexture(this, key)).getSourceImage() as { width: number; height: number };
        img.setTexture(key);
        img.setDisplaySize(targetW, targetW * (src.height / src.width));
    }

    private renderStructures(): void {
        this.structAt("struct-gazebo", KEEPER_TILE.tileX, KEEPER_TILE.tileY - 1);
        this.structAt("struct-home-base", 50, 36);
        this.structAt("struct-shop", 70, 36);
        this.barn = this.structAt("struct-barn-full", 70, 56);

        this.structAt("struct-landmark-sakura-pond", 30, 9);
        this.structAt("struct-landmark-keukenhof-windmill", 100, 9);
        this.structAt("struct-landmark-versailles-fountain", 29, 53);
        this.structAt("struct-landmark-gardens-supertrees", 91, 58);
        this.structAt("struct-bridge-sakura", 29, 22);

        for (const r of this.plan.regions) {
            this.waystones.push(this.structAt("struct-waystone-active", r.waystone.tileX, r.waystone.tileY));
        }
        const gateTiles = [
            { tileX: 58, tileY: 38 },
            { tileX: 58, tileY: 52 },
            { tileX: 62, tileY: 38 },
        ];
        for (const g of gateTiles) {
            this.gates.push(this.structAt("struct-gate-open", g.tileX, g.tileY));
        }
        // The south entrance gate — the one the Keeper leaves through and the
        // student arrives at. Rendered wider to span the entrance path.
        this.southGate = this.structAt("struct-gate-open", 60, 62);
        const gsrc = this.textures.get("struct-gate-open").getSourceImage() as { width: number; height: number };
        this.southGate.setDisplaySize(96, 96 * (gsrc.height / gsrc.width));

        // Plaza lanterns ring the Keeper's clearing.
        const lanternSpots = [
            { x: 55, y: 40 },
            { x: 65, y: 40 },
            { x: 55, y: 50 },
            { x: 65, y: 50 },
            { x: 50, y: 45 },
            { x: 70, y: 45 },
        ];
        for (let i = 0; i < lanternSpots.length; i++) {
            const s = lanternSpots[i];
            const key = ensureTexture(this, i % 2 === 0 ? "prop-sakura-lantern-a" : "prop-sakura-lantern-b");
            const img = this.add.image(s.x * TS + TS / 2, s.y * TS + TS, key);
            img.setOrigin(0.5, 1);
            const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
            img.setDisplaySize(26, 26 * (src.height / src.width));
            img.setDepth(s.y + 0.5);
        }
    }

    private keysMatching(re: RegExp): string[] {
        return allAssetKeys().filter((k) => re.test(k)).sort();
    }

    private renderDressing(): void {
        const flowerSets: Record<string, RegExp> = {
            sakura: /^prop-sakura-flowers-\d\d$/,
            keukenhof: /^prop-keukenhof-\d\d$/,
            versailles: /^prop-versailles-r0-\d\d$/,
            "gardens-by-the-bay": /^prop-gardens-by-the-bay-\d\d$/,
        };
        for (const r of this.plan.regions) {
            const theme = regionThemeFromSection(r.section);
            const foliage = this.keysMatching(new RegExp(`^foliage-${theme}-\\d\\d$`));
            const flowers = this.keysMatching(flowerSets[theme] ?? /$^/);
            const blocked = new Set<string>();
            for (const t of [...r.trailTiles, ...r.waterTiles]) {
                blocked.add(`${t.tileX},${t.tileY}`);
            }
            const rand = rng(0xbeef ^ r.rect.x ^ (r.rect.y << 8));
            const place = (keys: string[], count: number, widthPx: number, offset: number): void => {
                if (keys.length === 0) {
                    return;
                }
                for (let i = 0; i < count; i++) {
                    const tx = r.rect.x + 2 + Math.floor(rand() * (r.rect.w - 4));
                    const ty = r.rect.y + 2 + Math.floor(rand() * (r.rect.h - 4));
                    if (blocked.has(`${tx},${ty}`)) {
                        continue;
                    }
                    const key = ensureTexture(this, keys[Math.floor(rand() * keys.length)]);
                    const img = this.add.image(tx * TS + TS / 2, ty * TS + TS, key);
                    img.setOrigin(0.5, 1);
                    const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
                    img.setDisplaySize(widthPx, widthPx * (src.height / src.width));
                    img.setDepth(ty + 0.45);
                    this.dressing.push({ sprite: img, seed: (tx * 131 + ty * 173 + offset) >>> 0 });
                }
            };
            place(foliage, 85, 46, 0);
            place(flowers, 60, 34, 7919);
        }
    }

    private ornamentalSpots(): Array<{ tileX: number; tileY: number; region: string }> {
        const spots: Array<{ tileX: number; tileY: number; region: string }> = [];
        for (const r of this.plan.regions) {
            const theme = regionThemeFromSection(r.section);
            const water = new Set(r.waterTiles.map((t) => `${t.tileX},${t.tileY}`));
            const trail = new Set(r.trailTiles.map((t) => `${t.tileX},${t.tileY}`));
            const rand = rng(0xf00d ^ r.rect.x ^ (r.rect.y << 8));
            let i = 0;
            for (const t of r.trailTiles) {
                i++;
                if (i % 2 !== 0) {
                    continue;
                }
                const dx = rand() < 0.5 ? -1 - Math.floor(rand() * 2) : 1 + Math.floor(rand() * 2);
                const dy = rand() < 0.5 ? -1 : 1;
                const tx = t.tileX + dx;
                const ty = t.tileY + dy;
                const k = `${tx},${ty}`;
                if (water.has(k) || trail.has(k)) {
                    continue;
                }
                spots.push({ tileX: tx, tileY: ty, region: theme });
            }
        }
        return spots;
    }

    private renderPlants(): void {
        const addPlant = (tileX: number, tileY: number, region: string, seed: number): void => {
            const glow = this.add.image(tileX * TS + TS / 2, tileY * TS + TS - 22, ensureTexture(this, "fx-glow-02"));
            glow.setDisplaySize(46, 46);
            glow.setDepth(tileY + 0.58);
            glow.setBlendMode(Phaser.BlendModes.ADD);
            const spr = this.add.image(
                tileX * TS + TS / 2,
                tileY * TS + TS,
                ensureTexture(this, stageTextureKey("bloomed", region)),
            );
            spr.setOrigin(0.5, 1);
            applyDisplaySize(spr);
            spr.setDepth(tileY + 0.6);
            this.plants.push({ sprite: spr, glow, tileX, tileY, seed, region });
        };

        for (const r of this.plan.regions) {
            const theme = regionThemeFromSection(r.section);
            for (const spot of r.plants) {
                addPlant(spot.tileX, spot.tileY, theme, (spot.tileX * 977 + spot.tileY * 389) >>> 0);
            }
        }
        for (const o of this.ornamentalSpots()) {
            addPlant(o.tileX, o.tileY, o.region, (o.tileX * 977 + o.tileY * 389) >>> 0);
        }
        // The plant the Keeper tends in the Sakura vignette must actually exist.
        if (!this.plants.some((p) => p.tileX === HERO_PLANT.tileX && p.tileY === HERO_PLANT.tileY)) {
            addPlant(HERO_PLANT.tileX, HERO_PLANT.tileY, "sakura", 777);
        }
    }

    private renderWeeds(): void {
        const weedKeys = ["weed-00-crabgrass", "weed-01-dandelion", "weed-02-bramble"];
        const rand = rng(0xdead);
        for (let i = 0; i < 90; i++) {
            const r = this.plan.regions[Math.floor(rand() * this.plan.regions.length)];
            const tx = r.rect.x + 2 + Math.floor(rand() * (r.rect.w - 4));
            const ty = r.rect.y + 2 + Math.floor(rand() * (r.rect.h - 4));
            const key = ensureTexture(this, weedKeys[Math.floor(rand() * weedKeys.length)]);
            const img = this.add.image(tx * TS + TS / 2, ty * TS + TS, key);
            img.setOrigin(0.5, 1);
            const src = this.textures.get(key).getSourceImage() as { width: number; height: number };
            img.setDisplaySize(30, 30 * (src.height / src.width));
            img.setDepth(ty + 0.47);
            this.weeds.push({ sprite: img, seed: (tx * 271 + ty * 811) >>> 0 });
        }
    }

    private renderActors(): void {
        this.keeperGlow = this.add.image(0, 0, ensureTexture(this, "fx-glow-04"));
        this.keeperGlow.setDisplaySize(52, 52);
        this.keeperGlow.setBlendMode(Phaser.BlendModes.ADD);
        this.keeper = this.add.image(0, 0, ensureTexture(this, "keeper-meditating"));
        this.keeper.setOrigin(0.5, 1);
        applyDisplaySize(this.keeper);

        this.student = this.add.image(0, 0, ensureTexture(this, "gardener-idle-up"));
        this.student.setOrigin(0.5, 1);
        applyDisplaySize(this.student);

        this.sprout = this.add.image(
            SPROUT_TILE.tileX * TS + TS / 2,
            SPROUT_TILE.tileY * TS + TS,
            ensureTexture(this, stageTextureKey("sprout", "sakura")),
        );
        this.sprout.setOrigin(0.5, 1);
        applyDisplaySize(this.sprout);
        this.sprout.setDepth(SPROUT_TILE.tileY + 0.6);
        this.sproutSpark = this.add.circle(this.sprout.x, this.sprout.y - 18, 5, 0x5cb848, 0.9);
        this.sproutSpark.setDepth(8500);
    }

    private renderWorldFx(): void {
        const hero = { x: HERO_PLANT.tileX * TS + TS / 2, y: HERO_PLANT.tileY * TS + 6 };
        for (let i = 0; i < 10; i++) {
            const spr = this.add.image(
                hero.x,
                hero.y,
                ensureTexture(this, `fx-droplet-${String(i % 9).padStart(2, "0")}`),
            );
            spr.setDepth(8400).setDisplaySize(10, 10).setAlpha(0);
            this.droplets.push({ sprite: spr, seed: i * 29 + 1 });
        }
        this.burstHalo = this.add.image(hero.x, hero.y - 26, ensureTexture(this, "fx-glow-06"));
        this.burstHalo.setDepth(8399).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
        for (let i = 0; i < 8; i++) {
            const petal = this.add.circle(hero.x, hero.y - 26, 3, 0xf9c5d5, 1);
            petal.setDepth(8401).setAlpha(0);
            this.burstPetals.push({ sprite: petal, angle: (i / 8) * Math.PI * 2 });
        }
    }

    // -- the one driver ----------------------------------------------------

    applyTime(t: number): void {
        const cam = cameraAt(t);
        this.cameras.main.setZoom(cam.zoom);
        this.cameras.main.centerOn(cam.x, cam.y);

        this.applyPlants(t);
        this.applyStructures(t);
        this.applyActors(t);
        this.applyFx(t);
    }

    private applyPlants(t: number): void {
        for (const p of this.plants) {
            let stage: GrowthStage;
            if (p.tileX === HERO_PLANT.tileX && p.tileY === HERO_PLANT.tileY) {
                stage = heroStageAt(t) as GrowthStage;
            } else if (t < BEATS.longSleep.from) {
                stage = "bloomed";
            } else {
                stage = plantStageAt(t, p.tileX, p.tileY, p.seed) as GrowthStage;
            }
            const key = ensureTexture(this, stageTextureKey(stage, p.region));
            if (p.sprite.texture.key !== key) {
                p.sprite.setTexture(key);
                applyDisplaySize(p.sprite);
            }
            p.glow.setAlpha(BLOOMED_TIER.has(stage) ? 0.16 : 0);
        }
        for (const d of this.dressing) {
            d.sprite.setAlpha(dressingAlphaAt(t, d.seed));
        }
        for (const wd of this.weeds) {
            wd.sprite.setAlpha(weedAlphaAt(t, wd.seed));
        }
    }

    private applyStructures(t: number): void {
        const decayed = t >= DECAY_FLIP_T;
        this.retexture(this.barn, decayed ? "struct-barn-empty" : "struct-barn-full");
        for (const ws of this.waystones) {
            this.retexture(ws, decayed ? "struct-waystone-dormant" : "struct-waystone-active");
        }
        for (const g of this.gates) {
            this.retexture(g, decayed ? "struct-gate-locked" : "struct-gate-open");
        }
        const southKey = t >= DECAY_FLIP_T && t < GATE_REOPEN_T ? "struct-gate-locked" : "struct-gate-open";
        if (this.southGate.texture.key !== southKey) {
            const src = this.textures.get(ensureTexture(this, southKey)).getSourceImage() as {
                width: number;
                height: number;
            };
            this.southGate.setTexture(southKey);
            this.southGate.setDisplaySize(96, 96 * (src.height / src.width));
        }
    }

    private applyActors(t: number): void {
        const k = keeperAt(t);
        if (k) {
            const bob = k.moving ? Math.sin(t * 7) * 2.5 : Math.sin(t * 2) * 1.5;
            this.keeper.setVisible(true).setAlpha(k.alpha).setPosition(k.x, k.y + bob);
            this.keeper.setDepth(Math.floor(k.y / TS) + 0.8);
            this.keeperGlow.setVisible(true).setAlpha(k.alpha * 0.35).setPosition(k.x, k.y - 26 + bob);
            this.keeperGlow.setDepth(this.keeper.depth - 0.01);
        } else {
            this.keeper.setVisible(false);
            this.keeperGlow.setVisible(false);
        }

        const s = studentAt(t);
        if (s) {
            const bob = s.moving ? Math.sin(t * 9) * 1.5 : 0;
            this.student.setVisible(true).setAlpha(s.alpha).setPosition(s.x, s.y + bob);
            this.student.setDepth(Math.floor(s.y / TS) + 0.8);
        } else {
            this.student.setVisible(false);
        }

        const sproutU = easeOut(span(t, SPROUT_T, SPROUT_T + 0.8));
        this.sprout.setVisible(t >= SPROUT_T);
        if (t >= SPROUT_T) {
            this.sprout.setDisplaySize(32 * (0.4 + 0.6 * sproutU), DISPLAY.plantHeight * (0.4 + 0.6 * sproutU));
        }
        const sparkU = span(t, SPROUT_T, SPROUT_T + 0.7);
        this.sproutSpark.setVisible(t >= SPROUT_T && sparkU < 1);
        this.sproutSpark.setAlpha(0.9 * (1 - sparkU));
        this.sproutSpark.setScale(1 + sparkU * 2.4);
    }

    private applyFx(t: number): void {
        const hero = { x: HERO_PLANT.tileX * TS + TS / 2, y: HERO_PLANT.tileY * TS + 6 };
        const watering = t >= HERO_WATER.from && t < HERO_WATER.to;
        for (const d of this.droplets) {
            if (!watering) {
                d.sprite.setAlpha(0);
                continue;
            }
            const r = rng(d.seed);
            const cycle = 0.55;
            const u = ((t - HERO_WATER.from) / cycle + r()) % 1;
            const dx = (r() - 0.5) * 26;
            d.sprite.setPosition(hero.x + dx * u, hero.y - 26 + u * 30 - Math.sin(u * Math.PI) * 10);
            d.sprite.setAlpha(0.95 * (1 - u));
        }

        const bu = span(t, HERO_BLOOM_T, HERO_BLOOM_T + 1.0);
        const active = t >= HERO_BLOOM_T && bu < 1;
        this.burstHalo.setAlpha(active ? 0.5 * (1 - bu) : 0);
        this.burstHalo.setDisplaySize(30 + bu * 70, 30 + bu * 70);
        for (const bp of this.burstPetals) {
            if (!active) {
                bp.sprite.setAlpha(0);
                continue;
            }
            bp.sprite.setPosition(
                hero.x + Math.cos(bp.angle) * bu * 26,
                hero.y - 26 + Math.sin(bp.angle) * bu * 26,
            );
            bp.sprite.setAlpha(1 - bu);
        }
    }
}
