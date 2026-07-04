// charged_up: Keeper quiz hub orchestrating queued delivery, miss-cause weeds, and paraphrase blooms.
import React, { useEffect, useMemo, useRef, useState } from "react";

import { CardAnswer_Rating } from "@generated/anki/scheduler_pb";

import { bus } from "../state/bus";
import { onGradedAnswer } from "../state/economy";
import type { MasterySnapshot } from "../state/mastery";
import { stageFor } from "../state/stage";
import type { GardenStore } from "../state/store";
import { activeWeeds, planDelivery, recordWeed, type WeedCause } from "./keeper-logic";
import { ProveIt, type ProveItTopic } from "./ProveIt";
import { scopeToDeck } from "./rpc";
import { isFastAnswer } from "./StudyCard";
import { VoiceStudyCard } from "./VoiceStudyCard";

export interface KeeperSessionSummary {
    answered: number;
    blooms: number;
    wateredPlots: number;
}

interface KeeperPanelProps {
    store: GardenStore;
    snapshot: MasterySnapshot;
    refreshSnapshot: () => Promise<void>;
    onClose: (summary: KeeperSessionSummary) => void;
    onWeedsChanged?: () => void;
}

const MISS_CHIPS: Array<{ cause: WeedCause; label: string }> = [
    { cause: "careless", label: "careless" },
    { cause: "concept-gap", label: "concept gap" },
    { cause: "misread", label: "misread" },
    { cause: "trapped", label: "trapped" },
    { cause: "too-slow", label: "too slow" },
];

