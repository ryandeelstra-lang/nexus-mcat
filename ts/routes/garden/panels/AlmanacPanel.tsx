// charged_up: almanac panel (doc 23 §6.6) — formats engine values only, never computes scores.
import React, { useState } from "react";

import {
    asCoverage,
    asMetric,
    asNumber,
    asPoint,
    asRange,
    asString,
    extractReviewCount,
    hasSyntheticCaveat,
} from "./dashboard";
import { panelFrameStyle } from "./KeeperDialogue";
import type { DashboardData, DashboardMetric } from "./rpc";

interface AlmanacPanelProps {
    dashboard: DashboardData | null;
    onRefresh: () => Promise<void>;
    onClose: () => void;
}

/** Engine abstain-reasons are honest but written for builders ("built in Block G").
 * Translate the known ones into garden voice; anything unrecognized passes through
 * verbatim so honesty is never edited away. */
function playerReason(reason: string | null): string | null {
    if (!reason) {
        return null;
    }
    if (/Block [A-Z]/.test(reason)) {
        return "The Keeper is still gathering enough of your work to say — check back after more tending.";
    }
    return reason;
}

function metricSummary(metric: DashboardMetric | null, digits = 2): React.ReactElement {
    if (!metric) {
        return <p className="almanac-empty">No score payload yet.</p>;
    }
    if (metric.available === false) {
        return <p className="almanac-empty">{playerReason(asString(metric.reason)) ?? "Still growing."}</p>;
    }
    const value = asPoint(metric);
    const range = asRange(metric.range);
    const confidence = asString(metric.confidence);
    const note = asString(metric["note"] ?? null);
    return (
        <div className="almanac-metric-body">
            {value !== null && <p className="almanac-value">{value.toFixed(digits)}</p>}
            {range && (
                <p className="almanac-range">
                    Range {range[0].toFixed(digits)} - {range[1].toFixed(digits)}
                </p>
            )}
            {confidence && <p className="almanac-confidence">Confidence: {confidence}</p>}
            {/* The honesty stamp (e.g. "mapping UNVALIDATED against real outcomes") rides along with
             * the score. Styled inline so it needs no new rule in the live session's garden.css. */}
            {note && <p className="almanac-note" style={{ fontSize: 12, fontStyle: "italic", opacity: 0.85, margin: "4px 0" }}>{note}</p>}
            {value === null && !range && <p className="almanac-empty">Value is not available yet.</p>}
        </div>
    );
}

export function AlmanacPanel(props: AlmanacPanelProps): React.ReactElement {
    const { dashboard, onRefresh, onClose } = props;
    const [refreshing, setRefreshing] = useState(false);
    const memory = asMetric(dashboard?.memory ?? null);
    const performance = asMetric(dashboard?.performance ?? null);
    const readiness = asMetric(dashboard?.readiness ?? null);
    const coverage = asCoverage(dashboard?.coverage ?? null);
    const coveredGate = asNumber(coverage?.gate_covered) ?? 0;
    const gateTotal = asNumber(coverage?.gate_total) ?? 31;
    const coveredDisplay = asNumber(coverage?.display_covered) ?? coveredGate;
    const displayTotal = asNumber(coverage?.display_total) ?? 34;
    const uncovered = Array.isArray(coverage?.uncovered_content_categories)
        ? coverage.uncovered_content_categories.filter((entry): entry is string => typeof entry === "string")
        : [];
    const reviews = extractReviewCount(dashboard);
    const synthetic = hasSyntheticCaveat(dashboard);
    const readinessAbstains = !readiness || readiness.available === false;

    async function handleRefresh(): Promise<void> {
        setRefreshing(true);
        try {
            await onRefresh();
        } finally {
            setRefreshing(false);
        }
    }

    return (
        <div className="garden-overlay almanac-overlay" role="dialog" aria-modal="true" aria-label="Almanac">
            <div className="panel-card almanac-panel" style={panelFrameStyle()}>
                <div className="panel-header">
                    <h2>Almanac</h2>
                    <div className="panel-actions">
                        <button className="hud-ghost-button" onClick={() => void handleRefresh()}>
                            {refreshing ? "Refreshing..." : "Refresh"}
                        </button>
                        <button className="keeper-close" onClick={onClose} aria-label="Close">
                            ✕
                        </button>
                    </div>
                </div>

                {synthetic && (
                    <div className="almanac-banner" role="note">
                        Synthetic training data caveat present; read values as provisional.
                    </div>
                )}

                <div className="almanac-grid">
                    <section className="almanac-card">
                        <h3>Memory</h3>
                        {metricSummary(memory)}
                    </section>
                    <section className="almanac-card">
                        <h3>Performance</h3>
                        {metricSummary(performance)}
                    </section>
                    <section className="almanac-card">
                        <h3>Readiness</h3>
                        {readinessAbstains
                            ? (
                                <div className="almanac-readiness-abstain">
                                    <p className="almanac-empty">
                                        Barn is still growing - here is what is left.
                                    </p>
                                    <p>
                                        Gate coverage: {coveredGate} / {gateTotal} categories
                                    </p>
                                    {reviews !== null && <p>Reviews: {reviews} / 1000</p>}
                                    {playerReason(asString(readiness?.reason)) && (
                                        <p>{playerReason(asString(readiness?.reason))}</p>
                                    )}
                                </div>
                            )
                            : metricSummary(readiness, 0) /* 472-528 is an integer scale */}
                    </section>
                </div>

                <section className="almanac-coverage">
                    <h3>Coverage</h3>
                    <p>
                        {coveredDisplay} / {displayTotal} stretches of path filled
                    </p>
                    <details>
                        <summary>Stretches of path still bare ({uncovered.length})</summary>
                        {uncovered.length > 0
                            ? (
                                <ul>
                                    {uncovered.map((entry) => <li key={entry}>{entry}</li>)}
                                </ul>
                            )
                            : <p>None listed in this payload.</p>}
                    </details>
                </section>
            </div>
        </div>
    );
}
