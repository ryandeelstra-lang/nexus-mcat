// charged_up: panel-layer orchestrator for the Knowledge Garden (doc 23 §10 two-layer architecture).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { bus } from "../state/bus";
import { canWater, spendWater } from "../state/economy";
import type { MasterySnapshot } from "../state/mastery";
import { stageFor } from "../state/stage";
import type { GardenDoc, GardenStore } from "../state/store";
import { AlmanacPanel } from "./AlmanacPanel";
import { extractProjectionLine } from "./dashboard";
import { HarvestPanel } from "./HarvestPanel";
import { Hud } from "./Hud";
import { activeWeeds } from "./keeper-logic";
import { KeeperDialogue } from "./KeeperDialogue";
import { KeeperPanel, type KeeperSessionSummary } from "./KeeperPanel";
import { type DashboardData, fetchDashboard } from "./rpc";
import "../garden.css";

type Overlay = "none" | "keeper" | "almanac" | "harvest" | "map-help" | "plant-card";

/** Player-facing garden names + the MCAT section each trial tests. */
const SECTION_NAMES: Record<string, string> = {
    "P-S": "The Sakura Garden",
    "B-B": "The Keukenhof",
    "C-P": "The Versailles Parterre",
    CARS: "The Night Garden",
};
const SECTION_TESTS: Record<string, string> = {
    "P-S": "Psychological, Social & Biological Foundations",
    "B-B": "Biological & Biochemical Foundations",
    "C-P": "Chemical & Physical Foundations",
    CARS: "Critical Analysis & Reasoning Skills",
};
/** Celebration line when a whole preset color band blooms (flora:band-bloomed). */
const BAND_BLOOM_LINES: Record<string, string> = {
    "P-S": "A ribbon of blossoms opened along the stream 🌸",
    "B-B": "A tulip line burst into one color 🌷",
    "C-P": "A parterre ring stands in full bloom 🌹",
    CARS: "A drift of orchids glows in the mist ✨",
};

export interface GardenUIProps {
    store: GardenStore;
    snapshot: MasterySnapshot;
    refreshSnapshot: () => Promise<void>;
}

interface HarvestState {
    answered: number;
    blooms: number;
    wateredPlots: number;
}

interface WeedState {
    cause: string;
    ts: number;
}

function cloneDoc(doc: GardenDoc): GardenDoc {
    return {
        economy: { ...doc.economy },
        pending: doc.pending.map((entry) => ({ ...entry })),
        paraphrase: { ...doc.paraphrase },
        tutorial: { ...doc.tutorial },
        unlocks: {
            waystones: [...doc.unlocks.waystones],
            sectors: [...doc.unlocks.sectors],
        },
        settings: { ...doc.settings },
        flora: { ...doc.flora },
    };
}

