// charged_up: paraphrase-gate seam (doc 23 §5.1 step 7 / §17 keystone) for budding topics.
// Now REAL (voice spec §4): the Keeper asks the topic's reworded (SpokenPrompt/corpus)
// variant and the SERVER grades the spoken/typed answer — the old decorative textarea +
// self-grade placeholder is gone. Pass = the server's `bloomed` verdict.
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
    onResolved: (result: { nodeId: string; passed: boolean; skipped?: boolean }) => void;
    onExit: () => void;
}

type Step = "intro" | "scoping" | "card" | "result" | "error";

export function ProveIt(props: ProveItProps): React.ReactElement {
    const { topic, onResolved, onExit } = props;
    const [step, setStep] = useState<Step>("intro");
    const [scopeKey, setScopeKey] = useState(`${topic.deckPath}:variant:0`);
    const [passed, setPassed] = useState(false);
    const resolved = useRef(false);

    async function beginCheck(): Promise<void> {
        setStep("scoping");
        try {
            await scopeToDeck(topic.deckPath);
            setScopeKey(`${topic.deckPath}:variant:${Date.now()}`);
            setStep("card");
        } catch {
            setStep("error");
        }
    }

    return (
        <div className="proveit-panel">
            {(step === "intro" || step === "scoping") && (
                <div className="proveit-brief">
                    <h3>Prove it: {topic.label}</h3>
                    <p>
                        You remember this — can you use it? The Keeper will ask it a new way; answer out loud (or type)
                        in your own words.
                    </p>
                    <div className="proveit-actions">
                        <button
                            className="hud-ghost-button"
                            onClick={() => void beginCheck()}
                            disabled={step === "scoping"}
                        >
                            {step === "scoping" ? "Preparing..." : "Take the reworded ask"}
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
                            setStep("result");
                        }
                    }}
                    onGraded={(event) => {
                        if (!resolved.current) {
                            resolved.current = true;
                            setPassed(event.rating !== CardAnswer_Rating.AGAIN);
                            setStep("result");
                        }
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
