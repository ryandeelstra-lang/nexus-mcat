// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: a DEV-ONLY floating panel to skip the first-run flow (intro cinematic → Garden
// Tour → action tutorial → placement test) while iterating on the garden. It is NOT shipped:
// the shell mounts it only when devToolsEnabled() is true (the Vite dev server, or an explicit
// `?dev` opt-in that is sticky across reloads and cleared by `?dev=0`). A clean public build —
// no query param, no flag — never renders it, so the honest onboarding stands untouched.
//
// Every action persists through the SAME additive sidecar bridge the store uses (awaited, so
// the write lands before we reload) and the intro's localStorage seen-flag, then reloads the
// page so the whole app re-derives its state from that persisted truth — no stale React state.
// The skips only flip GATES; they never fabricate mastery (see dev-actions.ts).
import React, { useCallback, useEffect, useState } from "react";

import { httpTransport } from "../state/store";
import {
    resetOnboardingWrites,
    type SidecarWrite,
    skipAllWrites,
    skippedPlacement,
    skippedTour,
    skippedTutorial,
} from "./dev-actions";
import { introAvailable, introPending, markIntroSeen, resetIntroSeen } from "./IntroVideo";

const DEV_FLAG_KEY = "garden.devTools";

/** What the intro's localStorage seen-flag should become as part of an action. */
type IntroAction = "seen" | "reset" | "none";

/** Resolve ONCE at module load (URL/flag can't change without a reload anyway) so the render
 * path stays side-effect free. On in dev; opt-in elsewhere via a sticky `?dev` query param. */
function resolveDevToolsEnabled(): boolean {
    let enabled = false;
    try {
        if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
            enabled = true;
        }
    } catch {
        // import.meta.env absent (e.g. a non-Vite context) — fall through to the opt-in
    }
    try {
        const params = new URLSearchParams(globalThis.location?.search ?? "");
        if (params.has("dev")) {
            const raw = params.get("dev");
            if (raw === "0" || raw === "false" || raw === "off") {
                localStorage.removeItem(DEV_FLAG_KEY);
                return false;
            }
            localStorage.setItem(DEV_FLAG_KEY, "1"); // sticky so a plain reload keeps it
            return true;
        }
        if (localStorage.getItem(DEV_FLAG_KEY) === "1") {
            enabled = true;
        }
    } catch {
        // no URL / storage (SSR, a locked-down webview) — dev tools simply stay hidden
    }
    return enabled;
}

/** True when the dev skip panel should mount. Resolved once, at module import. */
export const DEV_TOOLS_ENABLED = resolveDevToolsEnabled();

interface OnboardingStatus {
    tourDone: boolean;
    tutorialDone: boolean;
    placementDone: boolean;
}

const Z = 2147483000; // above every garden overlay so the skips are always reachable

const wrapStyle: React.CSSProperties = {
    position: "fixed",
    bottom: 12,
    left: 12,
    zIndex: Z,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    lineHeight: 1.4,
};

const panelStyle: React.CSSProperties = {
    marginBottom: 6,
    padding: "10px 12px",
    width: 210,
    background: "rgba(18, 26, 20, 0.94)",
    color: "#e7f2e9",
    border: "1px solid #3f5a45",
    borderRadius: 8,
    boxShadow: "0 6px 22px rgba(0, 0, 0, 0.45)",
};

const toggleStyle: React.CSSProperties = {
    padding: "6px 10px",
    background: "rgba(18, 26, 20, 0.94)",
    color: "#e7f2e9",
    border: "1px solid #3f5a45",
    borderRadius: 8,
    cursor: "pointer",
    boxShadow: "0 6px 22px rgba(0, 0, 0, 0.45)",
};

const btnStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    margin: "4px 0",
    padding: "6px 8px",
    textAlign: "left",
    background: "#24382a",
    color: "#e7f2e9",
    border: "1px solid #3f5a45",
    borderRadius: 6,
    cursor: "pointer",
    font: "inherit",
};

const primaryBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: "#2f6b3e",
    borderColor: "#3f8a52",
    fontWeight: 700,
};

function dot(done: boolean): string {
    return done ? "✅" : "▫️";
}

