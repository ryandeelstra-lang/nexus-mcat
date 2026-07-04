// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the master's placement ceremony (2026-07-03 directive). The island boots
// under fog; the Keeper first asks a short intake (exam date, target, daily time), then
// walks the player through twenty REAL questions spread across the four gardens (each
// grade is that card's genuine first FSRS review — placement IS seeding the engine), and
// closes on a "calibrating your study plan" beat while the fog lifts behind the dialogue.
// Planning/tally math lives in placement.ts (pure, tested); this file owns only the UI.
import React, { useEffect, useMemo, useRef, useState } from "react";

import { CardAnswer_Rating } from "@generated/anki/scheduler_pb";

import { assetUrl } from "../game/assets";
import { bus } from "../state/bus";
import type { MasterySnapshot } from "../state/mastery";
import type { GardenStore } from "../state/store";
import { KeeperDialogue } from "./KeeperDialogue";
import {
    applyOutcome,
    buildPlacementPlan,
    daysUntil,
    formatExamDate,
    partsToIsoDate,
    sectionsByAccuracy,
    type SectionTally,
} from "./placement";
import { scopeToDeck } from "./rpc";
import { StudyCard } from "./StudyCard";
import { useTalkingReveal } from "./use-talking-reveal";

type Beat =
    | "intro"
    | "intake-date"
    | "intake-score"
    | "intake-time"
    | "briefing"
    | "scoping"
    | "card"
    | "calibrating"
    | "result"
    | "error";

export interface PlacementTestProps {
    store: GardenStore;
    snapshot: MasterySnapshot;
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
            return "Welcome, gardener. A mist sleeps over every garden on this island — "
                + "all but this plaza. Before it parts, I must learn where you stand. "
                + "First, a few questions about the road ahead.";
        case "intake-date":
            return "When do you sit the MCAT? If the date isn't booked yet, that's honest too.";
        case "intake-score":
            return "And what score are you reaching for?";
        case "intake-time":
            return "Last one — how much time can you give this garden each day?";
        case "briefing":
            return ctx.resuming
                ? "Ready to continue? The mist waits on your answers."
                : `Then we begin. ${ctx.questions} questions, drawn from all four corners of `
                    + "the island. If you know it, say so; if not, say that too — "
                    + "nothing here is a grade. The island shapes itself to your answers.";
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
    const { store, snapshot, onDone } = props;
    const plan = useMemo(() => buildPlacementPlan(snapshot.topics), [snapshot]);

    const [beat, setBeat] = useState<Beat>("intro");
    const [stepIdx, setStepIdx] = useState(0);
    const [scopeKey, setScopeKey] = useState("placement:0");
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
    // One resolution per served card (the ProveIt pattern): after a grade, the StudyCard's
    // own loadNext can still fire onEmpty for the drained scope — without this, one answer
    // would advance the plan twice.
    const stepResolved = useRef(false);
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

    async function askQuestion(idx: number): Promise<void> {
        if (idx >= plan.length) {
            completeTest();
            return;
        }
        setStepIdx(idx);
        setBeat("scoping");
        try {
            await scopeToDeck(plan[idx].deckPath);
            stepResolved.current = false;
            setScopeKey(`placement:${idx}:${Date.now()}`);
            setBeat("card");
        } catch {
            setBeat("error");
        }
    }

    function beginQuestions(): void {
        startedOnce.current = true;
        void askQuestion(stepIdx);
    }

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

    function onCardGraded(rating: CardAnswer_Rating): void {
        if (stepResolved.current) {
            return;
        }
        stepResolved.current = true;
        const step = plan[stepIdx];
        const gotIt = rating !== CardAnswer_Rating.AGAIN;
        tally.current = applyOutcome(tally.current, step.section, gotIt);
        answered.current += 1;
        if (gotIt) {
            knew.current += 1;
        }
        void askQuestion(stepIdx + 1);
    }

    function onCardEmpty(): void {
        if (stepResolved.current) {
            return;
        }
        stepResolved.current = true;
        void askQuestion(stepIdx + 1);
    }

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

    // Question beats reuse the untouched StudyCard (the REAL review loop) with a
    // placement header; Escape "pauses" back to the briefing, never abandons the test.
    if (beat === "scoping" || beat === "card" || beat === "error") {
        const step = plan[stepIdx];
        return (
            <div className="keeper-panel-shell" role="dialog" aria-label="Placement test">
                {beat === "scoping" && <div className="keeper-status">The master prepares {step.label}…</div>}
                {beat === "error" && (
                    <div className="keeper-status" role="alert">
                        The master could not reach {step.label} right now.
                        <div className="keeper-actions">
                            <button
                                className="hud-ghost-button"
                                onClick={() => void askQuestion(stepIdx)}
                            >
                                Try again
                            </button>
                            <button
                                className="hud-ghost-button"
                                onClick={() => void askQuestion(stepIdx + 1)}
                            >
                                Skip this one
                            </button>
                        </div>
                    </div>
                )}
                {beat === "card" && (
                    <StudyCard
                        scopeKey={scopeKey}
                        contextLabel={`Placement · ${stepIdx + 1} of ${plan.length} — ${step.label}`}
                        onClose={() => setBeat("briefing")}
                        onEmpty={onCardEmpty}
                        onGraded={(event) => onCardGraded(event.rating)}
                    />
                )}
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
                            {parsedExamDate ? formatExamDate(parsedExamDate) : " "}
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