export function GardenUI(props: GardenUIProps): React.ReactElement {
    const { store, snapshot, refreshSnapshot } = props;
    const [overlay, setOverlay] = useState<Overlay>("none");
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [doc, setDoc] = useState<GardenDoc>(cloneDoc(store.snapshot));
    const [dashboard, setDashboard] = useState<DashboardData | null>(null);
    const [harvest, setHarvest] = useState<HarvestState | null>(null);
    const [weeds, setWeeds] = useState<Record<string, WeedState>>({});
    const [toast, setToast] = useState<string>("");
    const [flavor, setFlavor] = useState<{ title: string; line: string } | null>(null);
    const [trialSection, setTrialSection] = useState<string | null>(null);
    const lastKeeperSummary = useRef<KeeperSessionSummary | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const growthLine = useMemo(() => extractProjectionLine(dashboard), [dashboard]);
    const selectedTopic = selectedNodeId ? snapshot.byNode.get(selectedNodeId) ?? null : null;
    const selectedStage = selectedTopic
        ? stageFor({
            topic: selectedTopic,
            paraphrasePassed: store.hasParaphrasePass(selectedTopic.nodeId),
            hasActiveWeed: Boolean(weeds[selectedTopic.nodeId]),
        })
        : null;

    const syncFromStore = useCallback(() => {
        setDoc(cloneDoc(store.snapshot));
    }, [store]);

    const refreshDashboard = useCallback(async (): Promise<void> => {
        const payload = await fetchDashboard();
        setDashboard(payload);
    }, []);

    const refreshWeeds = useCallback(async (): Promise<void> => {
        const payload = await activeWeeds();
        setWeeds(payload);
    }, []);

    const flashToast = useCallback((message: string): void => {
        setToast(message);
        if (toastTimer.current) {
            clearTimeout(toastTimer.current);
        }
        toastTimer.current = setTimeout(() => setToast(""), 2400);
    }, []);

    /** Water where the can points (Space anywhere). The world owns the cosmetic burst; here
     * we own the ledger: spend one pour, then answer with `flora:water` so the world grows
     * the preset ground flowers at the splash. If the pour also reached a plot, queue that
     * topic for the next Keeper visit (I1 — queueing only, never a due-date write). */
    const waterGround = useCallback(
        (nodeId: string | null, aimTileX: number, aimTileY: number): void => {
            if (!canWater(store.snapshot.economy)) {
                flashToast("Out of water — answer at the Keeper to refill 💧");
                bus.emit("water:denied", {});
                return;
            }
            store.setBalances(spendWater(store.snapshot.economy));
            bus.emit("flora:water", { aimTileX, aimTileY });
            if (nodeId) {
                const topic = snapshot.byNode.get(nodeId);
                if (topic) {
                    store.enqueue({
                        nodeId,
                        deckPath: topic.deckPath,
                        kind: "water",
                    });
                }
                bus.emit("plant:watered", { nodeId });
            }
            setDoc(cloneDoc(store.snapshot));
        },
        [store, snapshot, flashToast],
    );

    useEffect(() => {
        void store.load()
            .then(() => syncFromStore())
            .catch(() => syncFromStore());
        void refreshDashboard().catch(() => undefined);
        void refreshWeeds().catch(() => undefined);
    }, [refreshDashboard, refreshWeeds, store, syncFromStore]);

    useEffect(() => {
        const offPlant = bus.on("plant:interact", ({ nodeId }) => {
            setSelectedNodeId(nodeId);
            setOverlay("plant-card");
            void refreshWeeds().catch(() => undefined);
        });
        const offKeeper = bus.on("keeper:interact", () => {
            setOverlay("keeper");
        });
        const offGround = bus.on("ground:watered", ({ nodeId, aimTileX, aimTileY }) => {
            waterGround(nodeId, aimTileX, aimTileY);
        });
        const offBand = bus.on("flora:band-bloomed", ({ section }) => {
            flashToast(BAND_BLOOM_LINES[section] ?? "A whole stretch of flowers stands in bloom ✿");
        });
        const offFlavor = bus.on("world:flavor", ({ title, line }) => {
            setFlavor({ title, line });
        });
        const offTrial = bus.on("sector:trial", ({ section }) => {
            setTrialSection(section);
        });
        // Live HUD: every graded answer refills water (doc 23 §7) — the chips must tick
        // mid-session, not only at session end.
        const offGrowth = bus.on("growth:tick", () => {
            syncFromStore();
        });
        const offReviewClosed = bus.on("review:closed", ({ answered, blooms }) => {
            const wateredPlots = lastKeeperSummary.current?.wateredPlots ?? answered;
            setHarvest({ answered, blooms, wateredPlots });
            if (answered > 0) {
                setOverlay("harvest");
            } else {
                setOverlay("none");
            }
            lastKeeperSummary.current = null;
            void refreshDashboard().catch(() => undefined);
            void refreshSnapshot().catch(() => undefined);
            void refreshWeeds().catch(() => undefined);
            syncFromStore();
        });
        return () => {
            offPlant();
            offKeeper();
            offGround();
            offBand();
            offFlavor();
            offTrial();
            offGrowth();
            offReviewClosed();
        };
    }, [flashToast, refreshDashboard, refreshSnapshot, refreshWeeds, syncFromStore, waterGround]);

    /** Placeholder trial completion: unlocks the garden immediately. The real full MCAT
     * section tests replace this handler when they upload (2026-07-03 directive). */
    function completeTrialPlaceholder(section: string): void {
        store.unlockSector(section);
        setTrialSection(null);
        bus.emit("sector:unlocked", { section });
        flashToast(`${SECTION_NAMES[section] ?? section} unlocked — the mist lifts 🌄`);
        setDoc(cloneDoc(store.snapshot));
    }

    useEffect(() => {
        function onKeydown(e: KeyboardEvent): void {
            // A landmark flavor line dismisses on any of Esc / Space / Enter / E.
            if (flavor && (e.key === "Escape" || e.key === " " || e.key === "Enter" || e.key === "e")) {
                e.preventDefault();
                setFlavor(null);
                return;
            }
            if (trialSection && e.key === "Escape") {
                e.preventDefault();
                setTrialSection(null);
                return;
            }
            if (e.key !== "Escape") {
                return;
            }
            if (overlay === "none" || overlay === "keeper") {
                return;
            }
            setOverlay("none");
        }
        globalThis.addEventListener("keydown", onKeydown);
        return () => globalThis.removeEventListener("keydown", onKeydown);
    }, [overlay, flavor, trialSection]);

    function waterSelectedTopic(): void {
        if (!selectedTopic) {
            return;
        }
        try {
            store.setBalances(spendWater(store.snapshot.economy));
            store.enqueue({
                nodeId: selectedTopic.nodeId,
                deckPath: selectedTopic.deckPath,
                kind: "water",
            });
            bus.emit("plant:watered", { nodeId: selectedTopic.nodeId });
            syncFromStore();
        } catch {
            syncFromStore();
        }
    }

    const canWaterNow = canWater(doc.economy);

    return (
        <div className="garden-ui">
            {toast && (
                <div className="garden-toast" role="status" aria-live="polite">
                    {toast}
                </div>
            )}
            {trialSection && overlay === "none" && (
                <div className="garden-overlay keeper-overlay">
                    <div className="keeper-panel-shell">
                        <KeeperDialogue
                            speakerName="The Trial Stone"
                            body={`${SECTION_NAMES[trialSection] ?? trialSection} sleeps under the mist. `
                                + `Prove yourself on a full ${
                                    SECTION_TESTS[trialSection] ?? trialSection
                                } exam and it wakes for you.`}
                            srText="Sector trial"
                        >
                            <div className="keeper-actions">
                                <button
                                    className="keeper-reveal"
                                    onClick={() => completeTrialPlaceholder(trialSection)}
                                >
                                    Begin the trial (test coming soon — unlocks now)
                                </button>
                                <button
                                    className="hud-ghost-button"
                                    onClick={() => setTrialSection(null)}
                                >
                                    Not yet <kbd>Esc</kbd>
                                </button>
                            </div>
                        </KeeperDialogue>
                    </div>
                </div>
            )}
            {flavor && overlay === "none" && (
                <div className="garden-overlay keeper-overlay world-flavor-overlay">
                    <div className="keeper-panel-shell">
                        <KeeperDialogue
                            speakerName={flavor.title}
                            body={flavor.line}
                            srText={flavor.line}
                            onBodyClick={() => setFlavor(null)}
                        >
                            <div className="keeper-actions">
                                <button className="keeper-reveal" onClick={() => setFlavor(null)}>
                                    Continue <kbd>Space</kbd>
                                </button>
                            </div>
                        </KeeperDialogue>
                    </div>
                </div>
            )}
            <Hud
                balances={doc.economy}
                tutorial={doc.tutorial}
                growthLine={growthLine}
                onOpenAlmanac={() => setOverlay("almanac")}
                onOpenMapHelp={() => setOverlay("map-help")}
                onToggleMap={() => bus.emit("map:toggle", {})}
            />

            {overlay === "plant-card" && selectedTopic && (
                <div className="garden-overlay" role="dialog" aria-label="Plant card">
                    <div className="panel-card plant-card-popover">
                        <div className="panel-header">
                            <h2>{selectedTopic.label}</h2>
                            <button
                                className="keeper-close"
                                onClick={() =>
                                    setOverlay("none")}
                                aria-label="Close"
                            >
                                ✕
                            </button>
                        </div>
                        <p>Stage: {selectedStage ?? "bare-soil"}</p>
                        <p>Due now: {selectedTopic.dueCount}</p>
                        <div className="memory-bar-wrap" aria-label="Memory bar">
                            <span>Memory</span>
                            <div className="memory-bar-track">
                                <span
                                    className="memory-bar-fill"
                                    style={{
                                        width: `${
                                            Math.max(
                                                0,
                                                Math.min(100, selectedTopic.averageRecall * 100),
                                            )
                                        }%`,
                                    }}
                                />
                            </div>
                        </div>
                        <div className="plant-card-actions">
                            <button
                                className="hud-ghost-button"
                                onClick={waterSelectedTopic}
                                disabled={!canWaterNow}
                            >
                                Water 💧
                            </button>
                            {!canWaterNow && (
                                <p className="plant-card-reason">
                                    Out of water - answer questions at the Keeper to refill.
                                </p>
                            )}
                            <p className="plant-card-reason">
                                Tip: walk anywhere and press <kbd>Space</kbd> to water the ground.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {overlay === "keeper" && (
                <div className="garden-overlay keeper-overlay">
                    <KeeperPanel
                        store={store}
                        snapshot={snapshot}
                        refreshSnapshot={refreshSnapshot}
                        onWeedsChanged={() => void refreshWeeds()}
                        onClose={(summary) => {
                            lastKeeperSummary.current = summary;
                            syncFromStore();
                            if (summary.answered === 0) {
                                setOverlay("none");
                            }
                        }}
                    />
                </div>
            )}

            {overlay === "almanac" && (
                <AlmanacPanel
                    dashboard={dashboard}
                    onRefresh={refreshDashboard}
                    onClose={() => setOverlay("none")}
                />
            )}

            {overlay === "harvest" && harvest && (
                <HarvestPanel
                    wateredPlots={harvest.wateredPlots}
                    answers={harvest.answered}
                    blooms={harvest.blooms}
                    growthLine={growthLine}
                    onKeepTending={() => setOverlay("none")}
                    onDone={() => setOverlay("none")}
                />
            )}

            {overlay === "map-help" && (
                <div className="garden-overlay" role="dialog" aria-label="Map help">
                    <div className="panel-card map-help-panel">
                        <div className="panel-header">
                            <h2>Map Help</h2>
                            <button className="keeper-close" onClick={() => setOverlay("none")} aria-label="Close">
                                ✕
                            </button>
                        </div>
                        <p>Use Map to travel to unlocked waystones and the tend-next marker.</p>
                        <div className="panel-actions">
                            <button
                                className="hud-ghost-button"
                                onClick={() => {
                                    bus.emit("map:toggle", {});
                                    setOverlay("none");
                                }}
                            >
                                Open Map
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
