// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the sector-stone trial. Walk to the standing stone at a quadrant's heart,
// press interact, and this panel runs a short multiple-choice exam drawn from the open,
// public-domain MCQ bank (panels/mcq.ts). Each correct answer refills water; a flawless run
// pays a bonus — the "reward them with a bunch of water" beat. The trial is a standalone
// practice surface: it reads a bundled JSON bank and NEVER touches the Anki collection or
// FSRS (I1), so it cannot corrupt engine truth. Uses plain buttons only — no native <select>
// or date popups, which can blank Anki's QtWebEngine renderer (2026-07-03 crash fix).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { bus } from "../state/bus";
import { ECONOMY, onTrialCompleted, trialWaterReward } from "../state/economy";
import type { GardenStore } from "../state/store";
import { panelFrameStyle } from "./KeeperDialogue";
import { buildExam, type Mcq, metaForSection } from "./mcq";

/** How many questions one trial asks (capped by the section's bank size). */
const EXAM_SIZE = 5;

export interface StoneExamProps {
    /** The world's section id for the stone (e.g. "B-B"); mcq.ts normalizes it. */
    section: string;
    store: GardenStore;
    /** Called after water is credited so the HUD can re-read the balance live. */
    onGranted: () => void;
    /** Close the trial (also fired on abandon). */
    onClose: () => void;
}

type Phase = "intro" | "question" | "result" | "empty";

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

