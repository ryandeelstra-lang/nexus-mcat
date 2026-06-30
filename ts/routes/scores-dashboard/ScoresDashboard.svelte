<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<!--
charged_up: the three honest scores. Every number (and every abstention) comes verbatim from the
Python scores engine via /_anki/scoresDashboard — this component renders, it never decides when to
show a score. Readiness shows a real point only once the engine clears the give-up floor; until then
it shows the structured "prove this topic" abstention, never a fabricated number.
-->
<script lang="ts">
    import { onMount } from "svelte";

    type Provenance = "real" | "synthetic";

    interface MemoryScore {
        available: boolean;
        point: number;
        range: [number, number];
        confidence: string;
        evidence: string;
        missing_data: string | null;
        data_provenance: Provenance;
    }
    interface PerformanceScore {
        available: boolean;
        reason: string;
        data_provenance: Provenance;
    }
    interface ReadinessScore {
        available: boolean;
        reason?: string;
        point?: number | null;
        note?: string;
        graded_reviews?: number;
        graded_reviews_required?: number;
        coverage_pct: number;
        coverage_required_pct?: number;
        best_next?: string | null;
        data_provenance: Provenance;
        synthetic_caveat?: string | null;
    }
    interface Coverage {
        gate_covered: number;
        gate_total: number;
        gate_fraction: number;
        display_covered: number;
        display_total: number;
        display_fraction: number;
        uncovered_content_categories: string[];
    }
    interface Dashboard {
        memory?: MemoryScore;
        performance?: PerformanceScore;
        readiness?: ReadinessScore;
        coverage?: Coverage;
        available?: boolean;
        reason?: string;
    }

    let data: Dashboard | null = null;
    let error: string | null = null;

    const pct = (x: number): string => `${Math.round(x * 100)}%`;
    const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

    onMount(async () => {
        try {
            const resp = await fetch("/_anki/scoresDashboard", {
                method: "POST",
                headers: { "Content-Type": "application/binary" },
                body: "",
            });
            if (!resp.ok) {
                error = `scores unavailable (${resp.status})`;
                return;
            }
            data = (await resp.json()) as Dashboard;
        } catch {
            error =
                "could not reach the scores engine — open a collection and try again";
        }
    });

    $: provenance =
        data?.memory?.data_provenance ?? data?.readiness?.data_provenance ?? null;
    $: synthetic = provenance === "synthetic";
</script>

