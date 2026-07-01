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
    <button class="study-back" on:click={backToMap}>← Map</button>

    {#if phase !== "nocol" && phase !== "loading"}
        <div class="study-counts">
            <span class="count count-new">{counts.new} new</span>
            <span class="count count-learn">{counts.learning} learning</span>
            <span class="count count-review">{counts.review} review</span>
        </div>
    {/if}

    <div class="study-panel">
        {#if phase === "loading"}
            <div class="study-msg">Loading your next card…</div>
        {:else if phase === "nocol"}
            <div class="study-msg">
                <strong>Open your MCAT deck to start studying.</strong>
                <p>Your cards appear here, in front of the map.</p>
            </div>
        {:else if phase === "empty"}
            <div class="study-msg">
                <strong>You're caught up.</strong>
                <p>Nothing is due right now — the map holds your progress.</p>
                <button class="study-primary" on:click={backToMap}>
                    Back to the map
                </button>
            </div>
        {:else}
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
                        Show answer <kbd>space</kbd>
                    </button>
                {:else}
                    <div class="study-grades">
                        <button
                            class="grade grade-again"
                            on:click={() => grade(CardAnswer_Rating.AGAIN)}
                        >
                            Again <kbd>1</kbd>
                        </button>
                        <button
                            class="grade grade-hard"
                            on:click={() => grade(CardAnswer_Rating.HARD)}
                        >
                            Hard <kbd>2</kbd>
                        </button>
                        <button
                            class="grade grade-good"
                            on:click={() => grade(CardAnswer_Rating.GOOD)}
                        >
                            Good <kbd>3</kbd>
                        </button>
                        <button
                            class="grade grade-easy"
                            on:click={() => grade(CardAnswer_Rating.EASY)}
                        >
                            Easy <kbd>4</kbd>
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
        // A soft scrim so the card pops without hiding the map behind it.
        background: radial-gradient(
            circle at 50% 42%,
            rgba(251, 251, 253, 0.34),
            rgba(251, 251, 253, 0.72)
        );
    }

    .study-back {
        position: absolute;
        top: 16px;
        left: 16px;
        appearance: none;
        border: none;
        border-radius: 999px;
        padding: 7px 14px;
        font: inherit;
        font-size: 13px;
        color: rgba(27, 29, 42, 0.7);
        background: rgba(255, 255, 255, 0.86);
        box-shadow:
            0 1px 2px rgba(27, 29, 42, 0.06),
            0 8px 24px rgba(27, 29, 42, 0.1);
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
        cursor: pointer;
    }
    .study-back:hover {
        color: #1b1d2a;
    }

    .study-counts {
        position: absolute;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 8px;
        font-size: 12px;
    }
    .count {
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.78);
        box-shadow: 0 1px 2px rgba(27, 29, 42, 0.05);
    }
    .count-new {
        color: #2563eb;
    }
    .count-learn {
        color: #d97706;
    }
    .count-review {
        color: #059669;
    }

    // The floating card — premium frosted panel over the dim map.
    .study-panel {
        width: min(680px, 90vw);
        min-height: 320px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        padding: 32px 32px 26px;
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(27, 29, 42, 0.06);
        box-shadow:
            0 2px 8px rgba(27, 29, 42, 0.06),
            0 24px 64px rgba(27, 29, 42, 0.16);
        backdrop-filter: blur(14px) saturate(1.1);
        -webkit-backdrop-filter: blur(14px) saturate(1.1);
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

    .study-primary {
        appearance: none;
        border: none;
        border-radius: 12px;
        padding: 12px 26px;
        font: inherit;
        font-size: 15px;
        font-weight: 560;
        color: #fff;
        background: #1b1d2a;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        transition:
            transform 0.12s ease,
            opacity 0.12s ease;
    }
    .study-primary:hover {
        opacity: 0.9;
    }
    .study-primary:active {
        transform: translateY(1px);
    }

    .study-grades {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        width: 100%;
    }
    .grade {
        appearance: none;
        border: 1px solid rgba(27, 29, 42, 0.1);
        border-radius: 12px;
        padding: 12px 8px;
        font: inherit;
        font-size: 14px;
        font-weight: 550;
        background: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        transition:
            transform 0.12s ease,
            background 0.12s ease;
    }
    .grade:hover {
        transform: translateY(-1px);
    }
    .grade:active {
        transform: translateY(0);
    }
    // Calm, never an alarm — "Again" is a soft rose, not a red buzzer (UX ruling 2).
    .grade-again {
        color: #b4456b;
    }
    .grade-hard {
        color: #b06d12;
    }
    .grade-good {
        color: #1b8a5a;
    }
    .grade-easy {
        color: #2563eb;
    }

    kbd {
        font-family: inherit;
        font-size: 11px;
        font-weight: 500;
        color: rgba(27, 29, 42, 0.4);
        background: rgba(27, 29, 42, 0.05);
        border-radius: 5px;
        padding: 1px 6px;
    }
    .study-primary kbd {
        color: rgba(255, 255, 255, 0.7);
        background: rgba(255, 255, 255, 0.15);
    }

    .study-msg {
        margin: auto;
        text-align: center;
        color: rgba(27, 29, 42, 0.6);
        line-height: 1.5;
    }
    .study-msg strong {
        display: block;
        font-size: 18px;
        color: #1b1d2a;
        margin-bottom: 6px;
    }
    .study-msg p {
        margin: 0 0 16px;
        font-size: 14px;
    }
</style>
