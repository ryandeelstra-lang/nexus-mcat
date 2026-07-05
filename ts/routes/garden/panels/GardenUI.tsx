// charged_up: panel-layer orchestrator for the Knowledge Garden (doc 23 §10 two-layer architecture).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { bus } from "../state/bus";
import { fetchDepthStats } from "../state/depth-stats";
import { canWater, spendWater } from "../state/economy";
import { pickGardenerInsight } from "../state/gardener-insight";
import type { MasterySnapshot } from "../state/mastery";
import { stageFor } from "../state/stage";
import type { GardenDoc, GardenStore } from "../state/store";
import { AlmanacPanel } from "./AlmanacPanel";
import { extractProjectionLine } from "./dashboard";
import { GardenTour } from "./GardenTour";
import { HarvestPanel } from "./HarvestPanel";
import { Hud } from "./Hud";
import { activeWeeds } from "./keeper-logic";
import { KeeperDialogue, panelFrameStyle } from "./KeeperDialogue";
import { KeeperPanel, type KeeperSessionSummary } from "./KeeperPanel";
import { PlacementTest } from "./PlacementTest";
import { type DashboardData, fetchDashboard } from "./rpc";
import { StoneExam } from "./StoneExam";
import "../garden.css";

type Overlay =
    | "none"
    | "tour"
    | "keeper"
    | "placement"
    | "almanac"
    | "harvest"
    | "map-help"
    | "plant-card"
    | "trial-quiz";

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
    /** Mute/unmute the lofi score (the audio graph lives in the app shell). */
    onMusicMutedChange: (muted: boolean) => void;
    /** True while the first-run cinematic still covers the screen — the Garden Tour
     * (the Keeper's concept walkthrough) waits its turn behind it. */
    introActive: boolean;
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
        tour: { ...doc.tour },
        placement: {
            ...doc.placement,
            tally: { ...doc.placement.tally },
            intake: { ...doc.placement.intake },
        },
        unlocks: {
            waystones: [...doc.unlocks.waystones],
            sectors: [...doc.unlocks.sectors],
        },
        settings: { ...doc.settings },
        flora: { ...doc.flora },
        gardener: { ...doc.gardener },
    };
}

/** Local-calendar YYYY-MM-DD — the garden gnome's "one insight per day" boundary. */
function todayIso(): string {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
}

