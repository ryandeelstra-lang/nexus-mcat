// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Garden Tour panel (spec: docs/superpowers/specs/
// 2026-07-03-garden-tour-design.md). The Keeper walks the new gardener through every
// shipped concept — one beat at a time — and each beat lands a "🌱 The science" footnote
// naming the learning principle behind the mechanic. The step script lives in
// state/tour.ts; this panel is chrome + cursor. Progress persists on every advance
// (Esc = pause, resumes next visit); Skip and the final Continue persist done forever.
import React, { useCallback, useEffect, useState } from "react";

import { assetUrl } from "../game/assets";
import type { GardenStore } from "../state/store";
import { advanceTour, currentStep, skipTour, TOUR_STEPS, type TourSnapshot } from "../state/tour";
import { KeeperDialogue } from "./KeeperDialogue";
import { useTalkingReveal } from "./use-talking-reveal";

export interface GardenTourProps {
    store: GardenStore;
    /** Where to open the book: the persisted cursor on first run, 0 on a Help-panel replay. */
    startAtStep: number;
    onClose: () => void;
}

export function GardenTour(props: GardenTourProps): React.ReactElement | null {
    const { store, startAtStep, onClose } = props;
    const [state, setState] = useState<TourSnapshot>(() => ({
        step: Math.max(0, Math.min(startAtStep, TOUR_STEPS.length - 1)),
        done: false,
    }));
    const step = currentStep(state);
    const reveal = useTalkingReveal(step?.line ?? "", { resetKey: step?.id ?? -1 });

    /** Persist the cursor forward-only: never un-finish a finished tour, and never let a
     * Help-panel replay (which starts back at beat 0) regress a paused player's resume
     * point. */
    const persist = useCallback(
        (next: TourSnapshot): void => {
            const saved = store.snapshot.tour;
            if (saved.done || next.step <= saved.step) {
                return;
            }
            store.setTour(next);
        },
        [store],
    );

    const finish = useCallback((): void => {
        store.setTour({ step: TOUR_STEPS.length, done: true });
        onClose();
    }, [store, onClose]);

    const advance = useCallback((): void => {
        const next = advanceTour(state);
        if (next === state) {
            return;
        }
        if (next.done) {
            store.setTour(next);
            onClose();
            return;
        }
        persist(next);
        setState(next);
    }, [state, store, persist, onClose]);

    const skip = useCallback((): void => {
        store.setTour(skipTour(store.snapshot.tour));
        onClose();
    }, [store, onClose]);

    /** One key story: Space/Enter/E snap the crawl, then advance — like every dialogue. */
    useEffect(() => {
        function onKeydown(e: KeyboardEvent): void {
            if (e.key !== " " && e.key !== "Enter" && e.key.toLowerCase() !== "e") {
                return;
            }
            // OS auto-repeat must never speed-run the tour: a held Space (the standard
            // impatient dialogue gesture — and the water key) would otherwise alternate
            // snap/advance through all the beats and persist the tour done in about a
            // second. One press, one intent.
            if (e.repeat) {
                return;
            }
            // Never steal keys from a button/link the player has focused (a11y).
            const target = e.target as HTMLElement | null;
            if (target && (target.tagName === "BUTTON" || target.tagName === "A")) {
                return;
            }
            e.preventDefault();
            if (reveal.done) {
                advance();
            } else {
                reveal.finish();
            }
        }
        globalThis.addEventListener("keydown", onKeydown);
        return () => globalThis.removeEventListener("keydown", onKeydown);
    }, [reveal, advance]);

    if (!step) {
        return null;
    }
    const isLast = step.id === TOUR_STEPS.length - 1;

    return (
        <div className="garden-overlay keeper-overlay garden-tour" role="dialog" aria-label="Garden tour">
            <div className="keeper-panel-shell">
                <KeeperDialogue
                    portraitSrc={assetUrl("keeper-portrait") ?? ""}
                    speakerName="The Keeper"
                    badge={<span className="tour-step-chip">{step.title}</span>}
                    body={reveal.shown}
                    srText={`${step.line} The science: ${step.science}`}
                    showCaret={!reveal.done}
                    onBodyClick={() => (reveal.done ? advance() : reveal.finish())}
                    onContinue={reveal.done ? advance : undefined}
                    continueLabel={isLast ? "Begin tending" : "Continue"}
                >
                    {reveal.done && (
                        <div className="tour-science" aria-hidden="true">
                            <span className="tour-science-label">🌱 The science</span>
                            <p>{step.science}</p>
                        </div>
                    )}
                    <div className="tour-controls">
                        <span className="tour-progress" aria-label={`Part ${step.id + 1} of ${TOUR_STEPS.length}`}>
                            {TOUR_STEPS.map((s) => (
                                <span
                                    key={s.id}
                                    className={`tour-dot${s.id === step.id ? " tour-dot-now" : ""}${
                                        s.id < step.id ? " tour-dot-past" : ""
                                    }`}
                                />
                            ))}
                        </span>
                        <button className="garden-tour-skip" onClick={skip}>
                            Skip the tour
                        </button>
                        {isLast && reveal.done && (
                            <button className="keeper-reveal tour-begin" onClick={finish}>
                                Begin tending <kbd>Space</kbd>
                            </button>
                        )}
                    </div>
                </KeeperDialogue>
            </div>
        </div>
    );
}
