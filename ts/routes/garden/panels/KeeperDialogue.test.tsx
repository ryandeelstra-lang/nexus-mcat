// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: smoke-pins the Keeper dialogue chrome (mockup-art frame). Rendered to static
// markup (no jsdom dep) — asserts the line, the caret while crawling, the "…" typing dots
// while a reply is composing, the sr-only mirror, the medallion portrait, the arrow-coin
// continue, and the choices row.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KeeperDialogue } from "./KeeperDialogue";

describe("KeeperDialogue", () => {
    it("renders the speaker, the crawling body, and the caret", () => {
        const html = renderToStaticMarkup(
            <KeeperDialogue
                speakerName="The Keeper"
                body="What makes this acidic"
                srText="What makes this acidic?"
                showCaret
            />,
        );
        expect(html).toContain("The Keeper");
        expect(html).toContain("What makes this acidic");
        expect(html).toContain("voice-caret");
        // The full text is mirrored for assistive tech even mid-crawl.
        expect(html).toContain("aria-live=\"polite\"");
        expect(html).toContain("What makes this acidic?");
    });

    it("shows the typing dots (not the caret) while the Keeper is composing", () => {
        const html = renderToStaticMarkup(
            <KeeperDialogue body="Hmm… let me look at that." showCaret dots />,
        );
        expect(html).toContain("keeper-typing-dots");
        expect(html).not.toContain("voice-caret");
    });

    it("omits the caret when the crawl is done and renders the choices row", () => {
        const html = renderToStaticMarkup(
            <KeeperDialogue body="Done." showCaret={false}>
                <button type="button">Continue</button>
            </KeeperDialogue>,
        );
        expect(html).not.toContain("voice-caret");
        expect(html).toContain("keeper-dialogue-choices");
        expect(html).toContain("Continue");
    });

    it("applies a bucket tone class and renders the medallion + arrow coin", () => {
        const html = renderToStaticMarkup(
            <KeeperDialogue
                body="You got it!"
                tone="voice-beat-good"
                portraitSrc="portrait.png"
                onContinue={() => undefined}
            />,
        );
        expect(html).toContain("keeper-dialogue voice-beat-good");
        expect(html).toContain("keeper-medallion");
        expect(html).toContain("keeper-arrow-coin");
    });
});
