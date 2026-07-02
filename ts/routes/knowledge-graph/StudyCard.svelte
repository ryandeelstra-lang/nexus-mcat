<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<!--
charged_up: the study surface. A premium card panel that floats IN FRONT of the dim graph backdrop
and runs the REAL review loop against the engine — getQueuedCards -> renderExistingCard -> reveal ->
answerCard -> next. The card's own HTML is shown in a sandboxed iframe (see card-render.ts) so
untrusted card markup can never reach this api-access page's RPC surface. This is the "cards are
home, graph is the calm backdrop" model: the graph sets the scene, the card is where the work
happens.
-->
<script lang="ts">
    import { CardAnswer_Rating } from "@generated/anki/scheduler_pb";
    import type { QueuedCards_QueuedCard } from "@generated/anki/scheduler_pb";
    import { answerCard, getQueuedCards, renderExistingCard } from "@generated/backend";
    import { onMount } from "svelte";

    import { buildCardSrcdoc, nodesToHtml } from "./card-render";

    type Phase = "loading" | "question" | "answer" | "empty" | "nocol";

    let phase: Phase = "loading";
    let queued: QueuedCards_QueuedCard | null = null;
    let counts = { new: 0, learning: 0, review: 0 };
    let css = "";
    let qHtml = "";
    let aHtml = "";
    let shownAt = 0; // for milliseconds_taken

    // The iframe body switches from question to answer; the note-type CSS rides along both ways.
    $: srcdoc = buildCardSrcdoc(css, phase === "answer" ? aHtml : qHtml);

    async function loadNext(): Promise<void> {
        phase = "loading";
        try {
            const resp = await getQueuedCards(
                { fetchLimit: 1, intradayLearningOnly: false },
                { alertOnError: false },
            );
            counts = {
                new: resp.newCount,
                learning: resp.learningCount,
                review: resp.reviewCount,
            };
            if (resp.cards.length === 0) {
                phase = "empty"; // caught up — nothing due
                queued = null;
                return;
            }
            queued = resp.cards[0];
            const rendered = await renderExistingCard(
                { cardId: queued.card!.id, browser: false, partialRender: false },
                { alertOnError: false },
            );
            css = rendered.css;
            qHtml = nodesToHtml(rendered.questionNodes);
            aHtml = nodesToHtml(rendered.answerNodes);
            shownAt = Date.now();
            phase = "question";
        } catch {
            // No open collection (or the backend is unreachable) — stay honest, never fake a card.
            phase = "nocol";
            queued = null;
        }
    }

    function reveal(): void {
        if (phase === "question") {
            phase = "answer";
        }
    }

    async function grade(rating: CardAnswer_Rating): Promise<void> {
        if (phase !== "answer" || !queued?.card || !queued.states?.current) {
            return;
        }
        const states = queued.states;
        const newState = {
            [CardAnswer_Rating.AGAIN]: states.again,
            [CardAnswer_Rating.HARD]: states.hard,
            [CardAnswer_Rating.GOOD]: states.good,
            [CardAnswer_Rating.EASY]: states.easy,
        }[rating];
        if (!newState) {
            return;
        }
        try {
            await answerCard(
                {
                    cardId: queued.card.id,
                    currentState: states.current,
                    newState,
                    rating,
                    answeredAtMillis: BigInt(Date.now()),
                    millisecondsTaken: Math.min(Date.now() - shownAt, 60_000),
                },
                { alertOnError: false },
            );
        } catch {
            // If the write fails we still advance rather than trapping the user on a dead card.
        }
        await loadNext();
    }

    function backToMap(): void {
        if (typeof window !== "undefined") {
            window.location.search = "";
        }
    }

    function onKeydown(e: KeyboardEvent): void {
        if (e.key === " " || e.key === "Enter") {
            if (phase === "question") {
                e.preventDefault();
                reveal();
            }
        } else if (phase === "answer") {
            const map: Record<string, CardAnswer_Rating> = {
                "1": CardAnswer_Rating.AGAIN,
                "2": CardAnswer_Rating.HARD,
                "3": CardAnswer_Rating.GOOD,
                "4": CardAnswer_Rating.EASY,
            };
            if (e.key in map) {
                e.preventDefault();
                void grade(map[e.key]);
            }
        }
    }

    onMount(loadNext);
</script>

<svelte:window on:keydown={onKeydown} />

