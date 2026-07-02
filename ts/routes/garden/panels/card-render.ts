// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: ported 1:1 from ts/routes/knowledge-graph/card-render.ts for the garden's
// Keeper panel (docs/26 G1.4, I6). Card markup is untrusted (hand-authored today,
// AI-generated tomorrow) and this is an api-access page, so the card renders ONLY inside
// an <iframe sandbox="allow-scripts"> (no allow-same-origin): any script in a card runs in
// an opaque origin with no Bearer header -> mediasrv 403s every POST it could attempt.

import type { RenderedTemplateNode } from "@generated/anki/card_rendering_pb";

/**
 * Join a fully-rendered template (partial_render=false) into HTML. Each node is either
 * literal `text` or a `replacement` whose `currentText` is the already-rendered field —
 * concatenating them reproduces exactly what Anki's reviewer shows.
 */
export function nodesToHtml(nodes: RenderedTemplateNode[]): string {
    let html = "";
    for (const node of nodes) {
        const value = node.value;
        if (value.case === "text") {
            html += value.value;
        } else if (value.case === "replacement") {
            html += value.value.currentText;
        }
    }
    return html;
}

/**
 * Build the `srcdoc` for the sandboxed card iframe: the note type's CSS + the rendered
 * body in the `.card` div Anki's renderer expects. Card-text legibility is a HARD RULE
 * (docs/26 I8): a readable font stack, never a pixel font — the pixel skin stops at the
 * panel frame.
 */
export function buildCardSrcdoc(css: string, bodyHtml: string): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
html, body { margin: 0; background: transparent; }
.card {
  font-family: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: #2b2416;
  font-size: 18px;
  line-height: 1.5;
  text-align: center;
  padding: 8px 4px;
  background: transparent;
}
${css}
</style>
</head>
<body><div class="card">${bodyHtml}</div></body>
</html>`;
}
