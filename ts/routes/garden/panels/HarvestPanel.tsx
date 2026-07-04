// charged_up: cozy session-end harvest summary (doc 23 §5.2/§7.1/§10.4).
import React from "react";

import { panelFrameStyle } from "./KeeperDialogue";

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
        <div className="garden-overlay harvest-overlay" role="dialog" aria-modal="true" aria-label="Harvest summary">
            <div className="panel-card harvest-panel" style={panelFrameStyle()}>
                <div className="panel-header">
                    <h2>Harvest</h2>
                </div>
                <div className="harvest-grid">
                    <div className="harvest-stat">
                        <span className="harvest-stat-icon" aria-hidden="true">💧</span>
                        <span className="harvest-stat-value">{wateredPlots}</span>
                        <span className="harvest-stat-label">plots watered</span>
                    </div>
                    <div className="harvest-stat">
                        <span className="harvest-stat-icon" aria-hidden="true">🌱</span>
                        <span className="harvest-stat-value">{answers}</span>
                        <span className="harvest-stat-label">answers</span>
                    </div>
                    <div className="harvest-stat">
                        <span className="harvest-stat-icon" aria-hidden="true">✿</span>
                        <span className="harvest-stat-value">{blooms}</span>
                        <span className="harvest-stat-label">new blooms</span>
                    </div>
                </div>
                {growthLine && <p className="harvest-growth">{growthLine}; on track.</p>}
                <div className="harvest-actions">
                    <button className="hud-ghost-button" onClick={onKeepTending}>
                        Keep tending
                    </button>
                    {/* The day's natural close is the primary action. */}
                    <button className="hud-ghost-button hud-cta-button" onClick={onDone}>
                        Done for today
                    </button>
                </div>
            </div>
        </div>
    );
}