export function KeeperPanel(props: KeeperPanelProps): React.ReactElement {
    const { store, snapshot, refreshSnapshot, onClose, onWeedsChanged } = props;
    const [activeIndex, setActiveIndex] = useState(0);
    const [scopeKey, setScopeKey] = useState("keeper:initial");
    const [scopeAttempt, setScopeAttempt] = useState(0);
    const [scoping, setScoping] = useState(false);
    const [scopeError, setScopeError] = useState("");
    const [mode, setMode] = useState<"study" | "proveit">("study");
    const [missNodeId, setMissNodeId] = useState<string | null>(null);
    const [weedStatus, setWeedStatus] = useState("");
    const [proveQueue, setProveQueue] = useState<ProveItTopic[]>([]);
    const [proveIndex, setProveIndex] = useState(0);
    const [coaching, setCoaching] = useState("");

    const answered = useRef(0);
    const blooms = useRef(0);
    const tendedNodeIds = useRef(new Set<string>());
    const wateredNodeIds = useRef(new Set<string>());
    const closed = useRef(false);

    const delivery = useMemo(
        () => planDelivery(store.snapshot.pending, snapshot.topics),
        [store, snapshot],
    );
    const current = mode === "study" ? (delivery[activeIndex] ?? null) : null;
    const activeProve = mode === "proveit" ? (proveQueue[proveIndex] ?? null) : null;

    function closeSession(): void {
        if (closed.current) {
            return;
        }
        closed.current = true;
        const summary: KeeperSessionSummary = {
            answered: answered.current,
            blooms: blooms.current,
            wateredPlots: wateredNodeIds.current.size,
        };
        onClose(summary);
        bus.emit("review:closed", { answered: summary.answered, blooms: summary.blooms });
    }

    // Escape closes the session from EVERY panel state — the empty/scoping/prove-it
    // beats have no VoiceStudyCard mounted, so its own Escape handler can't cover them.
    // closeSession is idempotent (closed ref), so overlapping listeners are safe.
    useEffect(() => {
        function onKeydown(e: KeyboardEvent): void {
            if (e.key === "Escape") {
                closeSession();
            }
        }
        window.addEventListener("keydown", onKeydown);
        return () => window.removeEventListener("keydown", onKeydown);
        // closeSession is a stable-by-ref plain function on each render; the listener
        // re-binds only when the session identity changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function beginParaphraseBeat(): Promise<void> {
        await refreshSnapshot().catch(() => undefined);
        const weeds = await activeWeeds().catch(() => ({}));
        const queue: ProveItTopic[] = [];
        for (const nodeId of tendedNodeIds.current) {
            const topic = snapshot.byNode.get(nodeId);
            if (!topic || store.hasParaphrasePass(nodeId)) {
                continue;
            }
            const stage = stageFor({
                topic,
                paraphrasePassed: false,
                hasActiveWeed: Boolean(weeds[nodeId]),
            });
            if (stage === "budding") {
                queue.push({
                    nodeId: topic.nodeId,
                    deckPath: topic.deckPath,
                    label: topic.label,
                });
            }
        }
        if (queue.length === 0) {
            closeSession();
            return;
        }
        queue.sort((a, b) => a.label.localeCompare(b.label));
        setProveQueue(queue);
        setProveIndex(0);
        setMode("proveit");
    }

    useEffect(() => {
        if (mode !== "study" || !current) {
            return;
        }
        let cancelled = false;
        setScoping(true);
        setScopeError("");
        void scopeToDeck(current.deckPath)
            .then(() => {
                if (cancelled) {
                    return;
                }
                setScopeKey(`${current.deckPath}:${activeIndex}:${scopeAttempt}:${Date.now()}`);
                setScoping(false);
            })
            .catch((err) => {
                if (cancelled) {
                    return;
                }
                const message = err instanceof Error ? err.message : "Unknown deck-scoping failure";
                setScopeError(message);
                setScoping(false);
            });
        return () => {
            cancelled = true;
        };
    }, [activeIndex, current, mode, scopeAttempt]);

    async function submitWeed(cause: WeedCause): Promise<void> {
        if (!missNodeId) {
            return;
        }
        const nodeId = missNodeId;
        setMissNodeId(null);
        setWeedStatus("Keeper logged the weed.");
        await recordWeed(nodeId, cause).catch(() => {
            setWeedStatus("Could not log the weed right now.");
        });
        onWeedsChanged?.();
    }

    if (delivery.length === 0 && mode === "study") {
        return (
            <div className="keeper-panel-shell" role="dialog" aria-label="Keeper panel">
                <div className="keeper-panel keeper-panel-static">
                    <div className="keeper-panel-header">
                        <span className="keeper-context">The Keeper</span>
                        <button className="keeper-close" onClick={closeSession} aria-label="Close">
                            ✕
                        </button>
                    </div>
                    <div className="keeper-status">
                        Nothing is queued and no plot is due right now. Take a walk and tend again later.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="keeper-panel-shell" role="dialog" aria-label="Keeper panel">
            {mode === "study" && current && (
                <>
                    {scoping && <div className="keeper-status">Preparing {current.label}…</div>}
                    {scopeError && (
                        <div className="keeper-status" role="alert">
                            Could not scope to this deck: {scopeError}
                            <div className="keeper-actions">
                                <button
                                    className="hud-ghost-button"
                                    onClick={() => setScopeAttempt((n) => n + 1)}
                                >
                                    Retry
                                </button>
                                <button className="hud-ghost-button" onClick={closeSession}>
                                    Close
                                </button>
                            </div>
                        </div>
                    )}
                    {!scoping && !scopeError && (
                        <VoiceStudyCard
                            scopeKey={scopeKey}
                            contextLabel={`Tending: ${current.label} — ${current.why}`}
                            onClose={closeSession}
                            onGraded={(event) => {
                                store.setBalances(onGradedAnswer(store.snapshot.economy));
                                answered.current += 1;
                                tendedNodeIds.current.add(current.nodeId);
                                wateredNodeIds.current.add(current.nodeId);
                                bus.emit("growth:tick", {
                                    nodeId: current.nodeId,
                                    rating: event.rating,
                                    msTaken: event.msTaken,
                                    fast: isFastAnswer(event.msTaken),
                                });
                                if (event.rating === CardAnswer_Rating.AGAIN) {
                                    setMissNodeId(current.nodeId);
                                } else {
                                    setMissNodeId(null);
                                }
                            }}
                            onEmpty={() => {
                                store.dequeue([current.nodeId]);
                                setMissNodeId(null);
                                const next = activeIndex + 1;
                                if (next < delivery.length) {
                                    setActiveIndex(next);
                                } else {
                                    void beginParaphraseBeat();
                                }
                            }}
                        />
                    )}

                    {missNodeId && (
                        <div className="keeper-miss-strip" role="status" aria-live="polite">
                            <span>What happened?</span>
                            <div className="keeper-chip-row">
                                {MISS_CHIPS.map((chip) => (
                                    <button
                                        key={chip.cause}
                                        className="keeper-chip"
                                        onClick={() => void submitWeed(chip.cause)}
                                    >
                                        {chip.label}
                                    </button>
                                ))}
                                <button className="keeper-chip keeper-chip-skip" onClick={() => setMissNodeId(null)}>
                                    skip
                                </button>
                            </div>
                        </div>
                    )}
                    {weedStatus && <div className="keeper-status">{weedStatus}</div>}
                </>
            )}

            {mode === "proveit" && activeProve && (
                <>
                    <ProveIt
                        topic={activeProve}
                        onExit={closeSession}
                        onResolved={(result) => {
                            if (result.passed) {
                                store.recordParaphrasePass(result.nodeId);
                                blooms.current += 1;
                                bus.emit("plant:bloomed", { nodeId: result.nodeId });
                                setCoaching("");
                            } else if (result.skipped) {
                                // No reworded ask exists for this topic yet — advance
                                // silently (honest skip, never a fake fail).
                                setCoaching("");
                            } else {
                                setCoaching("Not yet — it stays a bud. The Keeper will bring it back.");
                            }
                            const next = proveIndex + 1;
                            if (next < proveQueue.length) {
                                setProveIndex(next);
                            } else {
                                closeSession();
                            }
                        }}
                    />
                    {coaching && <div className="keeper-status">{coaching}</div>}
                </>
            )}
        </div>
    );
}