<div class="study-stage">
    <button class="study-back" on:click={backToMap}>
        <span class="study-back-arrow" aria-hidden="true">←</span>
         Map
    </button>

    <div class="study-panel">
        {#if phase === "loading"}
            <div class="study-msg">
                <div class="study-spinner" aria-hidden="true"></div>
                <p>Loading your next card…</p>
            </div>
        {:else if phase === "nocol"}
            <div class="study-msg">
                <div class="study-glyph glyph-node" aria-hidden="true"></div>
                <strong>Open your MCAT deck to start studying.</strong>
                <p>Your cards appear here, in front of the map.</p>
            </div>
        {:else if phase === "empty"}
            <div class="study-msg">
                <div class="study-glyph glyph-done" aria-hidden="true"></div>
                <strong>You're all caught up.</strong>
                <p>Nothing is due right now — the map holds your progress.</p>
                <button class="study-primary" on:click={backToMap}>
                    Back to the map
                </button>
            </div>
        {:else}
            <header class="session-strip">
                <div class="session-legend">
                    <span class="legend">
                        <i class="dot dot-new" aria-hidden="true"></i>
                        <span class="num">{counts.new}</span>
                        <span class="legend-label">new</span>
                    </span>
                    <span class="legend">
                        <i class="dot dot-learn" aria-hidden="true"></i>
                        <span class="num">{counts.learning}</span>
                        <span class="legend-label">learning</span>
                    </span>
                    <span class="legend">
                        <i class="dot dot-review" aria-hidden="true"></i>
                        <span class="num">{counts.review}</span>
                        <span class="legend-label">review</span>
                    </span>
                </div>
                <div class="session-track" aria-hidden="true">
                    {#if counts.new > 0}
                        <span class="seg seg-new" style="flex: {counts.new}"></span>
                    {/if}
                    {#if counts.learning > 0}
                        <span
                            class="seg seg-learn"
                            style="flex: {counts.learning}"
                        ></span>
                    {/if}
                    {#if counts.review > 0}
                        <span
                            class="seg seg-review"
                            style="flex: {counts.review}"
                        ></span>
                    {/if}
                </div>
            </header>

            <div class="study-card-frame">
                <iframe
                    title="card"
                    class="study-iframe"
                    sandbox="allow-scripts"
                    {srcdoc}
                ></iframe>
            </div>

            <div class="study-actions">
                {#if phase === "question"}
                    <button class="study-primary" on:click={reveal}>
                        Show answer <kbd>Space</kbd>
                    </button>
                {:else}
                    <div class="study-grades">
                        <button
                            class="grade grade-again"
                            on:click={() => grade(CardAnswer_Rating.AGAIN)}
                        >
                            <span class="grade-label">Again</span>
                            <kbd>1</kbd>
                        </button>
                        <button
                            class="grade grade-hard"
                            on:click={() => grade(CardAnswer_Rating.HARD)}
                        >
                            <span class="grade-label">Hard</span>
                            <kbd>2</kbd>
                        </button>
                        <button
                            class="grade grade-good"
                            on:click={() => grade(CardAnswer_Rating.GOOD)}
                        >
                            <span class="grade-label">Good</span>
                            <kbd>3</kbd>
                        </button>
                        <button
                            class="grade grade-easy"
                            on:click={() => grade(CardAnswer_Rating.EASY)}
                        >
                            <span class="grade-label">Easy</span>
                            <kbd>4</kbd>
                        </button>
                    </div>
                {/if}
            </div>
        {/if}
    </div>
</div>

<style lang="scss">
    .study-stage {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family:
            Inter,
            system-ui,
            -apple-system,
            "Segoe UI",
            Roboto,
            sans-serif;
        color: #1b1d2a;
        // A soft scrim so the card pops without hiding the map behind it.
        background: radial-gradient(
            120% 90% at 50% 40%,
            rgba(251, 251, 253, 0.28),
            rgba(251, 251, 253, 0.7)
        );
    }

    .study-back {
        position: absolute;
        top: 18px;
        left: 18px;
        z-index: 2;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        appearance: none;
        border: 1px solid rgba(27, 29, 42, 0.05);
        border-radius: 999px;
        padding: 7px 15px 7px 13px;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.01em;
        color: rgba(27, 29, 42, 0.66);
        background: rgba(255, 255, 255, 0.82);
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.06),
            0 10px 26px rgba(27, 29, 42, 0.1);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        cursor: pointer;
        transition:
            color 0.15s ease,
            background 0.15s ease,
            transform 0.15s ease;
    }
    .study-back:hover {
        color: #1b1d2a;
        background: rgba(255, 255, 255, 0.95);
        transform: translateY(-1px);
    }
    .study-back:active {
        transform: translateY(0);
    }
    .study-back-arrow {
        font-size: 14px;
        line-height: 1;
        transition: transform 0.15s ease;
    }
    .study-back:hover .study-back-arrow {
        transform: translateX(-2px);
    }

    // The floating card — premium frosted panel over the dim map.
    .study-panel {
        position: relative;
        width: min(680px, 90vw);
        min-height: 320px;
        display: flex;
        flex-direction: column;
        gap: 22px;
        padding: 26px 30px 24px;
        border-radius: 24px;
        // Kept >= 0.9 opaque + heavy blur so card text stays legible over the live backdrop.
        background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.94),
            rgba(255, 255, 255, 0.9)
        );
        border: 1px solid rgba(27, 29, 42, 0.07);
        box-shadow:
            0 1px 1px rgba(27, 29, 42, 0.04),
            0 6px 16px rgba(27, 29, 42, 0.07),
            0 28px 68px rgba(27, 29, 42, 0.18);
        backdrop-filter: blur(16px) saturate(1.15);
        -webkit-backdrop-filter: blur(16px) saturate(1.15);
        animation: panel-in 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    // A faint hairline of light along the top edge — the quiet "premium" tell.
    .study-panel::before {
        content: "";
        position: absolute;
        top: 0;
        right: 22px;
        left: 22px;
        height: 1px;
        background: linear-gradient(
            90deg,
            transparent,
            rgba(255, 255, 255, 0.9) 18%,
            rgba(255, 255, 255, 0.9) 82%,
            transparent
        );
        pointer-events: none;
    }

    // Session strip — the due mix as one quiet, integrated header (not floating pills).
    .session-strip {
        display: flex;
        flex-direction: column;
        gap: 11px;
        padding-bottom: 18px;
        border-bottom: 1px solid rgba(27, 29, 42, 0.06);
        animation: rise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .session-legend {
        display: flex;
        gap: 16px;
        font-size: 12.5px;
    }
    .legend {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }
    .dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex: none;
    }
    .dot-new {
        background: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
    }
    .dot-learn {
        background: #f59e0b;
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
    }
    .dot-review {
        background: #14b8a6;
        box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.12);
    }
    .num {
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        color: #1b1d2a;
    }
    .legend-label {
        color: rgba(27, 29, 42, 0.5);
    }
    .session-track {
        display: flex;
        gap: 3px;
        height: 4px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(27, 29, 42, 0.06);
    }
    .seg {
        min-width: 8px;
    }
    .seg-new {
        background: #3b82f6;
    }
    .seg-learn {
        background: #f59e0b;
    }
    .seg-review {
        background: #14b8a6;
    }

    .study-card-frame {
        flex: 1;
        min-height: 200px;
        display: flex;
    }
    .study-iframe {
        flex: 1;
        width: 100%;
        border: none;
        background: transparent;
    }

    .study-actions {
        display: flex;
        justify-content: center;
    }
    // Gentle rise on each new question/answer swap — meaning: fresh content arrived.
    .study-actions > * {
        animation: rise 0.28s cubic-bezier(0.22, 1, 0.36, 1) backwards;
    }

    .study-primary {
        appearance: none;
        border: none;
        border-radius: 13px;
        padding: 12px 24px;
        font: inherit;
        font-size: 15px;
        font-weight: 560;
        letter-spacing: 0.01em;
        color: #fff;
        background: linear-gradient(180deg, #292c3d, #1b1d2a);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.2),
            0 8px 20px rgba(27, 29, 42, 0.22);
        transition:
            transform 0.14s ease,
            box-shadow 0.14s ease;
    }
    .study-primary:hover {
        transform: translateY(-1px);
        box-shadow:
            0 2px 4px rgba(27, 29, 42, 0.22),
            0 12px 30px rgba(27, 29, 42, 0.26);
    }
    .study-primary:active {
        transform: translateY(0);
        box-shadow: 0 1px 2px rgba(27, 29, 42, 0.2);
    }

    .study-grades {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        width: 100%;
    }
    .grade {
        appearance: none;
        border: 1px solid rgba(27, 29, 42, 0.09);
        border-radius: 13px;
        padding: 13px 8px;
        font: inherit;
        background: rgba(255, 255, 255, 0.72);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        transition:
            transform 0.14s ease,
            border-color 0.14s ease,
            background 0.14s ease,
            box-shadow 0.14s ease;
    }
    .grade-label {
        font-size: 14px;
        font-weight: 560;
        letter-spacing: 0.01em;
    }
    .grade:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(27, 29, 42, 0.1);
    }
    .grade:active {
        transform: translateY(0);
        box-shadow: none;
    }
    // Calm, never an alarm — "Again" is a soft rose, not a red buzzer (UX ruling 2).
    .grade-again .grade-label {
        color: #b4456b;
    }
    .grade-again:hover {
        border-color: rgba(180, 69, 107, 0.35);
        background: rgba(180, 69, 107, 0.07);
    }
    .grade-again:hover kbd {
        color: #b4456b;
    }
    .grade-hard .grade-label {
        color: #b06d12;
    }
    .grade-hard:hover {
        border-color: rgba(176, 109, 18, 0.35);
        background: rgba(176, 109, 18, 0.07);
    }
    .grade-hard:hover kbd {
        color: #b06d12;
    }
    .grade-good .grade-label {
        color: #1b8a5a;
    }
    .grade-good:hover {
        border-color: rgba(27, 138, 90, 0.35);
        background: rgba(27, 138, 90, 0.07);
    }
    .grade-good:hover kbd {
        color: #1b8a5a;
    }
    .grade-easy .grade-label {
        color: #2563eb;
    }
    .grade-easy:hover {
        border-color: rgba(37, 99, 235, 0.35);
        background: rgba(37, 99, 235, 0.07);
    }
    .grade-easy:hover kbd {
        color: #2563eb;
    }

    kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        font-family: inherit;
        font-size: 11px;
        font-weight: 500;
        line-height: 1;
        color: rgba(27, 29, 42, 0.42);
        background: rgba(27, 29, 42, 0.05);
        border: 1px solid rgba(27, 29, 42, 0.07);
        border-radius: 6px;
        box-shadow: inset 0 -1px 0 rgba(27, 29, 42, 0.05);
        transition: color 0.14s ease;
    }
    .study-primary kbd {
        color: rgba(255, 255, 255, 0.72);
        background: rgba(255, 255, 255, 0.16);
        border-color: rgba(255, 255, 255, 0.14);
        box-shadow: none;
    }

    .study-msg {
        margin: auto;
        max-width: 360px;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 4px;
        color: rgba(27, 29, 42, 0.58);
        line-height: 1.55;
        animation: rise 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    .study-msg strong {
        margin-top: 6px;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: #1b1d2a;
    }
    .study-msg p {
        margin: 0;
        font-size: 14px;
    }
    .study-msg .study-primary {
        margin-top: 18px;
    }

    .study-spinner {
        width: 28px;
        height: 28px;
        margin-bottom: 12px;
        border-radius: 50%;
        border: 2px solid rgba(27, 29, 42, 0.1);
        border-top-color: rgba(27, 29, 42, 0.45);
        animation: spin 0.8s linear infinite;
    }

    // A calm "map node" mark for the empty states — echoes the graph backdrop.
    .study-glyph {
        position: relative;
        width: 46px;
        height: 46px;
        margin-bottom: 10px;
        border-radius: 50%;
        border: 1.5px solid rgba(27, 29, 42, 0.14);
    }
    .glyph-node {
        border-color: rgba(59, 130, 246, 0.4);
    }
    .glyph-node::after {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        width: 13px;
        height: 13px;
        border-radius: 50%;
        background: rgba(59, 130, 246, 0.85);
        transform: translate(-50%, -50%);
    }
    .glyph-done {
        border-color: rgba(20, 184, 166, 0.45);
    }
    .glyph-done::after {
        content: "";
        position: absolute;
        top: 45%;
        left: 50%;
        width: 8px;
        height: 14px;
        border: solid rgba(20, 184, 166, 0.95);
        border-width: 0 2px 2px 0;
        border-radius: 1px;
        transform: translate(-50%, -58%) rotate(45deg);
    }

    @keyframes panel-in {
        from {
            opacity: 0;
            transform: translateY(10px) scale(0.99);
        }
        to {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }
    @keyframes rise {
        from {
            opacity: 0;
            transform: translateY(6px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    // Motion is a courtesy, not a demand.
    @media (prefers-reduced-motion: reduce) {
        .study-panel,
        .session-strip,
        .study-actions > *,
        .study-msg,
        .study-spinner {
            animation: none;
        }
        .study-back,
        .study-back-arrow,
        .study-primary,
        .grade,
        kbd {
            transition: none;
        }
        .study-back:hover,
        .study-back:hover .study-back-arrow,
        .study-primary:hover,
        .grade:hover {
            transform: none;
        }
    }
</style>
