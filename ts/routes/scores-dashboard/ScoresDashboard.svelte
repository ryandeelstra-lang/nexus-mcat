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
        <div class="kicker">Nexus · Test-day readiness</div>
        <h1>Your three honest scores</h1>
        <p class="sub">
            Two scores show a value with a confidence range; Readiness stays silent
            until you've earned it.
        </p>
    </header>

    {#if error}
        <div class="notice">{error}</div>
    {:else if !data}
        <div class="notice notice-loading">
            <span class="pulse" aria-hidden="true"></span>
            <span>Reading your collection…</span>
        </div>
    {:else if data.available === false}
        <div class="notice">{data.reason ?? "scores engine unavailable"}</div>
    {:else}
        {#if synthetic}
            <div class="caveat">
                <span class="caveat-mark" aria-hidden="true"></span>
                <span>
                    These scores are computed on <strong>synthetic</strong>
                    practice data — not a real readiness estimate.
                </span>
            </div>
        {/if}

        <div class="cards">
            <!-- MEMORY -->
            {#if data.memory}
                <section class="card memory">
                    <div class="card-kind">Memory</div>
                    <div class="hero-top">
                        <div class="big">{pct(data.memory.point)}</div>
                        <span
                            class="chip {data.memory.confidence === 'low'
                                ? 'chip-warn'
                                : ''}"
                        >
                            {data.memory.confidence === "low"
                                ? "low confidence"
                                : "calibrated"}
                        </span>
                    </div>
                    <div class="band">
                        <div
                            class="band-range"
                            style="left:{clamp01(data.memory.range[0]) *
                                100}%;right:{(1 - clamp01(data.memory.range[1])) *
                                100}%"
                        ></div>
                        <div
                            class="band-point"
                            style="left:{clamp01(data.memory.point) * 100}%"
                        ></div>
                    </div>
                    <div class="band-scale">
                        <span>0%</span>
                        <span class="band-caption">
                            Confidence range {pct(data.memory.range[0])}–{pct(
                                data.memory.range[1],
                            )}
                        </span>
                        <span>100%</span>
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
                        <div class="gates">
                            {#if data.readiness.graded_reviews_required}
                                <div class="gate">
                                    <div
                                        class="ring"
                                        style="--p:{clamp01(
                                            (data.readiness.graded_reviews ?? 0) /
                                                data.readiness.graded_reviews_required,
                                        ) * 100}"
                                    >
                                        <span class="ring-num">
                                            {data.readiness.graded_reviews ?? 0}
                                        </span>
                                    </div>
                                    <div class="gate-cap">
                                        of {data.readiness.graded_reviews_required} graded
                                        reviews
                                    </div>
                                </div>
                            {/if}
                            {#if data.readiness.coverage_required_pct}
                                <div class="gate">
                                    <div
                                        class="ring"
                                        style="--p:{clamp01(
                                            data.readiness.coverage_pct /
                                                data.readiness.coverage_required_pct,
                                        ) * 100}"
                                    >
                                        <span class="ring-num">
                                            {data.readiness.coverage_pct}%
                                        </span>
                                    </div>
                                    <div class="gate-cap">
                                        of {data.readiness.coverage_required_pct}%
                                        categories
                                    </div>
                                </div>
                            {/if}
                        </div>
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

        <p class="honesty">
            Nexus never fabricates a number. Every score — and every "not yet" — comes
            straight from the engine; Readiness stays silent until you've cleared the
            evidence floor.
        </p>
    {/if}
</div>

