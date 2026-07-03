// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// charged_up dev harness: unlock all sectors (visuals only), teleport the avatar to each
// region's waystone, and screenshot each garden. Usage:
//   node scripts/sector_shots.mjs <outdir>
// Env: CDP_PORT (default 8080).
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || "8080";
const OUT = process.argv[2] || "/tmp/sector-shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const target = list.find((t) => t.type === "page" && t.url.includes("garden"));
if (!target) {
    console.error("no garden page target");
    process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const mid = ++id;
        const t = setTimeout(() => {
            pending.delete(mid);
            reject(new Error("timeout " + method));
        }, 15000);
        pending.set(mid, (v) => {
            clearTimeout(t);
            resolve(v);
        });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
}
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m.result ?? m.error);
        pending.delete(m.id);
    }
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");

async function evalJs(expression) {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true });
    return r?.result?.value;
}

async function shot(name) {
    const s = await send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.data, "base64"));
    console.log("SHOT", path.join(OUT, name));
}

// Unlock every sector (world visuals + registry only — nothing persisted).
await evalJs(`(() => {
  const bus = globalThis.__gardenBus;
  for (const s of ["P-S","B-B","C-P","CARS"]) bus.emit("sector:unlocked", { section: s });
  return "unlocked";
})()`);
await sleep(1400);

const sections = [
    ["P-S", "01-sakura"],
    ["B-B", "02-keukenhof"],
    ["C-P", "03-versailles"],
    ["CARS", "04-gardens"],
];
for (const [section, name] of sections) {
    await evalJs(
        `globalThis.__gardenBus.emit("map:travel", { waystoneId: ${JSON.stringify(section)} })`,
    );
    await sleep(1800); // camera lerp settle
    await shot(name + ".png");
}
process.exit(0);
