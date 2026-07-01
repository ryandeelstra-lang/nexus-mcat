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
    // charged_up premium scores surface — near-white field, dark ink, Inter. Layout: a full-width
    // Memory hero, a paired Performance/Readiness row, then a Coverage footer. Visual only; the engine
    // still owns every number and every abstention.
    .dash {
        min-height: 100%;
        max-width: 920px;
        margin: 0 auto;
        padding: 40px clamp(18px, 4vw, 44px) 56px;
        color: #1b1d2a;
        background: var(--canvas, #fbfbfd);
        box-sizing: border-box;
        font-family:
            Inter,
            system-ui,
            -apple-system,
            "Segoe UI",
            Roboto,
            sans-serif;
    }
    .dash-head h1 {
        margin: 0 0 6px;
        font-size: 28px;
        font-weight: 680;
        letter-spacing: -0.02em;
    }
    .sub {
        margin: 0 0 26px;
        color: rgba(27, 29, 42, 0.55);
        font-size: 14.5px;
        line-height: 1.5;
        max-width: 56ch;
    }
    // Calm centered empty-state panel (engine unavailable / loading) — intentional, never error-red.
    .notice {
        margin-top: 8px;
        padding: 40px 24px;
        text-align: center;
        color: rgba(27, 29, 42, 0.55);
        font-size: 15px;
        background: var(--canvas-elevated, #ffffff);
        border: 1px solid var(--border-subtle, rgba(27, 29, 42, 0.08));
        border-radius: 18px;
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.04),
            0 10px 30px rgba(27, 29, 42, 0.05);
    }
    .caveat {
        margin-bottom: 20px;
        padding: 12px 16px;
        border-radius: 12px;
        background: rgba(245, 158, 11, 0.1);
        border: 1px solid rgba(245, 158, 11, 0.45);
        color: #92580a;
        font-size: 14px;
    }
    .cards {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
    }
    // Memory is the hero — full width, larger.
    .memory {
        grid-column: 1 / -1;
    }
    @media (max-width: 680px) {
        .cards {
            grid-template-columns: 1fr;
        }
    }
    .card {
        position: relative;
        padding: 22px 24px;
        border-radius: 18px;
        background: var(--canvas-elevated, #ffffff);
        border: 1px solid var(--border-subtle, rgba(27, 29, 42, 0.07));
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.04),
            0 10px 30px rgba(27, 29, 42, 0.06);
        overflow: hidden;
    }
    // 4px left accent bar in the locked section hues — every surface speaks the graph's color language.
    .card::before {
        content: "";
        position: absolute;
        inset: 0 auto 0 0;
        width: 4px;
    }
    .memory::before {
        background: #3b82f6;
    }
    .performance::before {
        background: #94a3b8;
    }
    .readiness::before {
        background: #14b8a6;
    }
    .coverage {
        margin-top: 18px;
    }
    .coverage::before {
        background: #8b5cf6;
    }
    .card-kind {
        font-size: 11.5px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(27, 29, 42, 0.45);
        margin-bottom: 12px;
        font-weight: 600;
    }
    .big {
        font-size: 54px;
        font-weight: 720;
        line-height: 1;
        letter-spacing: -0.03em;
    }
    .pending,
    .locked {
        font-size: 18px;
        font-weight: 620;
        color: rgba(27, 29, 42, 0.82);
        margin-bottom: 6px;
    }
    .locked {
        color: #0f9488;
    }
    .range {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 14px 0 4px;
        max-width: 460px;
        font-size: 12px;
        color: rgba(27, 29, 42, 0.55);
    }
    .range-bar {
        position: relative;
        flex: 1;
        height: 8px;
        border-radius: 999px;
        background: rgba(27, 29, 42, 0.07);
    }
    .range-fill {
        position: absolute;
        top: 0;
        bottom: 0;
        background: linear-gradient(90deg, #60a5fa, #3b82f6);
        border-radius: 999px;
    }
    .chip {
        display: inline-block;
        margin-top: 12px;
        padding: 3px 11px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 550;
        background: rgba(20, 184, 166, 0.12);
        color: #0f9488;
    }
    .chip-warn {
        background: rgba(245, 158, 11, 0.14);
        color: #92580a;
    }
    .evidence {
        margin: 14px 0 0;
        font-size: 13.5px;
        line-height: 1.55;
        color: rgba(27, 29, 42, 0.62);
        max-width: 64ch;
    }
    .missing {
        margin: 6px 0 0;
        font-size: 12.5px;
        color: rgba(27, 29, 42, 0.45);
        max-width: 64ch;
    }
    .meter {
        margin-top: 14px;
        font-size: 12px;
        color: rgba(27, 29, 42, 0.55);
    }
    .meter-label {
        display: block;
        margin-bottom: 5px;
    }
    .meter-bar {
        height: 8px;
        border-radius: 999px;
        background: rgba(27, 29, 42, 0.07);
        overflow: hidden;
    }
    .meter-fill {
        height: 100%;
        background: linear-gradient(90deg, #2dd4bf, #14b8a6);
        border-radius: 999px;
    }
    .meter-val {
        display: block;
        margin-top: 5px;
        color: rgba(27, 29, 42, 0.45);
    }
    .cov-row {
        display: flex;
        gap: 36px;
        flex-wrap: wrap;
    }
    .cov-stat {
        flex: 1;
        min-width: 180px;
    }
    .cov-num {
        font-size: 28px;
        font-weight: 700;
        letter-spacing: -0.02em;
    }
    .cov-cap {
        font-size: 12px;
        color: rgba(27, 29, 42, 0.5);
        margin: 2px 0 10px;
    }
    .coverage .meter-fill {
        background: linear-gradient(90deg, #a78bfa, #8b5cf6);
    }
</style>
