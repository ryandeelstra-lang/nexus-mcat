// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the master's placement ceremony (2026-07-03 directive; MCQ'd 2026-07-05 —
// Decision 46). The island boots under fog; the Keeper first asks a short intake (exam date,
// target, daily time), then walks the player through twenty multiple-choice questions drawn
// from the open CC0 MCQ bank (the same one the sector-stone trials use), and closes on a
// "calibrating your study plan" beat while the fog lifts behind the dialogue. No question
// ever reveals correct/wrong as you answer — every pick is tallied silently and the whole
// diagnostic surfaces only in the calibration/result beat at the end.
// Planning/tally math lives in placement.ts (pure, tested); this file owns only the UI.
import React, { useEffect, useMemo, useRef, useState } from "react";

import { assetUrl } from "../game/assets";
import { bus } from "../state/bus";
import type { GardenStore } from "../state/store";
import { KeeperDialogue } from "./KeeperDialogue";
import { metaForSection } from "./mcq";
import {
    applyOutcome,
    buildPlacementExam,
    daysUntil,
    formatExamDate,
    partsToIsoDate,
    sectionsByAccuracy,
    type SectionTally,
} from "./placement";
import { useTalkingReveal } from "./use-talking-reveal";

type Beat =
    | "intro"
    | "intake-date"
    | "intake-score"
    | "intake-time"
    | "briefing"
    | "question"
    | "calibrating"
    | "result";

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

export interface PlacementTestProps {
    store: GardenStore;
    /** Fired after the result beat's continue — the test is already persisted by then. */
    onDone: () => void;
}

/** Where a weak section sends you, in island language. */
const GARDEN_NAMES: Record<string, string> = {
    "P-S": "the Sakura stream (Psych/Soc)",
    "B-B": "the Tulip fields (Bio/Biochem)",
    "C-P": "the Parterre garden (Chem/Phys)",
    "CARS": "the Night garden (CARS)",
};

const TARGET_CHOICES = [505, 510, 515, 520, 528];
const TIME_CHOICES: Array<{ minutes: number; label: string }> = [
    { minutes: 30, label: "30 min" },
    { minutes: 60, label: "1 hour" },
    { minutes: 120, label: "2 hours" },
    { minutes: 240, label: "4+ hours" },
];

/** The master's line for each speech beat (kept together so the voice stays one voice). */
function masterLine(
    beat: Beat,
    ctx: {
        questions: number;
        answered: number;
        knew: number;
        weakest: string | null;
        resuming: boolean;
    },
): string {
    switch (beat) {
        case "intro":
            return "Welcome. Before the mist lifts, three quick questions.";
        case "intake-date":
            return "When's your MCAT? Not booked yet is fine.";
        case "intake-score":
            return "Target score?";
        case "intake-time":
            return "Daily study time?";
        case "briefing":
            return ctx.resuming
                ? "Ready to continue?"
                : `${ctx.questions} questions across all four gardens. Answer honestly — `
                    + "this isn't graded.";
        case "calibrating":
            return "";
        case "result": {
            const start = ctx.weakest
                ? ` We'll begin among ${GARDEN_NAMES[ctx.weakest] ?? ctx.weakest}.`
                : "";
            return `Done. You knew ${ctx.knew} of the ${ctx.answered} I asked.${start} `
                + "Look — the mist is gone. The whole island is yours to walk.";
        }
        default:
            return "";
    }
}

