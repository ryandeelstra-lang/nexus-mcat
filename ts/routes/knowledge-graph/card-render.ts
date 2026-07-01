// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: turn a fully-rendered card (RenderCardResponse) into display HTML, and wrap it for a
// SANDBOXED iframe. The study surface lives in an api-access webview, so card markup — which is
// untrusted (hand-authored today, AI-generated tomorrow) — must never share that page's origin or
// reach the RPC surface. We hand it to an <iframe sandbox="allow-scripts"> (no allow-same-origin),
// so any script in a card runs in an opaque origin with no Bearer header → mediasrv 403s every POST.

import type { RenderedTemplateNode } from "@generated/anki/card_rendering_pb";

/**
 * Join a fully-rendered template (partial_render=false) into HTML. Each node is either literal
 * `text` or a `replacement` whose `currentText` is the already-rendered field — concatenating them
 * reproduces exactly what Anki's reviewer shows.
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
 * Build the `srcdoc` for the sandboxed card iframe: the note type's CSS + the rendered body wrapped
 * in the `.card` div Anki's renderer expects. The transparent background lets the dim graph show
 * through the panel's frosted glass.
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
    color: #1b1d2a;
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
