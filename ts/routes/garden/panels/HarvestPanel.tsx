// charged_up: cozy session-end harvest summary (doc 23 §5.2/§7.1/§10.4).
import React from "react";

interface HarvestPanelProps {
    wateredPlots: number;
    answers: number;
    blooms: number;
    growthLine: string | null;
    onKeepTending: () => void;
    onDone: () => void;
}

export function HarvestPanel(props: HarvestPanelProps): React.ReactElement {
    const { wateredPlots, answers, blooms, growthLine, onKeepTending, onDone } = props;
    return (
        <div className="garden-overlay harvest-overlay" role="dialog" aria-label="Harvest summary">
            <div className="panel-card harvest-panel">
                <div className="panel-header">
                    <h2>Harvest</h2>
                </div>
                <div className="harvest-grid">
                    <p>Plots watered: {wateredPlots}</p>
                    <p>Answers: {answers}</p>
                    <p>New blooms: {blooms}</p>
                </div>
                {growthLine && <p className="harvest-growth">{growthLine}; on track.</p>}
                <div className="harvest-actions">
                    <button className="hud-ghost-button" onClick={onKeepTending}>
                        Keep tending
                    </button>
                    <button className="hud-ghost-button" onClick={onDone}>
                        Done for today
                    </button>
                </div>
            </div>
        </div>
    );
}