<div class="dash">
    <header class="dash-head">
        <h1>Your three honest scores</h1>
        <p class="sub">
            Two scores show a value with a confidence range; Readiness stays silent
            until you've earned it.
        </p>
    </header>

    {#if error}
        <div class="notice">{error}</div>
    {:else if !data}
        <div class="notice">Reading your collection…</div>
    {:else if data.available === false}
        <div class="notice">{data.reason ?? "scores engine unavailable"}</div>
    {:else}
        {#if synthetic}
            <div class="caveat">
                ⚠ These scores are computed on <strong>synthetic</strong>
                 practice data — not a real readiness estimate.
            </div>
        {/if}

        <div class="cards">
            <!-- MEMORY -->
            {#if data.memory}
                <section class="card memory">
                    <div class="card-kind">Memory</div>
                    <div class="big">{pct(data.memory.point)}</div>
                    <div class="range">
                        <span>range</span>
                        <div class="range-bar">
                            <div
                                class="range-fill"
                                style="left:{clamp01(data.memory.range[0]) *
                                    100}%;right:{(1 - clamp01(data.memory.range[1])) *
                                    100}%"
                            ></div>
                        </div>
                        <span>
                            {pct(data.memory.range[0])}–{pct(data.memory.range[1])}
                        </span>
                    </div>
                    <div
                        class="chip {data.memory.confidence === 'low'
                            ? 'chip-warn'
                            : ''}"
                    >
                        {data.memory.confidence === "low"
                            ? "low confidence"
                            : "calibrated"}
                    </div>
                    <p class="evidence">{data.memory.evidence}</p>
                    {#if data.memory.missing_data}
                        <p class="missing">
                            Why the band is wide: {data.memory.missing_data}
                        </p>
                    {/if}
                </section>
            {/if}

            <!-- PERFORMANCE -->
            {#if data.performance}
                <section class="card performance">
                    <div class="card-kind">Performance</div>
                    <div class="pending">Not yet available</div>
                    <p class="evidence">{data.performance.reason}</p>
                </section>
            {/if}

            <!-- READINESS -->
            {#if data.readiness}
                <section class="card readiness">
                    <div class="card-kind">Readiness</div>
                    {#if data.readiness.available}
                        <div class="pending">On its way</div>
                        <p class="evidence">
                            {data.readiness.note ?? "readiness mapping pending"}
                        </p>
                    {:else}
                        <div class="locked">
                            Prove this topic to unlock your trajectory
                        </div>
                        <p class="evidence">{data.readiness.reason}</p>
                        {#if data.readiness.graded_reviews_required}
                            <div class="meter">
                                <span class="meter-label">graded reviews</span>
                                <div class="meter-bar">
                                    <div
                                        class="meter-fill"
                                        style="width:{clamp01(
                                            (data.readiness.graded_reviews ?? 0) /
                                                data.readiness.graded_reviews_required,
                                        ) * 100}%"
                                    ></div>
                                </div>
                                <span class="meter-val">
                                    {data.readiness.graded_reviews ?? 0} / {data
                                        .readiness.graded_reviews_required}
                                </span>
                            </div>
                        {/if}
                        {#if data.readiness.coverage_required_pct}
                            <div class="meter">
                                <span class="meter-label">category coverage</span>
                                <div class="meter-bar">
                                    <div
                                        class="meter-fill"
                                        style="width:{clamp01(
                                            data.readiness.coverage_pct /
                                                data.readiness.coverage_required_pct,
                                        ) * 100}%"
                                    ></div>
                                </div>
                                <span class="meter-val">
                                    {data.readiness.coverage_pct}% / {data.readiness
                                        .coverage_required_pct}%
                                </span>
                            </div>
                        {/if}
                    {/if}
                </section>
            {/if}
        </div>

        <!-- COVERAGE MAP -->
        {#if data.coverage}
            <section class="card coverage">
                <div class="card-kind">Coverage</div>
                <div class="cov-row">
                    <div class="cov-stat">
                        <div class="cov-num">
                            {data.coverage.gate_covered} / {data.coverage.gate_total}
                        </div>
                        <div class="cov-cap">
                            content categories with cards (readiness gate)
                        </div>
                        <div class="meter-bar">
                            <div
                                class="meter-fill"
                                style="width:{clamp01(data.coverage.gate_fraction) *
                                    100}%"
                            ></div>
                        </div>
                    </div>
                    <div class="cov-stat">
                        <div class="cov-num">
                            {data.coverage.display_covered} / {data.coverage
                                .display_total}
                        </div>
                        <div class="cov-cap">all leaves (display)</div>
                        <div class="meter-bar">
                            <div
                                class="meter-fill"
                                style="width:{clamp01(data.coverage.display_fraction) *
                                    100}%"
                            ></div>
                        </div>
                    </div>
                </div>
            </section>
        {/if}
    {/if}
</div>

<style lang="scss">
    .dash {
        min-height: 100%;
        padding: 28px clamp(16px, 4vw, 48px);
        color: rgba(255, 255, 255, 0.92);
        background: radial-gradient(circle at 50% -10%, #161a23 0%, #0c0e14 60%);
        box-sizing: border-box;
    }
    .dash-head h1 {
        margin: 0 0 4px;
        font-size: 22px;
        font-weight: 650;
    }
    .sub {
        margin: 0 0 22px;
        color: rgba(255, 255, 255, 0.55);
        font-size: 14px;
    }
    .notice {
        padding: 40px 0;
        color: rgba(255, 255, 255, 0.6);
    }
    .caveat {
        margin-bottom: 18px;
        padding: 10px 14px;
        border-radius: 10px;
        background: rgba(245, 166, 35, 0.14);
        border: 1px solid rgba(245, 166, 35, 0.4);
        color: #f5c97a;
        font-size: 14px;
    }
    .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 16px;
    }
    .card {
        position: relative;
        padding: 18px 20px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        overflow: hidden;
    }
    .card::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 3px;
    }
    .memory::before {
        background: #5b8cff;
    }
    .performance::before {
        background: #8a8f98;
    }
    .readiness::before {
        background: #34d39e;
    }
    .coverage {
        margin-top: 16px;
    }
    .coverage::before {
        background: #b07bff;
    }
    .card-kind {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.5);
        margin-bottom: 10px;
    }
    .big {
        font-size: 44px;
        font-weight: 700;
        line-height: 1;
    }
    .pending,
    .locked {
        font-size: 18px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.85);
        margin-bottom: 6px;
    }
    .locked {
        color: #9ad9c0;
    }
    .range {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.55);
    }
    .range-bar {
        position: relative;
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.1);
    }
    .range-fill {
        position: absolute;
        top: 0;
        bottom: 0;
        background: #5b8cff;
        border-radius: 3px;
    }
    .chip {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 12px;
        background: rgba(52, 211, 158, 0.16);
        color: #6fe0b8;
    }
    .chip-warn {
        background: rgba(245, 166, 35, 0.16);
        color: #f5c97a;
    }
    .evidence {
        margin: 10px 0 0;
        font-size: 13px;
        line-height: 1.5;
        color: rgba(255, 255, 255, 0.62);
    }
    .missing {
        margin: 6px 0 0;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.45);
    }
    .meter {
        margin-top: 12px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.55);
    }
    .meter-label {
        display: block;
        margin-bottom: 4px;
    }
    .meter-bar {
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.1);
        overflow: hidden;
    }
    .meter-fill {
        height: 100%;
        background: #34d39e;
        border-radius: 3px;
    }
    .meter-val {
        display: block;
        margin-top: 4px;
        color: rgba(255, 255, 255, 0.45);
    }
    .cov-row {
        display: flex;
        gap: 28px;
        flex-wrap: wrap;
    }
    .cov-stat {
        flex: 1;
        min-width: 180px;
    }
    .cov-num {
        font-size: 26px;
        font-weight: 700;
    }
    .cov-cap {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        margin: 2px 0 8px;
    }
</style>
