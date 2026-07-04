// charged_up: always-on HUD for balances, sky dial, and gentle tutorial guidance (doc 23 §6.7).
import React, { useEffect, useMemo, useRef, useState } from "react";

import type { Balances } from "../state/economy";
import type { TutorialState } from "../state/store";

interface HudProps {
    balances: Balances;
    tutorial: TutorialState;
    growthLine: string | null;
    musicMuted: boolean;
    /** True while any panel/overlay/map covers the world — the walk hint would
     * collide with foreground UI (IDK bar, miss strip, map caption), so it yields. */
    hideHint?: boolean;
    /** True while the avatar stands on the Overlook — the Depth button flips to the
     * way home and the Map button rests (the map only knows the garden below). */
    onIsland?: boolean;
    onToggleMusic: () => void;
    onOpenAlmanac: () => void;
    onOpenMapHelp: () => void;
    onToggleMap: () => void;
    /** Super Depth Analysis: teleport to the Overlook (or back, when already there). */
    onSuperDepth: () => void;
    /** The one-press way into today's tending (opens the Keeper). */
    onStartTending: () => void;
}

type SkyDialPhase = "day" | "night";

interface SkyDialState {
    phase: SkyDialPhase;
    progress: number;
}

const NIGHT_START_HOUR = 4;
const NIGHT_END_HOUR = 8;

function skyDialStateFor(date: Date): SkyDialState {
    const hour = date.getHours();
    const minute = date.getMinutes();
    const minutes = hour * 60 + minute;
    const nightStart = NIGHT_START_HOUR * 60;
    const nightEnd = NIGHT_END_HOUR * 60;
    const phase: SkyDialPhase = minutes >= nightStart && minutes < nightEnd ? "night" : "day";
    if (phase === "night") {
        // The moon walks the same arc across its 4-hour night (doc 23 §9.5) — a frozen
        // marker reads as a broken dial.
        return {
            phase,
            progress: Math.max(0, Math.min(1, (minutes - nightStart) / (nightEnd - nightStart))),
        };
    }
    const span = (24 * 60 - nightEnd) + nightStart;
    const adjusted = minutes < nightStart ? minutes + 24 * 60 : minutes;
    const progress = (adjusted - nightEnd) / span;
    return {
        phase,
        progress: Math.max(0, Math.min(1, progress)),
    };
}

function tutorialHint(tutorial: TutorialState): string {
    if (tutorial.done) {
        return "Tend what feels right today.";
    }
    switch (tutorial.beat) {
        case 0:
            return "Walk to the Keeper at the center.";
        case 1:
            return "Talk with the Keeper to begin.";
        case 2:
            return "Answer aloud or by typing - every answer refills water.";
        case 3:
            return "Walk anywhere and press Space to water the ground.";
        case 4:
            return "Explain it in your words - the plant blooms and a gate opens.";
        default:
            return "One plot at a time is enough.";
    }
}

export function Hud(props: HudProps): React.ReactElement {
    const {
        balances,
        tutorial,
        growthLine,
        musicMuted,
        hideHint = false,
        onIsland = false,
        onToggleMusic,
        onOpenAlmanac,
        onOpenMapHelp,
        onToggleMap,
        onSuperDepth,
        onStartTending,
    } = props;
    const [sky, setSky] = useState<SkyDialState>(() => skyDialStateFor(new Date()));
    const [reducedMotion, setReducedMotion] = useState(false);
    const [waterBump, setWaterBump] = useState(false);
    const lastBalances = useRef<Balances>(balances);
    const tip = useMemo(() => tutorialHint(tutorial), [tutorial]);

    useEffect(() => {
        const media = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
        if (!media) {
            return;
        }
        const update = (): void => setReducedMotion(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    useEffect(() => {
        const tick = (): void => setSky(skyDialStateFor(new Date()));
        tick();
        const id = globalThis.setInterval(tick, 60_000);
        return () => globalThis.clearInterval(id);
    }, []);

    useEffect(() => {
        if (balances.water !== lastBalances.current.water) {
            setWaterBump(true);
            globalThis.setTimeout(() => setWaterBump(false), 180);
        }
        lastBalances.current = balances;
    }, [balances]);

    const markerX = 4 + sky.progress * 32;
    const markerY = 18 - Math.sin(Math.PI * sky.progress) * 10;
    const chipWaterClass = [
        "hud-chip",
        !reducedMotion && waterBump ? "hud-bump" : "",
    ].filter(Boolean).join(" ");

    return (
        <div className="garden-hud" aria-label="Garden heads-up display">
            <div className="hud-top hud-top-left">
                <span className={chipWaterClass} aria-label={`Water: ${balances.water}`}>
                    💧 {balances.water}
                </span>
            </div>

            <div className="hud-top hud-top-right">
                <button className="hud-ghost-button" onClick={onOpenAlmanac}>
                    Almanac
                </button>
                <button
                    className="hud-ghost-button"
                    onClick={onSuperDepth}
                    title={onIsland
                        ? "Return to the garden"
                        : "Super Depth Analysis — visit the Overlook"}
                >
                    {onIsland ? "Garden" : "Depth"}
                </button>
                <button className="hud-ghost-button" onClick={onToggleMap} disabled={onIsland}>
                    Map
                </button>
                <button className="hud-ghost-button" onClick={onOpenMapHelp} aria-label="Help">
                    ?
                </button>
                <button
                    className="hud-ghost-button"
                    onClick={onToggleMusic}
                    aria-label={musicMuted ? "Turn music on" : "Turn music off"}
                    aria-pressed={!musicMuted}
                    title={musicMuted ? "Music off" : "Music on"}
                >
                    {musicMuted ? "🔇" : "🎵"}
                </button>
                <div
                    className="hud-dial"
                    role="img"
                    aria-label={sky.phase === "night" ? "Night" : "Daytime"}
                    title={sky.phase === "night" ? "Night" : "Daytime"}
                >
                    <svg viewBox="0 0 40 20" aria-hidden="true">
                        <path d="M4 18 A16 16 0 0 1 36 18" className="hud-dial-arc" />
                        <circle
                            cx={markerX}
                            cy={markerY}
                            r={3.5}
                            className={sky.phase === "night" ? "hud-dial-moon" : "hud-dial-sun"}
                        />
                    </svg>
                </div>
                {growthLine && <span className="hud-growth-line">{growthLine}</span>}
            </div>

            {!hideHint && (
                <div className="hud-bottom">
                    {
                        /* The decided primary CTA (doc 17 §4 / Decision 29): one press into
                      * today's tending, always visible; the hint is the secondary line. */
                    }
                    <button className="hud-cta" onClick={onStartTending}>
                        Start today's tending
                    </button>
                    <span className="hud-hint">{tip}</span>
                </div>
            )}
        </div>
    );
}