export function GardenUI(props: GardenUIProps): React.ReactElement {
    const { store, snapshot, refreshSnapshot, onMusicMutedChange, introActive } = props;
    const [overlay, setOverlay] = useState<Overlay>("none");
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    /** Which sector stone's trial is open (the world's section id, e.g. "B-B"). */
    const [trialSection, setTrialSection] = useState<string | null>(null);
    const [doc, setDoc] = useState<GardenDoc>(cloneDoc(store.snapshot));
    const [dashboard, setDashboard] = useState<DashboardData | null>(null);
    const [harvest, setHarvest] = useState<HarvestState | null>(null);
    const [weeds, setWeeds] = useState<Record<string, WeedState>>({});
    const [toast, setToast] = useState<string>("");
    const [flavor, setFlavor] = useState<{ title: string; line: string } | null>(null);
    const [mapOpen, setMapOpen] = useState(false);
    /** True while the avatar stands on the Overlook (island:state from the world). */
    const [onIsland, setOnIsland] = useState(false);
    const lastKeeperSummary = useRef<KeeperSessionSummary | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    /** Where the Garden Tour opens: the persisted cursor on first run, 0 on a replay. */
    const tourStart = useRef(0);
    /** The tour auto-opens at most once per mount (Esc = pause; it resumes next visit). */
    const tourAutoOpened = useRef(false);

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

    /** The garden gnome's one-a-day encouragement (feature 2026-07-05). Once per calendar day
     *  we pick ONE positive, honest insight from the mastery snapshot + the doc, persist it as
     *  the daily gate, and hand it to the world; the rest of the day we reuse the persisted
     *  line so the gnome's advice is stable. Positive-only by design. */
    const publishGardenerInsight = useCallback((): void => {
        const today = todayIso();
        const current = store.snapshot;
        let text = current.gardener.text;
        if (current.gardener.dateIso !== today || text.length === 0) {
            text = pickGardenerInsight({
                snapshot,
                doc: current,
                dateIso: today,
                lastText: current.gardener.text || undefined,
            }).text;
            store.setGardener(today, text);
        }
        bus.emit("gardener:insight", { text });
    }, [store, snapshot]);

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

    /** Toggle the lofi score: flip the engine + persist the choice in the additive store. */
    const toggleMusic = useCallback((): void => {
        const next = !store.snapshot.settings.muted;
        onMusicMutedChange(next);
        store.setSettings({ ...store.snapshot.settings, muted: next });
        setDoc(cloneDoc(store.snapshot));
        flashToast(next ? "Music off 🔇" : "Music on 🎵");
    }, [store, onMusicMutedChange, flashToast]);

    /** Super Depth Analysis: assemble every stat the garden honestly knows, then the
     * world teleports you to the Overlook (island:enter). From the island the same
     * button is the way home. Gated like the map: never while the placement mist holds. */
    const openDepthAnalysis = useCallback(async (): Promise<void> => {
        if (onIsland) {
            bus.emit("island:exit", {});
            return;
        }
        if (!store.snapshot.placement.done) {
            flashToast("The mist still hides the island — the master awaits at the gazebo.");
            return;
        }
        if (mapOpen) {
            flashToast("Close the map first (M).");
            return;
        }
        const stats = await fetchDepthStats({
            snapshot,
            doc: store.snapshot,
            weeds,
        });
        bus.emit("island:enter", { stats });
    }, [onIsland, mapOpen, snapshot, store, weeds, flashToast]);

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
            .then(() => {
                syncFromStore();
                publishGardenerInsight();
            })
            .catch(() => syncFromStore());
        void refreshDashboard().catch(() => undefined);
        void refreshWeeds().catch(() => undefined);
    }, [publishGardenerInsight, refreshDashboard, refreshWeeds, store, syncFromStore]);

    useEffect(() => {
        const offPlant = bus.on("plant:interact", ({ nodeId }) => {
            setSelectedNodeId(nodeId);
            setOverlay("plant-card");
            void refreshWeeds().catch(() => undefined);
        });
        const offKeeper = bus.on("keeper:interact", () => {
            // Until the master's placement test is done, HE IS the placement test —
            // the island fog only lifts when it completes (2026-07-03 directive).
            setOverlay(store.snapshot.placement.done ? "keeper" : "placement");
        });
        const offTrial = bus.on("trial:interact", ({ section }) => {
            // A sector stone opens that section's short MCQ trial (StoneExam).
            setTrialSection(section);
            setOverlay("trial-quiz");
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
        // Live HUD: every graded answer refills water (doc 23 §7) — the chips must tick
        // mid-session, not only at session end.
        const offGrowth = bus.on("growth:tick", () => {
            syncFromStore();
        });
        const offMapVisible = bus.on("map:visible", ({ open }) => {
            setMapOpen(open);
        });
        const offIsland = bus.on("island:state", ({ on }) => {
            setOnIsland(on);
            flashToast(on ? "The Overlook — every number your garden knows ✦" : "Back to the garden 🌱");
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
            offTrial();
            offGround();
            offBand();
            offFlavor();
            offGrowth();
            offMapVisible();
            offIsland();
            offReviewClosed();
        };
    }, [flashToast, refreshDashboard, refreshSnapshot, refreshWeeds, store, syncFromStore, waterGround]);

    // The Garden Tour (state/tour.ts) plays once per gardener, right after the intro
    // cinematic and before the action tutorial: every concept, its science named. At most
    // one auto-open per mount — Esc pauses it (the cursor persists on every advance) and
    // it resumes on the next visit; Skip/finish persist done forever.
    useEffect(() => {
        if (introActive || tourAutoOpened.current || doc.tour.done || overlay !== "none") {
            return;
        }
        tourAutoOpened.current = true;
        tourStart.current = doc.tour.step;
        setOverlay("tour");
    }, [introActive, doc.tour.done, doc.tour.step, overlay]);

    // ONE derived world-cover signal (see bus.ts "ui:overlay") — drives the world's
    // panelOpen flag AND Phaser keyboard capture, so typed answers keep their keys.
    // The map is NOT included: it is a Phaser scene that needs the keyboard (Esc/M);
    // the world gates its own verbs on "map:visible" instead.
    useEffect(() => {
        bus.emit("ui:overlay", { open: overlay !== "none" || flavor !== null });
    }, [overlay, flavor]);

    useEffect(() => {
        function onKeydown(e: KeyboardEvent): void {
            // A landmark flavor line dismisses on any of Esc / Space / Enter / E.
            if (flavor && (e.key === "Escape" || e.key === " " || e.key === "Enter" || e.key.toLowerCase() === "e")) {
                e.preventDefault();
                setFlavor(null);
                return;
            }
            if (e.key !== "Escape") {
                return;
            }
            // The placement ceremony pauses inside itself (StudyCard Esc -> briefing);
            // Escape must never abandon it, or the fog gate would soft-skip.
            if (overlay === "none" || overlay === "keeper" || overlay === "placement") {
                return;
            }
            // Holding Esc to skip the intro auto-repeats into the tour that opens the
            // instant the cinematic ends — a repeat must not dismiss what a press meant
            // to reveal. A fresh Esc press still pauses the tour.
            if (overlay === "tour" && e.repeat) {
                return;
            }
            setOverlay("none");
        }
        globalThis.addEventListener("keydown", onKeydown);
        return () => globalThis.removeEventListener("keydown", onKeydown);
    }, [overlay, flavor]);

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
                musicMuted={doc.settings.muted}
                hideHint={overlay !== "none" || mapOpen || Boolean(flavor) || onIsland}
                onIsland={onIsland}
                onToggleMusic={toggleMusic}
                onOpenAlmanac={() => setOverlay("almanac")}
                onOpenMapHelp={() => setOverlay("map-help")}
                onToggleMap={() => {
                    if (!doc.placement.done) {
                        flashToast("The mist still hides the island — the master awaits at the gazebo.");
                        return;
                    }
                    if (onIsland) {
                        return; // the miniature only knows the garden below
                    }
                    bus.emit("map:toggle", {});
                }}
                onSuperDepth={() => void openDepthAnalysis()}
                onStartTending={() => bus.emit("keeper:interact", {})}
            />

            {overlay === "plant-card" && selectedTopic && (
                <div className="garden-overlay" role="dialog" aria-label="Plant card">
                    <div className="panel-card plant-card-popover" style={panelFrameStyle()}>
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
                        <div
                            className="memory-bar-wrap"
                            role="progressbar"
                            aria-label="Memory"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(
                                Math.max(0, Math.min(1, selectedTopic.averageRecall)) * 100,
                            )}
                        >
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

            {overlay === "tour" && (
                <GardenTour
                    store={store}
                    startAtStep={tourStart.current}
                    onClose={() => {
                        syncFromStore();
                        setOverlay("none");
                    }}
                />
            )}

            {overlay === "placement" && (
                <div className="garden-overlay keeper-overlay">
                    <PlacementTest
                        store={store}
                        snapshot={snapshot}
                        onDone={() => {
                            setOverlay("none");
                            syncFromStore();
                            void refreshDashboard().catch(() => undefined);
                            void refreshSnapshot().catch(() => undefined);
                        }}
                    />
                </div>
            )}

            {overlay === "trial-quiz" && trialSection && (
                <div className="garden-overlay keeper-overlay">
                    <StoneExam
                        section={trialSection}
                        store={store}
                        onGranted={() => syncFromStore()}
                        onClose={() => {
                            setOverlay("none");
                            setTrialSection(null);
                            syncFromStore();
                        }}
                    />
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
                    <div className="panel-card map-help-panel" style={panelFrameStyle()}>
                        <div className="panel-header">
                            <h2>Map Help</h2>
                            <button className="keeper-close" onClick={() => setOverlay("none")} aria-label="Close">
                                ✕
                            </button>
                        </div>
                        <p>
                            Open the map (M), then click any open grassy spot to drop in there on foot. Water, paths,
                            and anything solid refuse the landing. Gold dots fast-travel to each garden&apos;s waystone;
                            the star marks tend-next.
                        </p>
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
                            <button
                                className="hud-ghost-button"
                                onClick={() => {
                                    setOverlay("none");
                                    bus.emit("intro:replay", {});
                                }}
                            >
                                ⟳ Replay the intro
                            </button>
                            <button
                                className="hud-ghost-button"
                                onClick={() => {
                                    tourStart.current = 0;
                                    setOverlay("tour");
                                }}
                            >
                                🌱 Replay the garden tour
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
