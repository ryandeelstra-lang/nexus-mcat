<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<script lang="ts">
    import type { CongratsInfoResponse } from "@generated/anki/scheduler_pb";
    import { congratsInfo } from "@generated/backend";
    import * as tr from "@generated/ftl";
    import { bridgeCommand, bridgeLink } from "@tslib/bridgecommand";

    import Col from "$lib/components/Col.svelte";
    import Container from "$lib/components/Container.svelte";

    import { buildNextLearnMsg } from "./lib";
    import { onMount } from "svelte";

    export let info: CongratsInfoResponse;
    export let refreshPeriodically = true;

    const congrats = tr.schedulingCongratulationsFinished();
    let nextLearnMsg: string;
    $: nextLearnMsg = buildNextLearnMsg(info);
    const today_reviews = tr.schedulingTodayReviewLimitReached();
    const today_new = tr.schedulingTodayNewLimitReached();

    const unburyThem = bridgeLink("unbury", tr.schedulingUnburyThem());
    const buriedMsg = tr.schedulingBuriedCardsFound({ unburyThem });
    const customStudy = bridgeLink("customStudy", tr.schedulingCustomStudy());
    const customStudyMsg = tr.schedulingHowToCustomStudy({
        customStudy,
    });

    // charged_up: the one obvious primary action — return to the deck list. Reuses the
    // existing overview `decks` bridge command (mw.moveToState("deckBrowser")); only shown
    // when the native bridge is present so the web-only preview never renders a dead button.
    const backToDecks = tr.actionsDecks();
    function goToDecks(): void {
        bridgeCommand("decks");
    }

    onMount(() => {
        if (refreshPeriodically) {
            setInterval(async () => {
                try {
                    info = await congratsInfo({}, { alertOnError: false });
                } catch {
                    console.log("congrats fetch failed");
                }
            }, 60000);
        }
    });
</script>