export function PlacementTest(props: PlacementTestProps): React.ReactElement {
    const { store, onDone } = props;
    const plan = useMemo(() => buildPlacementExam(), []);

    const [beat, setBeat] = useState<Beat>("intro");
    const [stepIdx, setStepIdx] = useState(0);
    const [selected, setSelected] = useState<number | null>(null);
    const [calStep, setCalStep] = useState(0);
    // The exam date is typed into plain numeric fields (month / day / year), NOT a native
    // <input type="date">: its OS picker popup can blank Anki's QtWebEngine renderer, which
    // un-mounts the whole React root and takes the entire game with it (2026-07-03 fix).
    const [monthDraft, setMonthDraft] = useState("");
    const [dayDraft, setDayDraft] = useState("");
    const [yearDraft, setYearDraft] = useState("");
    const parsedExamDate = partsToIsoDate(
        yearDraft ? Number(yearDraft) : null,
        monthDraft ? Number(monthDraft) : null,
        dayDraft ? Number(dayDraft) : null,
    );
    // The running score lives in refs, NOT state: a grade must be readable synchronously
    // in the same event that finishes the test, or the final answer would persist stale.
    const tally = useRef<Record<string, SectionTally>>({});
    const answered = useRef(0);
    const knew = useRef(0);
    const intake = useRef({
        examDateIso: null as string | null,
        targetScore: null as number | null,
        minutesPerDay: null as number | null,
    });
    const calTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const startedOnce = useRef(false);

    useEffect(() => () => {
        if (calTimer.current) {
            clearTimeout(calTimer.current);
        }
    }, []);

    const weakest = sectionsByAccuracy(tally.current)[0] ?? null;
    const line = masterLine(beat, {
        questions: plan.length,
        answered: answered.current,
        knew: knew.current,
        weakest,
        resuming: startedOnce.current,
    });
    const reveal = useTalkingReveal(line, { resetKey: beat });

    /** Persist + announce FIRST, then play the calibration beat while the fog lifts behind it. */
    function completeTest(): void {
        store.setPlacement({
            done: true,
            answered: answered.current,
            knew: knew.current,
            tally: { ...tally.current },
            intake: { ...intake.current },
            completedAtMs: Date.now(),
        });
        bus.emit("placement:completed", { answered: answered.current, knew: knew.current });
        setCalStep(0);
        setBeat("calibrating");
        runCalibration(0);
    }

    function calibrationLines(): string[] {
        const days = daysUntil(intake.current.examDateIso, Date.now());
        return [
            `Reading your ${answered.current} answers…`,
            "Mapping your strengths across the four gardens…",
            days !== null
                ? `Pacing to your exam — ${days} days from today…`
                : "Pacing an open calendar…",
            "Calibrating your study plan…",
        ];
    }

    function runCalibration(step: number): void {
        const total = calibrationLines().length;
        if (step > total) {
            setBeat("result");
            return;
        }
        setCalStep(step);
        calTimer.current = setTimeout(() => runCalibration(step + 1), 950);
    }

    function beginQuestions(): void {
        startedOnce.current = true;
        setSelected(null);
        setBeat("question");
    }

    /** Record the pick silently — no correct/wrong reveal — then wait for "Next question". */
    function choose(optIdx: number): void {
        if (selected !== null) {
            return;
        }
        setSelected(optIdx);
        const step = plan[stepIdx];
        const gotIt = optIdx === step.answer;
        tally.current = applyOutcome(tally.current, step.section, gotIt);
        answered.current += 1;
        if (gotIt) {
            knew.current += 1;
        }
    }

    function advanceQuestion(): void {
        if (stepIdx + 1 >= plan.length) {
            completeTest();
            return;
        }
        setStepIdx((i) => i + 1);
        setSelected(null);
    }

    // Keyboard: 1-4 pick an answer, Enter/Space advances once one's picked, Escape "pauses"
    // back to the briefing (never abandons the test) — but only before a pick is recorded,
    // so resuming can never re-tally the same question. This beat owns Escape locally so
    // GardenUI's global handler (which would otherwise close the whole overlay) never sees it.
    useEffect(() => {
        if (beat !== "question") {
            return;
        }
        function onKeydown(e: KeyboardEvent): void {
            if (e.key === "Escape") {
                if (selected === null) {
                    setBeat("briefing");
                }
                return;
            }
            if (selected === null && /^[1-4]$/.test(e.key)) {
                const optIdx = Number(e.key) - 1;
                if (optIdx < plan[stepIdx].options.length) {
                    e.preventDefault();
                    choose(optIdx);
                }
            } else if (selected !== null && (e.key === " " || e.key === "Enter")) {
                e.preventDefault();
                advanceQuestion();
            }
        }
        window.addEventListener("keydown", onKeydown);
        return () => window.removeEventListener("keydown", onKeydown);
    }, [beat, selected, stepIdx, plan]);

    const facts: string[] = [];
    if (beat === "result") {
        const days = daysUntil(intake.current.examDateIso, Date.now());
        if (days !== null) {
            facts.push(`${days} days to exam day`);
        }
        if (intake.current.targetScore !== null) {
            facts.push(`aiming ${intake.current.targetScore}`);
        }
        if (intake.current.minutesPerDay !== null) {
            facts.push(`~${intake.current.minutesPerDay} min a day`);
        }
        for (const section of sectionsByAccuracy(tally.current)) {
            const t = tally.current[section];
            facts.push(`${section}: ${t.knew}/${t.asked}`);
        }
    }

    // Question beat: a plain multiple-choice pick, no correct/wrong reveal — the diagnostic
    // surfaces only at the end, in the calibration/result beats below.
    if (beat === "question") {
        const step = plan[stepIdx];
        const meta = metaForSection(step.section);
        return (
            <div className="keeper-panel-shell" role="dialog" aria-label="Placement test">
                <div className="keeper-panel">
                    <div className="keeper-panel-header">
                        <span className="keeper-context">
                            Placement · {stepIdx + 1} of {plan.length} — {meta.subjectLabel}
                        </span>
                        {selected === null && (
                            <button
                                className="keeper-close"
                                onClick={() => setBeat("briefing")}
                                aria-label="Pause"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    {step.passage && <div className="stone-exam-passage" tabIndex={0}>{step.passage}</div>}
                    <p className="stone-exam-stem">{step.stem}</p>
                    <div className="stone-exam-options" role="group" aria-label="Answer choices">
                        {step.options.map((opt, i) => (
                            <button
                                key={step.id + ":" + i}
                                className={"stone-exam-option" + (selected === i ? " is-chosen" : "")}
                                onClick={() => choose(i)}
                                disabled={selected !== null}
                                aria-pressed={selected === i}
                            >
                                <span className="stone-exam-letter">{OPTION_LETTERS[i]}</span>
                                <span className="stone-exam-option-text">{opt}</span>
                            </button>
                        ))}
                    </div>
                    {selected !== null
                        ? (
                            <div className="keeper-actions">
                                <button className="keeper-reveal" onClick={advanceQuestion}>
                                    {stepIdx + 1 >= plan.length ? "See your results" : "Next question"}{" "}
                                    <kbd>Enter</kbd>
                                </button>
                            </div>
                        )
                        : (
                            <p className="stone-exam-hint">Pick an answer — <kbd>1</kbd>–<kbd>4</kbd> or click.</p>
                        )}
                </div>
            </div>
        );
    }

    if (beat === "calibrating") {
        const lines = calibrationLines();
        return (
            <div className="keeper-panel-shell" role="dialog" aria-label="Calibrating">
                <KeeperDialogue
                    portraitSrc={assetUrl("keeper-portrait") ?? ""}
                    speakerName="The Master"
                    body={
                        <span className="placement-calibrating">
                            {lines.slice(0, calStep).map((l) => (
                                <span key={l}>
                                    {l}
                                    <br />
                                </span>
                            ))}
                        </span>
                    }
                    srText={lines.slice(0, calStep).join(" ")}
                    dots={calStep <= lines.length}
                />
            </div>
        );
    }

    // Speech beats: intro, the three intake questions, briefing, result. Only the intro and
    // the final result carry the arrow-coin "continue" (the intake beats advance via choices).
    let onContinue: (() => void) | undefined;
    if (beat === "intro") {
        onContinue = () => setBeat("intake-date");
    } else if (beat === "result") {
        onContinue = onDone;
    }
    return (
        <div className="keeper-panel-shell" role="dialog" aria-label="Placement test">
            <KeeperDialogue
                portraitSrc={assetUrl("keeper-portrait") ?? ""}
                speakerName="The Master"
                body={reveal.shown}
                srText={line}
                showCaret={!reveal.done}
                onBodyClick={reveal.finish}
                onContinue={onContinue}
            >
                {reveal.done && beat === "intake-date" && (
                    <div className="keeper-actions placement-intake">
                        <div className="placement-date-fields" role="group" aria-label="MCAT exam date">
                            <label className="placement-date-field">
                                <span>Month</span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    className="placement-date placement-date-part"
                                    placeholder="MM"
                                    maxLength={2}
                                    aria-label="Exam month (1–12)"
                                    value={monthDraft}
                                    onChange={(e) => setMonthDraft(e.target.value.replace(/\D/g, ""))}
                                />
                            </label>
                            <label className="placement-date-field">
                                <span>Day</span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    className="placement-date placement-date-part"
                                    placeholder="DD"
                                    maxLength={2}
                                    aria-label="Exam day (1–31)"
                                    value={dayDraft}
                                    onChange={(e) => setDayDraft(e.target.value.replace(/\D/g, ""))}
                                />
                            </label>
                            <label className="placement-date-field">
                                <span>Year</span>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    className="placement-date placement-date-part placement-date-year"
                                    placeholder="YYYY"
                                    maxLength={4}
                                    aria-label="Exam year"
                                    value={yearDraft}
                                    onChange={(e) => setYearDraft(e.target.value.replace(/\D/g, ""))}
                                />
                            </label>
                        </div>
                        <span className="placement-date-confirm" aria-live="polite">
                            {parsedExamDate ? formatExamDate(parsedExamDate) : " "}
                        </span>
                        <div className="placement-intake-actions">
                            <button
                                className="keeper-reveal"
                                disabled={!parsedExamDate}
                                onClick={() => {
                                    intake.current.examDateIso = parsedExamDate;
                                    setBeat("intake-score");
                                }}
                            >
                                That&apos;s the day
                            </button>
                            <button
                                className="hud-ghost-button"
                                onClick={() => {
                                    intake.current.examDateIso = null;
                                    setBeat("intake-score");
                                }}
                            >
                                Not booked yet
                            </button>
                        </div>
                    </div>
                )}
                {reveal.done && beat === "intake-score" && (
                    <div className="keeper-actions placement-intake">
                        {TARGET_CHOICES.map((score) => (
                            <button
                                key={score}
                                className="hud-ghost-button"
                                onClick={() => {
                                    intake.current.targetScore = score;
                                    setBeat("intake-time");
                                }}
                            >
                                {score}
                            </button>
                        ))}
                        <button
                            className="hud-ghost-button"
                            onClick={() => {
                                intake.current.targetScore = null;
                                setBeat("intake-time");
                            }}
                        >
                            Not sure yet
                        </button>
                    </div>
                )}
                {reveal.done && beat === "intake-time" && (
                    <div className="keeper-actions placement-intake">
                        {TIME_CHOICES.map(({ minutes, label }) => (
                            <button
                                key={minutes}
                                className="hud-ghost-button"
                                onClick={() => {
                                    intake.current.minutesPerDay = minutes;
                                    setBeat("briefing");
                                }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}
                {reveal.done && beat === "briefing" && (
                    <div className="keeper-actions">
                        <button className="keeper-reveal" onClick={beginQuestions}>
                            {startedOnce.current && stepIdx > 0
                                ? "Continue the questions"
                                : "Begin"}
                        </button>
                    </div>
                )}
                {reveal.done && beat === "result" && facts.length > 0 && (
                    <div className="placement-facts" aria-label="Your plan">
                        {facts.map((f) => <span key={f} className="placement-fact">{f}</span>)}
                    </div>
                )}
            </KeeperDialogue>
        </div>
    );
}
