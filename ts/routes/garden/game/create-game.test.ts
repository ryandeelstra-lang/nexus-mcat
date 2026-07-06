// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the boot-flags contract. The registry's gardenFlags must be TRUTHFUL from
// the first frame: WorldScene.create() latches the onboarding-fog decision exactly once,
// and the only later lift is the placement:completed event — which can never fire for a
// player whose placement is already done (the Keeper opens the normal panel, not the
// test). Seeding the registry without placementDone therefore turns a lost boot race
// (scene create vs the two pushFlags RPCs) into a permanent fog softlock. These tests
// pin the seed to the loaded store document.
import { describe, expect, it } from "vitest";

import { emptyDoc } from "../state/store";
import { initialGardenFlags } from "./create-game";

describe("initialGardenFlags — the first-frame registry seed", () => {
    it("carries a completed placement so a returning player never re-boots the fog", () => {
        const doc = emptyDoc();
        doc.placement.done = true;
        expect(initialGardenFlags(doc).placementDone).toBe(true);
    });

    it("keeps a genuine first run fogged (placement not yet done)", () => {
        expect(initialGardenFlags(emptyDoc()).placementDone).toBe(false);
    });

    it("carries paraphrase passes so blooms render right on the first stage pass", () => {
        const doc = emptyDoc();
        doc.paraphrase = { "bio-1": 1751700000000 };
        expect(initialGardenFlags(doc).paraphrase).toEqual({ "bio-1": 1751700000000 });
    });

    it("starts weeds empty — they are RPC-sourced and land via pushFlags", () => {
        expect(initialGardenFlags(emptyDoc()).weeds).toEqual({});
    });
});
