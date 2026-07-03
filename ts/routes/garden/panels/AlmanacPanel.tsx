// charged_up: almanac panel (doc 23 §6.6) — formats engine values only, never computes scores.
import React, { useState } from "react";

import {
    asCoverage,
    asMetric,
    asNumber,
    asRange,
    asString,
    extractReviewCount,
    hasSyntheticCaveat,
} from "./dashboard";
import type { DashboardData, DashboardMetric } from "./rpc";

interface AlmanacPanelProps {
    dashboard: DashboardData | null;
    onRefresh: () => Promise<void>;
    onClose: () => void;
}

function metricSummary(metric: DashboardMetric | null): React.ReactElement {
    if (!metric) {
        return <p className="almanac-empty">No score payload yet.</p>;
    }
    if (metric.available === false) {
        return <p className="almanac-empty">{asString(metric.reason) ?? "Still growing."}</p>;
    }
    const value = asNumber(metric.value);
    const range = asRange(metric.range);
    const confidence = asString(metric.confidence);
    return (
        <div className="almanac-metric-body">
            {value !== null && <p className="almanac-value">{value.toFixed(2)}</p>}
            {range && (
                <p className="almanac-range">
                    Range {range[0].toFixed(2)} - {range[1].toFixed(2)}
                </p>
            )}
            {confidence && <p className="almanac-confidence">Confidence: {confidence}</p>}
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
        <div className="garden-overlay almanac-overlay" role="dialog" aria-label="Almanac">
            <div className="panel-card almanac-panel">
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
                                    {asString(readiness?.reason) && <p>{asString(readiness?.reason)}</p>}
                                </div>
                            )
                            : metricSummary(readiness)}
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
                            : (
                                <p>None listed in this payload.</p>
                            )}
                    </details>
                </section>
            </div>
        </div>
    );
}