export function StoneExam(props: StoneExamProps): React.ReactElement {
    const { section, store, onGranted, onClose } = props;
    const meta = useMemo(() => metaForSection(section), [section]);
    const exam = useMemo(() => buildExam(section, EXAM_SIZE), [section]);

    const [phase, setPhase] = useState<Phase>(exam.length ? "intro" : "empty");
    const [index, setIndex] = useState(0);
    const [selected, setSelected] = useState<number | null>(null);
    const [earnedWater, setEarnedWater] = useState(0);

    // Correct count lives in a ref so the final tally is readable synchronously in the same
    // event that finishes the trial and credits water (a state read would lag one render).
    const correctRef = useRef(0);
    const grantedRef = useRef(false);

    const total = exam.length;
    const current: Mcq | undefined = exam[index];
    const revealed = selected !== null;

    const finish = useCallback((): void => {
        if (!grantedRef.current) {
            grantedRef.current = true;
            const correct = correctRef.current;
            const reward = trialWaterReward(correct, total);
            store.setBalances(onTrialCompleted(store.snapshot.economy, correct, total));
            setEarnedWater(reward);
            // The world answers the payout with a shower of rain over the garden.
            bus.emit("trial:rewarded", { water: reward });
            onGranted();
        }
        setPhase("result");
    }, [onGranted, store, total]);

    const choose = useCallback((optIdx: number): void => {
        if (selected !== null || !current) {
            return;
        }
        setSelected(optIdx);
        if (optIdx === current.answer) {
            correctRef.current += 1;
        }
    }, [current, selected]);

    const advance = useCallback((): void => {
        if (index + 1 >= total) {
            finish();
            return;
        }
        setIndex((i) => i + 1);
        setSelected(null);
    }, [finish, index, total]);

    // Keyboard: 1–4 pick an answer; Enter/Space begins, advances, or collects. (Escape is
    // owned by GardenUI's global handler, which closes the overlay = abandon, no reward.)
    useEffect(() => {
        function onKey(e: KeyboardEvent): void {
            if (phase === "intro" && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                setPhase("question");
                return;
            }
            if (phase === "result" && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onClose();
                return;
            }
            if (phase !== "question" || !current) {
                return;
            }
            if (!revealed && /^[1-4]$/.test(e.key)) {
                const optIdx = Number(e.key) - 1;
                if (optIdx < current.options.length) {
                    e.preventDefault();
                    choose(optIdx);
                }
            } else if (revealed && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                advance();
            }
        }
        globalThis.addEventListener("keydown", onKey);
        return () => globalThis.removeEventListener("keydown", onKey);
    }, [advance, choose, current, onClose, phase, revealed]);

    if (phase === "empty" || !current) {
        return (
            <div className="panel-card stone-exam" style={panelFrameStyle()} role="dialog" aria-label="Stone trial">
                <div className="panel-header">
                    <h2>{meta.stoneTitle}</h2>
                    <button className="keeper-close" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <p className="stone-exam-empty">
                    This stone has no questions to ask just yet. Come back soon — the {meta.subjectLabel} trial
                    is still taking shape.
                </p>
                <div className="panel-actions">
                    <button className="keeper-reveal" onClick={onClose}>Leave the stone</button>
                </div>
            </div>
        );
    }

    if (phase === "intro") {
        const perCorrect = ECONOMY.waterPerTrialCorrect;
        return (
            <div className="panel-card stone-exam" style={panelFrameStyle()} role="dialog" aria-label="Stone trial">
                <div className="panel-header">
                    <h2>{meta.stoneTitle}</h2>
                    <button className="keeper-close" onClick={onClose} aria-label="Close">✕</button>
                </div>
                <p className="stone-exam-lede">
                    The standing stone hums as you approach. Answer its {total} question{total === 1 ? "" : "s"} on
                    <strong> {meta.subjectLabel}</strong> and it will bless your garden with rain.
                </p>
                <ul className="stone-exam-terms">
                    <li>💧 <strong>+{perCorrect} water</strong> for each correct answer</li>
                    <li>🌧️ a bonus shower for a flawless run</li>
                    <li>✎ open, public-domain questions — no penalty for a wrong guess</li>
                </ul>
                <div className="panel-actions">
                    <button className="keeper-reveal" onClick={() => setPhase("question")}>
                        Begin the trial <kbd>Enter</kbd>
                    </button>
                </div>
            </div>
        );
    }

    if (phase === "result") {
        const correct = correctRef.current;
        const perfect = correct === total;
        let line = "The stone stirs. Every attempt still earns its drops.";
        if (perfect) {
            line = "A flawless trial. The stone opens the sky.";
        } else if (correct >= Math.ceil(total / 2)) {
            line = "Well answered. Rain gathers over your garden.";
        }
        return (
            <div className="panel-card stone-exam" style={panelFrameStyle()} role="dialog" aria-label="Trial result">
                <div className="panel-header">
                    <h2>{meta.stoneTitle} — result</h2>
                </div>
                <div className="stone-exam-score">
                    <span className="stone-exam-score-num">{correct}<span>/{total}</span></span>
                    <span className="stone-exam-score-label">correct</span>
                </div>
                <p className="stone-exam-reward">You earned <strong>💧 {earnedWater} water</strong></p>
                <p className="stone-exam-flavor">{line}</p>
                <div className="panel-actions">
                    <button className="keeper-reveal" onClick={onClose}>
                        Collect &amp; return <kbd>Enter</kbd>
                    </button>
                </div>
            </div>
        );
    }

    // phase === "question"
    return (
        <div className="panel-card stone-exam" style={panelFrameStyle()} role="dialog" aria-label="Stone trial question">
            <div className="panel-header">
                <h2>{meta.stoneTitle}</h2>
                <span className="stone-exam-progress" aria-live="polite">
                    Question {index + 1} of {total}
                </span>
                <button className="keeper-close" onClick={onClose} aria-label="Close">✕</button>
            </div>

            {current.passage
                ? <div className="stone-exam-passage" tabIndex={0}>{current.passage}</div>
                : null}

            <p className="stone-exam-stem">{current.stem}</p>

            <div className="stone-exam-options" role="group" aria-label="Answer choices">
                {current.options.map((opt, i) => {
                    const isCorrect = i === current.answer;
                    const isChosen = i === selected;
                    const cls = ["stone-exam-option"];
                    if (revealed && isCorrect) {
                        cls.push("is-correct");
                    }
                    if (revealed && isChosen && !isCorrect) {
                        cls.push("is-wrong");
                    }
                    return (
                        <button
                            key={current.id + ":" + i}
                            className={cls.join(" ")}
                            onClick={() => choose(i)}
                            disabled={revealed}
                            aria-pressed={isChosen}
                        >
                            <span className="stone-exam-letter">{OPTION_LETTERS[i]}</span>
                            <span className="stone-exam-option-text">{opt}</span>
                            {revealed && isCorrect ? <span className="stone-exam-mark">✓</span> : null}
                            {revealed && isChosen && !isCorrect ? <span className="stone-exam-mark">✗</span> : null}
                        </button>
                    );
                })}
            </div>

            {revealed
                ? (
                    <div className="stone-exam-explain">
                        <p className={selected === current.answer ? "stone-exam-verdict is-right" : "stone-exam-verdict is-off"}>
                            {selected === current.answer ? "Correct" : "Not quite"}
                        </p>
                        <p className="stone-exam-explanation">{current.explanation}</p>
                        <div className="panel-actions">
                            <button className="keeper-reveal" onClick={advance}>
                                {index + 1 >= total ? "See your reward" : "Next question"} <kbd>Enter</kbd>
                            </button>
                        </div>
                    </div>
                )
                : (
                    <p className="stone-exam-hint">Pick an answer — <kbd>1</kbd>–<kbd>4</kbd> or click.</p>
                )}
        </div>
    );
}