<Container --gutter-block="1rem" --gutter-inline="2px" breakpoint="sm">
    <Col --col-justify="center">
        <div class="congrats">
            <!-- charged_up: a calm celebration mark — a soft accent-tinted circle with a
                 drawn-in checkmark, not confetti. Decorative only, hidden from a11y tree. -->
            <div class="mark" aria-hidden="true">
                <svg viewBox="0 0 72 72" width="72" height="72">
                    <circle class="mark-ring" cx="36" cy="36" r="34" />
                    <path
                        class="mark-check"
                        d="M23 37.5 L32 46.5 L50 27.5"
                        fill="none"
                    />
                </svg>
            </div>

            <h1>{congrats}</h1>

            {#if nextLearnMsg}
                <p class="lead">{nextLearnMsg}</p>
            {/if}

            {#if info.reviewRemaining}
                <p>{today_reviews}</p>
            {/if}

            {#if info.newRemaining}
                <p>{today_new}</p>
            {/if}

            {#if info.bridgeCommandsSupported}
                {#if info.haveSchedBuried || info.haveUserBuried}
                    <p>
                        {@html buriedMsg}
                    </p>
                {/if}

                {#if !info.isFilteredDeck}
                    <p>
                        {@html customStudyMsg}
                    </p>
                {/if}
            {/if}

            {#if info.deckDescription}
                <div class="description">
                    {@html info.deckDescription}
                </div>
            {/if}

            {#if info.bridgeCommandsSupported}
                <div class="actions">
                    <button class="primary" type="button" on:click={goToDecks}>
                        {backToDecks}
                    </button>
                </div>
            {/if}
        </div>
    </Col>
</Container>

<style lang="scss">
    // charged_up · Apple-HIG "session complete" moment. A calm, centered, premium finish:
    // near-white field, a soft accent celebration mark, a Title1 headline, quiet secondary
    // copy, and exactly one obvious primary action. Light mode; no font-family (SF is app-wide).
    .congrats {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        max-width: 30em;
        margin: 0 auto;
        padding: 56px 24px 40px;
        color: var(--fg, rgba(0, 0, 0, 0.85));

        :global(a) {
            color: var(--accent, #3b82f6);
            text-decoration: none;
        }
        :global(a:hover) {
            text-decoration: underline;
        }
    }

    // Celebration mark — gentle accent ring, checkmark drawn in on entry.
    .mark {
        width: 72px;
        height: 72px;
        margin-bottom: 20px;
        animation: mark-pop 260ms cubic-bezier(0.2, 0, 0.2, 1) both;
    }
    .mark-ring {
        fill: rgba(59, 130, 246, 0.1);
        stroke: rgba(59, 130, 246, 0.28);
        stroke-width: 2;
    }
    .mark-check {
        stroke: var(--accent, #3b82f6);
        stroke-width: 5;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-dasharray: 46;
        stroke-dashoffset: 0;
        animation: mark-draw 420ms cubic-bezier(0.2, 0, 0.2, 1) 120ms both;
    }

    // Title1 headline derived from the existing congrats string.
    h1 {
        margin: 0 0 10px;
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.01em;
        line-height: 1.25;
        animation: rise 220ms cubic-bezier(0.2, 0, 0.2, 1) 60ms both;
    }

    // Dynamic next-due / limit / custom-study copy as calm secondary text.
    p {
        margin: 0 0 8px;
        font-size: 15px;
        line-height: 1.5;
        color: var(--fg-subtle, rgba(0, 0, 0, 0.5));
        animation: rise 220ms cubic-bezier(0.2, 0, 0.2, 1) 100ms both;
    }
    .lead {
        color: var(--fg, rgba(0, 0, 0, 0.85));
    }

    // Deck description — a quiet elevated card rather than a hard-bordered box.
    .description {
        margin-top: 16px;
        padding: 14px 18px;
        width: 100%;
        box-sizing: border-box;
        text-align: start;
        font-size: 14px;
        line-height: 1.5;
        color: var(--fg-subtle, rgba(0, 0, 0, 0.5));
        background: var(--canvas-elevated, #ffffff);
        border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
        border-radius: 14px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.06);
    }

    // The one obvious primary action.
    .actions {
        margin-top: 28px;
        animation: rise 220ms cubic-bezier(0.2, 0, 0.2, 1) 140ms both;
    }
    button.primary {
        appearance: none;
        border: none;
        cursor: pointer;
        min-width: 168px;
        padding: 10px 22px;
        border-radius: 10px;
        background: var(--accent, #3b82f6);
        color: #ffffff;
        font-size: 15px;
        font-weight: 590;
        letter-spacing: -0.01em;
        box-shadow: 0 2px 8px rgba(59, 130, 246, 0.24);
        transition:
            transform 150ms cubic-bezier(0.2, 0, 0.2, 1),
            filter 150ms cubic-bezier(0.2, 0, 0.2, 1),
            box-shadow 150ms cubic-bezier(0.2, 0, 0.2, 1);

        &:hover {
            filter: brightness(1.05);
            transform: translateY(-1px);
            box-shadow: 0 6px 16px rgba(59, 130, 246, 0.3);
        }
        &:active {
            transform: translateY(0);
            filter: brightness(0.96);
        }
        &:focus-visible {
            outline: 2px solid var(--accent, #3b82f6);
            outline-offset: 2px;
        }
    }

    @keyframes mark-pop {
        from {
            opacity: 0;
            transform: scale(0.8);
        }
        to {
            opacity: 1;
            transform: scale(1);
        }
    }
    @keyframes mark-draw {
        from {
            stroke-dashoffset: 46;
        }
        to {
            stroke-dashoffset: 0;
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

    // Respect the OS motion preference — no entrance movement, checkmark shown fully drawn.
    @media (prefers-reduced-motion: reduce) {
        .mark,
        .mark-check,
        h1,
        p,
        .actions {
            animation: none;
        }
        .mark-check {
            stroke-dashoffset: 0;
        }
        button.primary {
            transition: none;
        }
        button.primary:hover {
            transform: none;
        }
    }
</style>
