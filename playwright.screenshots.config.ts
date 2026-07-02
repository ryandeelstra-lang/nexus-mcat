// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up VISUAL ITERATION config (separate from the heavy full-Anki playwright.config.ts).
// Boots only the Vite dev server (`yarn dev`, no Rust/Qt) and runs the screenshot harness, which mocks
// the engine's /_anki calls at the network layer. Not part of `just check` or `just test-e2e`.
//   yarn playwright test -c playwright.screenshots.config.ts

import { defineConfig } from "@playwright/test";

const PORT = 5173;

export default defineConfig({
    testDir: "./ts/tests/e2e",
    testMatch: /render\.screenshots\.ts$/,
    outputDir: "./out/e2e-screenshots-report",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: "list",
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        screenshot: "off",
        trace: "off",
        // Render with the system Google Chrome (recent engine, full SVG-filter/backdrop-filter support);
        // avoids Playwright's version-pinned Chromium download.
        channel: "chrome",
    },
    webServer: {
        // Drive vite directly from ts/ (no yarn/corepack dependency); node_modules is already installed.
        command: "../node_modules/.bin/vite dev --port 5173 --strictPort",
        cwd: "ts",
        url: `http://127.0.0.1:${PORT}/knowledge-graph`,
        timeout: 180_000,
        reuseExistingServer: true,
        stdout: "pipe",
        stderr: "pipe",
    },
});