/** Whether the cinematic will replay on next boot — needs a staged video to mean anything. */
function introLabel(): string {
    if (!introAvailable()) {
        return "no video";
    }
    return introPending() ? "will play" : "seen";
}

export function DevPanel(): React.ReactElement | null {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState<string>("");
    const [status, setStatus] = useState<OnboardingStatus | null>(null);

    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        void (async () => {
            try {
                const doc = await httpTransport.get();
                if (!cancelled) {
                    setStatus({
                        tourDone: Boolean(doc.tour?.done),
                        tutorialDone: Boolean(doc.tutorial?.done),
                        placementDone: Boolean(doc.placement?.done),
                    });
                }
            } catch {
                if (!cancelled) {
                    setStatus(null);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open]);

    /** Persist the writes (awaited), set the intro flag, then reload to re-derive from truth. */
    const apply = useCallback(
        async (label: string, writes: SidecarWrite[], intro: IntroAction): Promise<void> => {
            if (busy) {
                return;
            }
            setBusy(label);
            try {
                for (const w of writes) {
                    await httpTransport.set(w.key, w.doc);
                }
                if (intro === "seen") {
                    markIntroSeen();
                } else if (intro === "reset") {
                    resetIntroSeen();
                }
            } catch (err) {
                // A dev tool: surface the failure, don't crash the garden.
                console.error("[garden dev] skip write failed", err);
                setBusy("");
                return;
            }
            globalThis.location?.reload();
        },
        [busy],
    );

    if (!open) {
        return (
            <div style={wrapStyle}>
                <button
                    type="button"
                    style={toggleStyle}
                    onClick={() => setOpen(true)}
                    aria-label="Open dev skip tools"
                    title="Dev skip tools"
                >
                    🛠 dev
                </button>
            </div>
        );
    }

    return (
        <div style={wrapStyle}>
            <div style={panelStyle} role="region" aria-label="Dev skip tools">
                <div
                    style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}
                >
                    <strong>🛠 Dev — skip flow</strong>
                    <button
                        type="button"
                        onClick={() => setOpen(false)}
                        aria-label="Close dev tools"
                        style={{ ...btnStyle, width: "auto", margin: 0, padding: "2px 7px" }}
                    >
                        ✕
                    </button>
                </div>

                <button
                    type="button"
                    style={primaryBtnStyle}
                    disabled={Boolean(busy)}
                    onClick={() => void apply("all", skipAllWrites(Date.now()), "seen")}
                >
                    ⏭ Skip everything
                </button>
                <button
                    type="button"
                    style={primaryBtnStyle}
                    disabled={Boolean(busy)}
                    onClick={() => void apply("reset", resetOnboardingWrites(), "reset")}
                >
                    ↺ Reset onboarding (replay)
                </button>

                <hr style={{ border: 0, borderTop: "1px solid #3f5a45", margin: "8px 0" }} />

                <button
                    type="button"
                    style={btnStyle}
                    disabled={Boolean(busy)}
                    onClick={() => void apply("intro", [], "seen")}
                >
                    Skip intro <span style={{ opacity: 0.6 }}>· {introLabel()}</span>
                </button>
                <button
                    type="button"
                    style={btnStyle}
                    disabled={Boolean(busy)}
                    onClick={() => void apply("tour", [{ key: "tour", doc: skippedTour() }], "none")}
                >
                    Skip tour {status ? dot(status.tourDone) : ""}
                </button>
                <button
                    type="button"
                    style={btnStyle}
                    disabled={Boolean(busy)}
                    onClick={() => void apply("tutorial", [{ key: "tutorial", doc: skippedTutorial() }], "none")}
                >
                    Skip tutorial {status ? dot(status.tutorialDone) : ""}
                </button>
                <button
                    type="button"
                    style={btnStyle}
                    disabled={Boolean(busy)}
                    onClick={() =>
                        void apply(
                            "placement",
                            [{ key: "placement", doc: skippedPlacement(Date.now()) }],
                            "none",
                        )}
                >
                    Skip placement {status ? dot(status.placementDone) : ""}
                </button>

                <p style={{ margin: "8px 0 0", opacity: 0.55, fontSize: 11 }}>
                    {busy ? "applying…" : "reloads to re-derive · off in public build"}
                </p>
            </div>
        </div>
    );
}
