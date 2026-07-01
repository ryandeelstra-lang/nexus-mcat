// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// charged_up UI-evaluator helper — drives a live review session over CDP so the
// reviewer surfaces (front card, answer, and the calm grade rail) can be
// screenshotted. The reviewer isn't a SvelteKit route (it's legacy web views),
// so we navigate the running app: home -> deck browser -> open <deck> -> study
// -> show answer, screenshotting the bottom bar (the ease pills) + the card.
//
// Usage: node scripts/drive_review.mjs <deckNameSubstr> <outdir>
// Env: CDP_PORT (default 8080)

import fs from "node:fs";
import path from "node:path";

const PORT = process.env.CDP_PORT || "8080";
const ENDPOINT = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
    const r = await fetch(ENDPOINT + "/json");
    return (await r.json()).filter((t) => t.type === "page" && t.webSocketDebuggerUrl && t.url);
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
        }, 6000);
        ws.onopen = () => {
            clearTimeout(to);
            resolve({
                send(method, params = {}) {
                    return new Promise((res, rej) => {
                        const mid = ++id;
                        const t = setTimeout(() => {
                            pending.delete(mid);
                            rej(new Error("send timeout " + method));
                        }, 10000);
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

async function evalOn(t, expression, returnByValue = true) {
    const c = await connect(t.webSocketDebuggerUrl);
    await c.send("Runtime.enable");
    const r = await c.send("Runtime.evaluate", { expression, returnByValue });
    c.close();
    return r.result && r.result.value;
}

async function pageWith(selector, tries = 8) {
    for (let i = 0; i < tries; i++) {
        for (const t of await targets()) {
            try {
                if (await evalOn(t, `!!document.querySelector(${JSON.stringify(selector)})`)) {
                    return t;
                }
            } catch (_e) {
                /* skip */
            }
        }
        await sleep(700);
    }
    return null;
}

async function pageWithUrl(sub) {
    return (await targets()).find((t) => t.url.includes(sub)) || null;
}

async function pycmdOn(t, cmd) {
    await evalOn(t, `globalThis.pycmd && globalThis.pycmd(${JSON.stringify(cmd)})`, false);
}

async function shoot(t, outfile) {
    const c = await connect(t.webSocketDebuggerUrl);
    await c.send("Page.enable");
    const shot = await c.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(path.resolve(outfile)), { recursive: true });
    fs.writeFileSync(outfile, Buffer.from(shot.data, "base64"));
    c.close();
    console.log("SHOT " + outfile + " <- " + t.url);
}

(async () => {
    const deckSub = process.argv[2] || "MCAT";
    const outdir = process.argv[3] || "/tmp/cu_review";

    // 1. home -> deck browser
    const home = await pageWithUrl("/home");
    if (home) {
        await pycmdOn(home, "home:study");
        await sleep(2500);
    }

    // 2. deck browser -> open the deck by clicking its link (fires the bound handler)
    const db = await pageWith("a.deck, tr.deck");
    if (!db) {
        throw new Error("deck browser not found");
    }
    const opened = await evalOn(
        db,
        `(() => { const links=[...document.querySelectorAll("a.deck")]; let el=links.find(e=>(e.textContent||"").trim().toUpperCase()===${
            JSON.stringify(deckSub.toUpperCase())
        }); if(!el) el=links.find(e=>(e.textContent||"").toUpperCase().includes(${
            JSON.stringify(deckSub.toUpperCase())
        })); if(!el) return false; el.click(); return (el.textContent||"").trim()||"deck"; })()`,
    );
    if (!opened) {
        throw new Error("deck link not found for " + deckSub);
    }
    console.log("opened deck: " + opened);
    await sleep(2200);

    // 3. overview -> study (click the Study button)
    const ov = await pageWith("#study, .overview");
    if (ov) {
        await evalOn(
            ov,
            `(() => { const b=document.querySelector("#study, .action-row button, button"); if(b){b.click(); return true;} return false; })()`,
        );
        await sleep(2500);
    }

    // 4. reviewer FRONT — screenshot the bottom bar (Show Answer) + the card
    const bottomFront = await pageWith("#ansbut, #outer");
    if (bottomFront) {
        await shoot(bottomFront, path.join(outdir, "reviewer_front_bar.png"));
    }
    const card = await pageWith(".card, #qa, #typeans, [id='content']");
    if (card) {
        await shoot(card, path.join(outdir, "reviewer_card.png"));
    }

    // 5. show answer -> screenshot the calm grade rail
    const ansPage = bottomFront || (await pageWith("#ansbut"));
    if (ansPage) {
        await evalOn(
            ansPage,
            `(() => { const b=document.querySelector("#ansbut"); if(b){b.click(); return true;} if(globalThis.pycmd){pycmd("ans"); return "pycmd";} return false; })()`,
        );
        await sleep(1800);
    }
    const rail = await pageWith("[data-ease]");
    if (rail) {
        await shoot(rail, path.join(outdir, "reviewer_grade_rail.png"));
    } else {
        console.log("grade rail ([data-ease]) not found");
        console.log("targets: " + (await targets()).map((t) => t.url).join(" | "));
    }
    process.exit(0);
})().catch((e) => {
    console.error(String(e));
    process.exit(1);
});