<style lang="scss">
    // charged_up premium scores surface — a near-white field, dark ink, Inter. Layout: a full-width
    // Memory hero (headline value + confidence band), a paired Performance/Readiness row (the readiness
    // floor shown as quiet progress rings), then a Coverage footer and an honesty footnote. Visual only;
    // the engine still owns every number and every abstention.
    $ink: #1b1d2a;
    $blue: #3b82f6;
    $teal: #14b8a6;
    $amber: #f59e0b;
    $purple: #8b5cf6;
    $slate: #94a3b8;

    .dash {
        min-height: 100%;
        max-width: 920px;
        margin: 0 auto;
        padding: 48px clamp(18px, 4vw, 44px) 64px;
        color: $ink;
        background: var(--canvas, #fbfbfd);
        box-sizing: border-box;
        font-family:
            Inter,
            system-ui,
            -apple-system,
            "Segoe UI",
            Roboto,
            sans-serif;
        -webkit-font-smoothing: antialiased;
    }

    // ── Header ───────────────────────────────────────────────────────────────
    .dash-head {
        margin-bottom: 34px;
    }
    .kicker {
        margin-bottom: 12px;
        font-size: 11px;
        font-weight: 640;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: rgba($ink, 0.42);
    }
    .dash-head h1 {
        margin: 0 0 8px;
        font-size: 30px;
        font-weight: 680;
        letter-spacing: -0.025em;
        line-height: 1.1;
    }
    .sub {
        margin: 0;
        max-width: 56ch;
        color: rgba($ink, 0.55);
        font-size: 15px;
        line-height: 1.55;
    }

    // ── Calm notices (loading / unavailable) — intentional panels, never error-red ──
    .notice {
        position: relative;
        margin-top: 8px;
        padding: 48px 28px;
        text-align: center;
        color: rgba($ink, 0.5);
        font-size: 15px;
        background:
            radial-gradient(120% 140% at 50% 0%, rgba($ink, 0.015), transparent 60%),
            var(--canvas-elevated, #ffffff);
        border: 1px solid rgba($ink, 0.07);
        border-radius: 20px;
        box-shadow:
            0 1px 2px rgba($ink, 0.03),
            0 12px 34px -8px rgba($ink, 0.06);
    }
    .notice-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
    }
    .pulse {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: $blue;
        box-shadow: 0 0 0 0 rgba($blue, 0.4);
    }

    // ── Synthetic-data banner — calm amber "heads up", not an error ──
    .caveat {
        display: flex;
        align-items: flex-start;
        gap: 11px;
        margin-bottom: 22px;
        padding: 13px 16px;
        border-radius: 14px;
        background: rgba($amber, 0.08);
        border: 1px solid rgba($amber, 0.28);
        color: #8a5206;
        font-size: 13.5px;
        line-height: 1.5;

        strong {
            font-weight: 680;
        }
    }
    .caveat-mark {
        flex: none;
        margin-top: 4px;
        width: 8px;
        height: 8px;
        border-radius: 2px;
        background: $amber;
        box-shadow: 0 0 0 3px rgba($amber, 0.16);
    }

    // ── Card grid: Memory hero, then a paired row ──
    .cards {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
    }
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
        padding: 26px 28px;
        border-radius: 20px;
        background: var(--canvas-elevated, #ffffff);
        border: 1px solid rgba($ink, 0.06);
        box-shadow:
            0 1px 2px rgba($ink, 0.03),
            0 10px 26px -6px rgba($ink, 0.05),
            0 30px 60px -24px rgba($ink, 0.07);
        overflow: hidden;
    }
    // Soft hue wash in the top-right corner — each surface quietly speaks its section color,
    // replacing the old hard accent bar.
    .card::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(
            130% 120% at 100% 0%,
            var(--glow, transparent),
            transparent 58%
        );
    }
    .memory {
        --glow: rgba($blue, 0.1);
    }
    .performance {
        --glow: rgba($slate, 0.12);
    }
    .readiness {
        --glow: rgba($teal, 0.1);
    }
    .coverage {
        --glow: rgba($purple, 0.1);
        margin-top: 18px;
    }

    .card-kind {
        margin-bottom: 16px;
        font-size: 11px;
        font-weight: 640;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: rgba($ink, 0.45);
    }
    .memory .card-kind {
        color: #2563eb;
    }
    .performance .card-kind {
        color: #64748b;
    }
    .readiness .card-kind {
        color: #0d9488;
    }
    .coverage .card-kind {
        color: #7c3aed;
    }

    // ── Memory hero ──
    .hero-top {
        display: flex;
        align-items: center;
        gap: 16px;
    }
    .big {
        font-size: 60px;
        font-weight: 700;
        line-height: 0.95;
        letter-spacing: -0.035em;
        font-variant-numeric: tabular-nums;
    }
    // Confidence band: a subtle full-scale track, a saturated gradient segment for the range,
    // and a haloed point marker for the headline estimate.
    .band {
        position: relative;
        height: 12px;
        margin: 22px 0 10px;
        border-radius: 999px;
        background: rgba($ink, 0.06);
        box-shadow: inset 0 0 0 1px rgba($ink, 0.02);
    }
    .band-range {
        position: absolute;
        top: 0;
        bottom: 0;
        border-radius: 999px;
        background: linear-gradient(90deg, rgba($blue, 0.45), rgba($blue, 0.85));
    }
    .band-point {
        position: absolute;
        top: 50%;
        width: 15px;
        height: 15px;
        border-radius: 50%;
        background: #ffffff;
        border: 3px solid $blue;
        transform: translate(-50%, -50%);
        box-shadow:
            0 1px 4px rgba($ink, 0.22),
            0 0 0 4px rgba($blue, 0.1);
    }
    .band-scale {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        font-size: 11.5px;
        color: rgba($ink, 0.4);
        font-variant-numeric: tabular-nums;
    }
    .band-caption {
        color: rgba($ink, 0.55);
        font-weight: 550;
    }

    .chip {
        display: inline-flex;
        align-items: center;
        padding: 4px 12px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 560;
        background: rgba($blue, 0.1);
        color: #2563eb;
        border: 1px solid rgba($blue, 0.18);
    }
    .chip-warn {
        background: rgba($amber, 0.12);
        color: #b45309;
        border-color: rgba($amber, 0.3);
    }

    // ── Pending / locked states ──
    .pending,
    .locked {
        margin-bottom: 6px;
        font-size: 18px;
        font-weight: 640;
        letter-spacing: -0.01em;
        color: rgba($ink, 0.8);
    }
    .locked {
        color: #0d9488;
    }

    .evidence {
        margin: 12px 0 0;
        max-width: 62ch;
        font-size: 13.5px;
        line-height: 1.6;
        color: rgba($ink, 0.6);
    }
    .missing {
        margin: 8px 0 0;
        max-width: 62ch;
        font-size: 12.5px;
        line-height: 1.55;
        color: rgba($ink, 0.42);
    }

    // ── Readiness floor rings (progress toward the give-up floor, drawn with conic-gradient) ──
    .gates {
        display: flex;
        flex-wrap: wrap;
        gap: 24px;
        margin-top: 20px;
    }
    .gate {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        width: 104px;
    }
    .ring {
        position: relative;
        display: grid;
        place-items: center;
        width: 96px;
        height: 96px;
        border-radius: 50%;
        background: conic-gradient(
            from -90deg,
            #5eead4 0deg,
            $teal calc(var(--p, 0) * 3.6deg),
            rgba($ink, 0.07) calc(var(--p, 0) * 3.6deg)
        );
    }
    .ring::before {
        content: "";
        position: absolute;
        inset: 9px;
        border-radius: 50%;
        background: var(--canvas-elevated, #ffffff);
        box-shadow: inset 0 0 0 1px rgba($ink, 0.03);
    }
    .ring-num {
        position: relative;
        z-index: 1;
        font-size: 22px;
        font-weight: 680;
        letter-spacing: -0.02em;
        color: rgba($ink, 0.82);
        font-variant-numeric: tabular-nums;
    }
    .gate-cap {
        text-align: center;
        font-size: 11.5px;
        line-height: 1.4;
        color: rgba($ink, 0.5);
        font-variant-numeric: tabular-nums;
    }

    // ── Coverage footer ──
    .cov-row {
        display: flex;
        gap: 40px;
        flex-wrap: wrap;
    }
    .cov-stat {
        flex: 1;
        min-width: 180px;
    }
    .cov-num {
        font-size: 30px;
        font-weight: 700;
        letter-spacing: -0.025em;
        font-variant-numeric: tabular-nums;
    }
    .cov-cap {
        margin: 4px 0 12px;
        font-size: 12px;
        line-height: 1.45;
        color: rgba($ink, 0.5);
    }
    .meter-bar {
        height: 8px;
        border-radius: 999px;
        background: rgba($ink, 0.06);
        overflow: hidden;
    }
    .meter-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #a78bfa, $purple);
    }

    // ── Honesty footnote — quiet "fine print" that earns trust ──
    .honesty {
        margin: 30px 0 0;
        padding-top: 20px;
        max-width: 68ch;
        border-top: 1px solid rgba($ink, 0.06);
        font-size: 12.5px;
        line-height: 1.6;
        color: rgba($ink, 0.4);
    }

    // ── Meaning-bearing motion only, and only when the viewer allows it ──
    @media (prefers-reduced-motion: no-preference) {
        .dash-head,
        .caveat,
        .card,
        .honesty {
            opacity: 0;
            animation: fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .dash-head {
            animation-delay: 0.02s;
        }
        .caveat {
            animation-delay: 0.06s;
        }
        .memory {
            animation-delay: 0.1s;
        }
        .performance {
            animation-delay: 0.15s;
        }
        .readiness {
            animation-delay: 0.2s;
        }
        .coverage {
            animation-delay: 0.25s;
        }
        .honesty {
            animation-delay: 0.3s;
        }
        .pulse {
            animation: pulse 1.6s ease-in-out infinite;
        }
    }

    @keyframes fade-up {
        from {
            opacity: 0;
            transform: translateY(9px);
        }
        to {
            opacity: 1;
            transform: none;
        }
    }
    @keyframes pulse {
        0% {
            opacity: 1;
            box-shadow: 0 0 0 0 rgba($blue, 0.4);
        }
        70% {
            opacity: 0.65;
            box-shadow: 0 0 0 9px rgba($blue, 0);
        }
        100% {
            opacity: 1;
            box-shadow: 0 0 0 0 rgba($blue, 0);
        }
    }
</style>
