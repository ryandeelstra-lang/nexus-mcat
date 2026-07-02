// charged_up: paraphrase-gate seam (doc 23 §5.1 step 7 / §17 keystone) for budding topics.
import React, { useRef, useState } from "react";

import { CardAnswer_Rating } from "@generated/anki/scheduler_pb";

import { scopeToDeck } from "./rpc";
import { StudyCard } from "./StudyCard";

export interface ProveItTopic {
    nodeId: string;
    deckPath: string;
    label: string;
}

interface ProveItProps {
    topic: ProveItTopic;
    onResolved: (result: { nodeId: string; passed: boolean }) => void;
    onExit: () => void;
}

type Step = "intro" | "scoping" | "card" | "result" | "error";

export function ProveIt(props: ProveItProps): React.ReactElement {
    const { topic, onResolved, onExit } = props;
    const [explanation, setExplanation] = useState("");
    const [step, setStep] = useState<Step>("intro");
    const [scopeKey, setScopeKey] = useState(`${topic.deckPath}:variant:0`);
    const [passed, setPassed] = useState(false);
    const resolved = useRef(false);

    async function beginCheck(): Promise<void> {
        if (!explanation.trim()) {
            return;
        }
        setStep("scoping");
        try {
            await scopeToDeck(topic.deckPath);
            setScopeKey(`${topic.deckPath}:variant:${Date.now()}`);
            setStep("card");
        } catch {
            setStep("error");
        }
    }

    function resolveFromRating(rating: CardAnswer_Rating): void {
        if (resolved.current) {
            return;
        }
        resolved.current = true;
        const didPass = rating === CardAnswer_Rating.GOOD || rating === CardAnswer_Rating.EASY;
        setPassed(didPass);
        setStep("result");
    }

    return (
        <div className="proveit-panel">
            {(step === "intro" || step === "scoping") && (
                <div className="proveit-brief">
                    <h3>Prove it: {topic.label}</h3>
                    <p>
                        You remember this - can you use it? Explain the core idea in one line, then take a reworded
                        check.
                    </p>
                    {
                        /* v1 seam (doc 23 §17): StudyCard cannot yet invert prompt/answer, so we
                        require retrieval-through-explanation before the variant grade step. G3.4
                        hardens this into real generated variants. */
                    }
                    <label className="proveit-label" htmlFor="proveit-explanation">
                        Your explanation
                    </label>
                    <textarea
                        id="proveit-explanation"
                        className="proveit-textarea"
                        value={explanation}
                        onChange={(e) => setExplanation(e.target.value)}
                        rows={3}
                        placeholder="In your own words..."
                    />
                    <div className="proveit-actions">
                        <button
                            className="hud-ghost-button"
                            onClick={() => void beginCheck()}
                            disabled={!explanation.trim() || step === "scoping"}
                        >
                            {step === "scoping" ? "Preparing..." : "Start reworded check"}
                        </button>
                        <button className="hud-ghost-button" onClick={onExit}>
                            Close
                        </button>
                    </div>
                </div>
            )}

            {step === "card" && (
                <StudyCard
                    scopeKey={scopeKey}
                    contextLabel={`Reworded check: ${topic.label}`}
                    onClose={onExit}
                    onEmpty={() => {
                        if (!resolved.current) {
                            resolved.current = true;
                            setPassed(false);
                            setStep("result");
                        }
                    }}
                    onGraded={(event) => {
                        resolveFromRating(event.rating);
                    }}
                />
            )}

            {step === "error" && (
                <div className="keeper-status" role="alert">
                    The Keeper could not prepare this reworded check right now.
                </div>
            )}

            {step === "result" && (
                <div className="proveit-result">
                    <p>
                        {passed
                            ? "Beautiful. That bud can bloom."
                            : "Not yet - it stays a bud. The Keeper will bring it back."}
                    </p>
                    <button
                        className="hud-ghost-button"
                        onClick={() => onResolved({ nodeId: topic.nodeId, passed })}
                    >
                        Continue
                    </button>
                </div>
            )}
        </div>
    );
}
