// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: DEV-ONLY visual preview for the Keeper dialogue chrome (mockup-art frame).
// Renders the conversation's four beats (ask mid-crawl, listening, composing with dots,
// verdict landed) into a static HTML page over a real backdrop so a human can eyeball the
// frame, medallion, arrow coin, mic coin, and cadence chrome without launching the engine.
// Writes /tmp/keeper-dialogue-preview.html when CHARGED_UP_DIALOGUE_PREVIEW=1; otherwise a
// no-op that still passes (same pattern as game/sectors/preview.test.ts).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { KeeperDialogue } from "./KeeperDialogue";

const GARDEN_DIR = path.resolve(__dirname, "..");

function fileUrl(...rel: string[]): string {
    return `file://${path.join(GARDEN_DIR, ...rel)}`;
}

function beat(title: string, inner: React.ReactElement, extra?: React.ReactElement): string {
    return `
      <section>
        <h2 style="color:#f6ead8;font:14px sans-serif;opacity:.8">${title}</h2>
        <div class="garden-overlay keeper-overlay" style="position:relative;inset:auto;min-height:340px;align-items:flex-end">
          <div class="keeper-panel-shell">
            <div class="keeper-panel keeper-panel-dialogue">
              <div class="keeper-panel-header">
                <span class="keeper-context">Tending: Amino acids — assigned</span>
                <span class="keeper-counts"><span class="count-new">3</span><span class="count-learning">1</span><span class="count-review">8</span></span>
                <button class="keeper-close">✕</button>
              </div>
              ${renderToStaticMarkup(inner)}
              ${extra ? renderToStaticMarkup(extra) : ""}
            </div>
          </div>
        </div>
      </section>`;
}

describe("keeper dialogue preview", () => {
    it("writes the four-beat preview page when CHARGED_UP_DIALOGUE_PREVIEW=1", () => {
        if (process.env.CHARGED_UP_DIALOGUE_PREVIEW !== "1") {
            expect(true).toBe(true);
            return;
        }
        const portrait = fileUrl("assets", "characters", "keeper-portrait.png");
        const mic = fileUrl("assets", "ui", "ui-btn-mic.png");
        const backdrop = fileUrl("assets", "backdrops", "bg-sakura-establishing.png");

        const answerStage = (listening: boolean) => (
            <div className="voice-answer-stage">
                <span className="voice-mic-stack">
                    <button
                        className={`voice-mic-coin${listening ? " voice-mic-coin-live" : ""}`}
                        style={{ backgroundImage: `url("${mic}")` }}
                    >
                        {listening && <span className="voice-mic-stop">◼</span>}
                    </button>
                    <span className="voice-mic-label">
                        {listening
                            ? (
                                <>
                                    done — <kbd>Space</kbd>
                                </>
                            )
                            : (
                                <>
                                    speak — <kbd>Space</kbd>
                                </>
                            )}
                    </span>
                </span>
                {listening
                    ? (
                        <div className="voice-player-line">
                            <span className="voice-player-name">You</span>
                            <p className="voice-live-text">
                                the alpha carbon, the central one bonded to<span className="voice-caret" />
                            </p>
                            <span className="voice-live-tag">live captions — best guess</span>
                        </div>
                    )
                    : <button className="voice-type-toggle">…or type it</button>}
            </div>
        );

        const beats = [
            beat(
                "1 — the ask, mid-crawl (word by word)",
                <KeeperDialogue
                    portraitSrc={portrait}
                    body="Tell me — In a standard amino acid, which carbon is"
                    srText="full ask"
                    showCaret
                >
                    {answerStage(false)}
                </KeeperDialogue>,
                <button className="voice-idk-bar">I don't know — show me</button>,
            ),
            beat(
                "2 — listening (your words fill in as you speak)",
                <KeeperDialogue
                    portraitSrc={portrait}
                    body="Tell me — In a standard amino acid, which carbon is bonded to the amino group, the carboxyl group, a hydrogen, and the side chain?"
                    srText="full ask"
                >
                    {answerStage(true)}
                </KeeperDialogue>,
            ),
            beat(
                "3 — the instant reply: opener crawls, dots hold the beat while grading",
                <KeeperDialogue
                    portraitSrc={portrait}
                    body="Hmm… let me look at"
                    srText="composing"
                    dots
                />,
            ),
            beat(
                "4 — the verdict lands (tone veil + tray + arrow coin)",
                <KeeperDialogue
                    portraitSrc={portrait}
                    tone="voice-beat-good"
                    body="Hmm… let me look at that. The answer: the alpha-carbon, the central carbon that bears all four of these groups. You got it!"
                    srText="reply"
                    onContinue={() => undefined}
                >
                    <div className="voice-result-details">
                        <p className="voice-flavor">
                            <span className="voice-beat-icon">✿</span> The plant drinks deep!
                        </p>
                        <p className="voice-transcript">You said: “the alpha carbon”</p>
                        <p className="voice-points-hit">✓ alpha-carbon · central</p>
                        <p className="voice-score">match 93%</p>
                        <button className="voice-appeal">That's not what I said</button>
                    </div>
                </KeeperDialogue>,
            ),
        ].join("\n");

        let css = readFileSync(path.join(GARDEN_DIR, "garden.css"), "utf-8");
        css = css.replace(
            /url\("\.\/assets\//g,
            `url("${fileUrl("assets")}/`,
        );

        let html = `<!doctype html><meta charset="utf-8">
<style>${css}</style>
<body style="margin:0;background:#1c2a1e url('${backdrop}') center/cover;padding:32px 0">
${beats}
</body>`;
        // Vitest resolves the asset glob to dev-server paths; point them at the real files.
        html = html
            .replace(/file:\/\/\/routes\/garden\/assets\//g, `${fileUrl("assets")}/`)
            .replace(/(["('])\/routes\/garden\/assets\//g, `$1${fileUrl("assets")}/`)
            .replace(/\/@fs\//g, "file:///");
        writeFileSync("/tmp/keeper-dialogue-preview.html", html);
        expect(html).toContain("keeper-dialogue");
    });
});
