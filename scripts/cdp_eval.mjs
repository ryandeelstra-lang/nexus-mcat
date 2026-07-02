// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// charged_up: tiny CDP console-tap + evaluator for debugging live webviews.
// Usage: node scripts/cdp_eval.mjs <urlSubstr> [jsExpression]
// Prints recent console messages/exceptions for the matching page target, then
// optionally evaluates an expression and prints the result. Dev tool only.
const PORT = process.env.CDP_PORT || "8080";
const [, , urlSub, expr] = process.argv;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const target = list.find((t) => t.type === "page" && t.url.includes(urlSub));
if (!target) {
    console.error("no target matching", urlSub);
    process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
function send(method, params = {}) {
    return new Promise((resolve) => {
        const mid = ++id;
        pending.set(mid, resolve);
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
}

ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg.result ?? msg.error);
        pending.delete(msg.id);
    } else if (msg.method === "Runtime.consoleAPICalled") {
        const args = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
        console.log(`[console.${msg.params.type}]`, args.slice(0, 500));
    } else if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        console.log(
            "[exception]",
            d.text,
            d.exception?.description?.slice(0, 800) ?? "",
        );
    }
};

await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Log.enable");
// Nudge the page to replay buffered console messages where supported.
await new Promise((r) => setTimeout(r, 1200));
if (expr) {
    const res = await send("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
    });
    console.log("[eval]", JSON.stringify(res, null, 2).slice(0, 2000));
}
await new Promise((r) => setTimeout(r, 1500));
process.exit(0);
