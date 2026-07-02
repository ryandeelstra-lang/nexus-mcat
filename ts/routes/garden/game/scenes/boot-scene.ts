// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: BootScene — preload sliced art (if present) + generate fallback textures, then
// hand off to the walkable world (doc 23 §12.3).
import Phaser from "phaser";

import { ensureAllStageTextures, preloadDiscoveredAssets } from "../assets";

export class BootScene extends Phaser.Scene {
    constructor() {
        super("boot");
    }

    preload(): void {
        // Async preload handled in create — Phaser preload is sync-friendly only for load.* calls
    }

    async create(): Promise<void> {
        await preloadDiscoveredAssets(this);
        ensureAllStageTextures(this);
        this.scene.start("world");
    }
}
