// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// charged_up UI-evaluator harness — a dependency-free CDP screenshotter for
// Anki's QtWebEngine surfaces. The dev launcher (`run:9`) exports
// QTWEBENGINE_REMOTE_DEBUGGING=8080, so every web view (toolbar, deck browser,
// overview, reviewer, the SvelteKit garden route) is a live CDP "page" target
// we can drive (pycmd) and screenshot. Uses Node's built-in fetch + WebSocket
// (Node 22) — no new dependency, no Yarn age-gate.
//
// Usage:
//   node scripts/ui_shot.js all <outdir>                 # shoot every page target
//   node scripts/ui_shot.js <out.png> --url <substr>     # shoot the view whose URL matches
//   node scripts/ui_shot.js <out.png> --sel <cssSel>     # shoot the view containing a selector
//
// Env: CDP_PORT (default 8080), SHOT_WAIT_MS (settle after nav, default 2500).

import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || "8080";
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const NAV_WAIT = Number(process.env.SHOT_WAIT_MS || 2500);

async function targets() {
    const r = await fetch(ENDPOINT + "/json");
    const list = await r.json();
    // only live page targets with a URL (skip blank/detached ones that hang on connect)
    return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url);
}

function connect(wsUrl) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let id = 0;
        const pending = new Map();
        const to = setTimeout(() => {
            try {
                ws.close();
            } catch (_e) {
                /* ignore */
            }
            reject(new Error("connect timeout"));
        }, 5000);
        ws.onopen = () => {
            clearTimeout(to);
            resolve({
                send(method, params = {}) {
                    return new Promise((res, rej) => {
                        const mid = ++id;
                        const t = setTimeout(() => {
                            pending.delete(mid);
                            rej(new Error("send timeout " + method));
                        }, 8000);
                        pending.set(mid, {
                            res: (v) => (clearTimeout(t), res(v)),
                            rej: (e) => (clearTimeout(t), rej(e)),
                        });
                        ws.send(JSON.stringify({ id: mid, method, params }));
                    });
                },
                close: () => ws.close(),
            });
        };
        ws.onmessage = (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id && pending.has(m.id)) {
                const { res, rej } = pending.get(m.id);
                pending.delete(m.id);
                m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
            }
        };
        ws.onerror = () => {
            clearTimeout(to);
            reject(new Error("ws error"));
        };
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalOn(t, expression, returnByValue = false) {
    const c = await connect(t.webSocketDebuggerUrl);
    await c.send("Runtime.enable");
    const r = await c.send("Runtime.evaluate", { expression, returnByValue });
    c.close();
    return r;
}

async function shoot(t, outfile) {
    const c = await connect(t.webSocketDebuggerUrl);
    await c.send("Page.enable");
    const shot = await c.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(path.resolve(outfile)), { recursive: true });
    fs.writeFileSync(outfile, Buffer.from(shot.data, "base64"));
    c.close();
}

function slug(url) {
    return (
        (url.split("/_anki/pages/").pop() || url)
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "view"
    );
}

function arg(flag) {
    const i = process.argv.indexOf(flag);
    return i > -1 ? process.argv[i + 1] : undefined;
}

(async () => {
    const mode = process.argv[2];

    if (mode === "all") {
        const outdir = process.argv[3] || "/tmp/charged_up_shots";
        const ts = await targets();
        const seen = {};
        for (const t of ts) {
            let name = slug(t.url);
            seen[name] = (seen[name] || 0) + 1;
            if (seen[name] > 1) { name += "-" + seen[name]; }
            const out = path.join(outdir, name + ".png");
            try {
                await shoot(t, out);
                console.log("SHOT " + out + " <- " + t.url);
            } catch (e) {
                console.log("SKIP " + t.url + " (" + String(e) + ")");
            }
        }
        process.exit(0);
    }

    const outfile = mode;
    const urlSub = arg("--url");
    const selector = arg("--sel");
    const navCmd = arg("--nav");
    // Default nav target = the garden page (the app's only user-facing surface).
    const navOn = arg("--on") || "garden";
    if (!outfile) {
        console.error("usage: node scripts/ui_shot.js all <dir> | <out.png> --url|--sel <x>");
        process.exit(2);
    }

    if (navCmd) {
        const nav = (await targets()).find((t) => t.url.includes(navOn));
        if (!nav) { throw new Error("no page matching " + navOn); }
        await evalOn(nav, `globalThis.pycmd && globalThis.pycmd(${JSON.stringify(navCmd)})`);
        await sleep(NAV_WAIT);
    }

    let target = null;
    if (urlSub) {
        target = (await targets()).find((t) => t.url.includes(urlSub));
    } else if (selector) {
        for (const t of await targets()) {
            try {
                const r = await evalOn(
                    t,
                    `!!document.querySelector(${JSON.stringify(selector)})`,
                    true,
                );
                if (r.result && r.result.value === true) {
                    target = t;
                    break;
                }
            } catch (_e) {
                /* skip unresponsive target */
            }
        }
    }
    if (!target) {
        console.log("TARGET-NOT-FOUND " + (urlSub || selector));
        console.log("targets: " + (await targets()).map((t) => t.url).join(" | "));
        process.exit(3);
    }
    await shoot(target, outfile);
    console.log("SHOT " + outfile + " <- " + target.url);
    process.exit(0);
})().catch((e) => {
    console.error(String(e));
    process.exit(1);
});
