<!--
Copyright: Ankitects Pty Ltd and contributors
License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
-->
<!--
charged_up: the voice-flashcard Keeper's Shop (doc 24 §12). You come to buy seeds/water; the Keeper
speaks a due card as a question (Zelda-style text crawl), you answer OUT LOUD, we transcribe + grade
server-side, and pay you in seeds/water. A type-instead field is always present (the AI-OFF /
no-mic / accessibility path, §15). Every "correctness" decision is made by the server from the
note's real answer — this page never claims "I was right". Card text is a readable font; only the
chrome is pixel-cozy (§5.7).
-->
<script lang="ts">
    import { onDestroy, onMount } from "svelte";

    import { micSupported, MicRecorder, type Recording } from "./voice-capture";

    type Phase =
        | "loading"
        | "nocol"
        | "empty"
        | "prompt" // Keeper has spoken; awaiting the answer
        | "listening" // recording the spoken answer
        | "thinking" // STT + grader round-trip
        | "result"; // graded; showing the outcome + reward

    type Currency = "seed" | "water";

    interface NextCard {
        card_id: number;
        node_id: string;
        keeper_line: string;
        is_fresh_variant: boolean;
        counts: { new: number; learning: number; review: number };
    }

    interface GradeResult {
        bucket: "good" | "okay" | "ask_again" | "dont_know";
        score: number;
        method: "semantic" | "lexical";
        sentinel: string | null;
        transcript: string;
        correct_answer?: string;
        key_points_hit?: string[];
        key_points_missed?: string[];
        rationale?: string;
        reward?: number;
        currency?: Currency;
        balance?: number;
        bloomed?: boolean;
        applied: boolean;
        re_prompt?: { keeper_line: string; hint: string; attempt: number };
    }

    let phase: Phase = "loading";
    let currency: Currency = "water";
    let card: NextCard | null = null;
    let result: GradeResult | null = null;

    // Live text crawl of the Keeper's line (classic Zelda reveal).
    let crawlText = "";
    let crawlFull = "";
    let crawlTimer: ReturnType<typeof setInterval> | null = null;

    let typed = ""; // the type-instead answer
    let attempt = 1;
    let promptShownAt = 0;
    let micError = "";
    let counts = { new: 0, learning: 0, review: 0 };
    let balance: number | null = null;

    const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canMic = micSupported();
    const recorder = new MicRecorder();

    async function postJson<T>(endpoint: string, body: unknown): Promise<T> {
        // mediasrv's permission gate requires the application/binary content type on every
        // POST (it blocks opaque cross-origin requests); the body is still JSON text.
        const resp = await fetch(`/_anki/${endpoint}`, {
            method: "POST",
            headers: { "Content-Type": "application/binary" },
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            throw new Error(`${endpoint} ${resp.status}`);
        }
        return (await resp.json()) as T;
    }

    function startCrawl(text: string): void {
        if (crawlTimer) {
            clearInterval(crawlTimer);
            crawlTimer = null;
        }
        crawlFull = text;
        if (reducedMotion) {
            crawlText = text; // motion is a courtesy — snap to full
            return;
        }
        crawlText = "";
        let i = 0;
        crawlTimer = setInterval(() => {
            i += 1;
            crawlText = text.slice(0, i);
            if (i >= text.length && crawlTimer) {
                clearInterval(crawlTimer);
                crawlTimer = null;
            }
        }, 22);
    }

    function finishCrawl(): void {
        if (crawlTimer) {
            clearInterval(crawlTimer);
            crawlTimer = null;
        }
        crawlText = crawlFull;
    }

    async function loadNext(): Promise<void> {
        phase = "loading";
        result = null;
        typed = "";
        attempt = 1;
        micError = "";
        try {
            const resp = await postJson<
                { available: boolean; done?: boolean } & Partial<NextCard>
            >("audioReviewNext", { currency });
            if (!resp.available) {
                phase = "nocol";
                return;
            }
            if (resp.done || !resp.card_id) {
                phase = "empty";
                card = null;
                return;
            }
            card = resp as NextCard;
            counts = card.counts ?? counts;
            promptShownAt = Date.now();
            phase = "prompt";
            startCrawl(card.keeper_line);
        } catch {
            phase = "nocol";
            card = null;
        }
    }

    async function submitGrade(payload: Record<string, unknown>): Promise<void> {
        if (!card) {
            return;
        }
        phase = "thinking";
        try {
            const resp = await postJson<{ available: boolean } & GradeResult>(
                "audioReviewGrade",
                {
                    cardId: card.card_id,
                    currency,
                    attempt,
                    msTaken: Math.min(Date.now() - promptShownAt, 120_000),
                    ...payload,
                },
            );
            if (!resp.available) {
                phase = "nocol";
                return;
            }
            // Ask-again ladder: re-prompt in place, don't advance (§13).
            if (!resp.applied && resp.re_prompt) {
                attempt = resp.re_prompt.attempt;
                result = resp;
                typed = "";
                promptShownAt = Date.now();
                phase = "prompt";
                startCrawl(resp.re_prompt.keeper_line);
                return;
            }
            result = resp;
            if (resp.balance !== undefined) {
                balance = resp.balance;
            }
            phase = "result";
        } catch {
            phase = "nocol";
        }
    }

    async function startListening(): Promise<void> {
        if (!canMic) {
            return;
        }
        micError = "";
        try {
            await recorder.start();
            phase = "listening";
        } catch {
            micError = "Microphone unavailable — type your answer instead.";
        }
    }

    async function stopAndGrade(): Promise<void> {
        let rec: Recording | null = null;
        try {
            rec = await recorder.stop();
        } catch {
            micError = "I didn't catch that — try again or type your answer.";
            phase = "prompt";
            return;
        }
        await submitGrade({ audioBase64: rec.base64, audioMime: rec.mime });
    }

    async function submitTyped(): Promise<void> {
        if (!typed.trim()) {
            return;
        }
        await submitGrade({ transcript: typed.trim() });
    }

    async function sayIdk(): Promise<void> {
        await submitGrade({ idk: true });
    }

    function setCurrency(c: Currency): void {
        currency = c;
    }

    function onKeydown(e: KeyboardEvent): void {
        if (phase === "prompt" && e.key === " " && canMic && !typed) {
            e.preventDefault();
            void startListening();
        } else if (phase === "listening" && (e.key === " " || e.key === "Enter")) {
            e.preventDefault();
            void stopAndGrade();
        } else if (phase === "result" && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            void loadNext();
        }
    }

    const bucketCopy: Record<GradeResult["bucket"], { title: string; tone: string }> = {
        good: { title: "The plant blooms!", tone: "good" },
        okay: { title: "Good — it grows.", tone: "okay" },
        ask_again: { title: "Let's try that another way.", tone: "again" },
        dont_know: { title: "That's okay — we'll water it.", tone: "idk" },
    };

    onMount(loadNext);
    onDestroy(() => {
        if (crawlTimer) {
            clearInterval(crawlTimer);
        }
        recorder.cancel();
    });

    function backHome(): void {
        (globalThis as unknown as { pycmd?: (c: string) => void }).pycmd?.("home:map");
    }
</script>

<svelte:window on:keydown={onKeydown} />

<div class="shop" class:night={false}>
    <button class="back" on:click={backHome}>
        <span aria-hidden="true">←</span>
        Garden
    </button>

    <div class="hud" aria-live="polite">
        <button
            class="coin"
            class:active={currency === "water"}
            on:click={() => setCurrency("water")}
        >
            <span class="coin-glyph water" aria-hidden="true"></span>
            Water
        </button>
        <button
            class="coin"
            class:active={currency === "seed"}
            on:click={() => setCurrency("seed")}
        >
            <span class="coin-glyph seed" aria-hidden="true"></span>
            Seeds
        </button>
        {#if balance !== null}
            <span class="balance">{balance} {currency === "water" ? "💧" : "🌱"}</span>
        {/if}
    </div>

    <div class="stage">
        {#if phase === "loading"}
            <div class="msg">
                <div class="spinner" aria-hidden="true"></div>
                <p>The Keeper is choosing a card…</p>
            </div>
        {:else if phase === "nocol"}
            <div class="msg">
                <strong>Open your MCAT deck to visit the Keeper.</strong>
                <p>He'll quiz you out loud and pay you in seeds and water.</p>
            </div>
        {:else if phase === "empty"}
            <div class="msg">
                <strong>The Keeper has nothing due right now.</strong>
                <p>Your garden is watered. Come back when more cards ripen.</p>
                <button class="primary" on:click={backHome}>Back to the garden</button>
            </div>
        {:else}
            <!-- The Keeper + dialogue box -->
            <div class="keeper" aria-hidden="true">
                <div class="keeper-portrait"></div>
            </div>

            <div class="dialogue">
                <div class="dialogue-name">The Keeper</div>
                {#if phase === "result" && result}
                    <div class="card-answer result-{bucketCopy[result.bucket].tone}">
                        <div class="result-title">
                            {bucketCopy[result.bucket].title}
                        </div>
                        <p class="result-line">
                            You said: <em>"{result.transcript || "…"}"</em>
                        </p>
                        {#if result.correct_answer}
                            <p class="result-line">
                                Answer: <strong>{result.correct_answer}</strong>
                            </p>
                        {/if}
                        {#if result.rationale}
                            <p class="result-why">{result.rationale}</p>
                        {/if}
                        <div class="result-meta">
                            <span class="score">match {result.score}%</span>
                            {#if result.sentinel}
                                <span class="sentinel">{result.sentinel}</span>
                            {/if}
                        </div>
                        {#if result.reward}
                            <div class="reward" class:bloom={result.bloomed}>
                                +{result.reward}
                                {currency === "water" ? "💧" : "🌱"}
                                {#if result.bloomed}<span class="bloom-tag">
                                        bloom ✿
                                    </span>{/if}
                            </div>
                        {/if}
                    </div>
                {:else}
                    <!-- Card text: a READABLE font, never pixel (§5.7). -->
                    <button
                        class="dialogue-text"
                        on:click={finishCrawl}
                        title="Show full line"
                    >
                        {crawlText}
                        <span
                            class="caret"
                            class:blink={crawlText === crawlFull}
                        ></span>
                    </button>
                {/if}
            </div>

            <!-- The answer controls -->
            <div class="controls">
                {#if phase === "result"}
                    <button class="primary" on:click={loadNext}>
                        Another <kbd>Enter</kbd>
                    </button>
                    <button class="ghost" on:click={backHome}>
                        That's all for now
                    </button>
                {:else if phase === "thinking"}
                    <div class="thinking">
                        <div class="spinner small" aria-hidden="true"></div>
                        <span>The Keeper is listening closely…</span>
                    </div>
                {:else}
                    {#if canMic}
                        {#if phase === "listening"}
                            <button class="mic recording" on:click={stopAndGrade}>
                                <span class="mic-wave" aria-hidden="true"></span>
                                Stop &amp; answer
                                <kbd>Space</kbd>
                            </button>
                        {:else}
                            <button class="mic" on:click={startListening}>
                                <span class="mic-glyph" aria-hidden="true"></span>
                                Hold to speak
                                <kbd>Space</kbd>
                            </button>
                        {/if}
                    {/if}

                    <form class="type-row" on:submit|preventDefault={submitTyped}>
                        <input
                            class="type-field"
                            placeholder={canMic
                                ? "…or type your answer"
                                : "Type your answer"}
                            bind:value={typed}
                            disabled={phase === "listening"}
                        />
                        <button
                            class="type-send"
                            type="submit"
                            disabled={!typed.trim() || phase === "listening"}
                        >
                            Answer
                        </button>
                    </form>

                    <button
                        class="idk"
                        on:click={sayIdk}
                        disabled={phase === "listening"}
                    >
                        I don't know this yet
                    </button>

                    {#if micError}
                        <p class="mic-error">{micError}</p>
                    {/if}
                {/if}
            </div>

            <footer class="due-strip" aria-label="cards due">
                <span>
                    <i class="dot dot-new"></i>
                    {counts.new} new
                </span>
                <span>
                    <i class="dot dot-learn"></i>
                    {counts.learning} learning
                </span>
                <span>
                    <i class="dot dot-review"></i>
                    {counts.review} review
                </span>
            </footer>
        {/if}
    </div>
</div>

<style lang="scss">
    .shop {
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
        background: radial-gradient(
            120% 80% at 50% 12%,
            #eaf4ec 0%,
            #dfeee3 40%,
            #cfe4d6 100%
        );
        overflow: hidden;
    }

    .back {
        position: absolute;
        top: 18px;
        left: 18px;
        z-index: 4;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid rgba(27, 29, 42, 0.06);
        border-radius: 999px;
        padding: 7px 15px 7px 13px;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        color: rgba(27, 29, 42, 0.7);
        background: rgba(255, 255, 255, 0.85);
        box-shadow: 0 8px 22px rgba(27, 29, 42, 0.1);
        cursor: pointer;
    }
    .back:hover {
        background: #fff;
    }

    .hud {
        position: absolute;
        top: 18px;
        right: 18px;
        z-index: 4;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.85);
        box-shadow: 0 8px 22px rgba(27, 29, 42, 0.1);
    }
    .coin {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 6px 12px;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        color: rgba(27, 29, 42, 0.6);
        background: transparent;
        cursor: pointer;
    }
    .coin.active {
        color: #1b1d2a;
        background: rgba(59, 130, 246, 0.1);
        border-color: rgba(59, 130, 246, 0.25);
    }
    .coin-glyph {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        flex: none;
    }
    .coin-glyph.water {
        background: #38bdf8;
    }
    .coin-glyph.seed {
        background: #84cc16;
    }
    .balance {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
        padding-right: 6px;
    }

    .stage {
        position: relative;
        width: min(680px, 92vw);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 18px;
    }

    .keeper {
        display: flex;
        justify-content: center;
    }
    .keeper-portrait {
        width: 84px;
        height: 84px;
        border-radius: 20px;
        background:
            radial-gradient(circle at 50% 38%, #f6d9b0 0 30%, transparent 31%),
            linear-gradient(180deg, #4c8df7, #3b82f6);
        box-shadow:
            0 10px 30px -8px rgba(59, 130, 246, 0.6),
            inset 0 2px 0 rgba(255, 255, 255, 0.35);
        image-rendering: pixelated;
    }

    // The Zelda dialogue box — cozy wooden/leaf pixel frame, but card TEXT is a readable font.
    .dialogue {
        position: relative;
        width: 100%;
        min-height: 150px;
        padding: 20px 24px;
        border-radius: 18px;
        background: linear-gradient(
            180deg,
            rgba(255, 255, 255, 0.96),
            rgba(255, 255, 255, 0.92)
        );
        border: 2px solid #7c5a3a;
        box-shadow:
            0 2px 0 #a97e52 inset,
            0 18px 44px -14px rgba(27, 29, 42, 0.4);
    }
    .dialogue-name {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #7c5a3a;
        margin-bottom: 10px;
    }
    .dialogue-text {
        display: block;
        width: 100%;
        text-align: left;
        border: none;
        background: none;
        font: inherit;
        font-size: 20px;
        line-height: 1.5;
        color: #1b1d2a;
        cursor: text;
        padding: 0;
    }
    .caret {
        display: inline-block;
        width: 8px;
        height: 20px;
        margin-left: 2px;
        vertical-align: -3px;
        background: #3b82f6;
    }
    .caret.blink {
        animation: blink 1s steps(2, start) infinite;
    }

    .card-answer {
        text-align: left;
    }
    .result-title {
        font-size: 18px;
        font-weight: 700;
        margin-bottom: 8px;
    }
    .result-good .result-title {
        color: #1b8a5a;
    }
    .result-okay .result-title {
        color: #2563eb;
    }
    .result-again .result-title {
        color: #b06d12;
    }
    .result-idk .result-title {
        color: #b4456b;
    }
    .result-line {
        margin: 4px 0;
        font-size: 15px;
    }
    .result-line em {
        color: #565a6e;
    }
    .result-why {
        margin: 8px 0 0;
        font-size: 14px;
        color: #565a6e;
    }
    .result-meta {
        margin-top: 10px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        font-size: 13px;
        color: rgba(27, 29, 42, 0.6);
    }
    .score {
        font-variant-numeric: tabular-nums;
        font-weight: 600;
    }
    .sentinel {
        font-size: 12px;
        color: #b06d12;
    }
    .reward {
        margin-top: 12px;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 20px;
        font-weight: 700;
        color: #1b8a5a;
    }
    .reward.bloom {
        color: #db2777;
    }
    .bloom-tag {
        font-size: 13px;
        font-weight: 600;
        color: #db2777;
    }

    .controls {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        width: 100%;
    }

    .mic,
    .primary,
    .type-send {
        appearance: none;
        border: none;
        border-radius: 13px;
        padding: 13px 26px;
        font: inherit;
        font-size: 15px;
        font-weight: 560;
        color: #fff;
        background: linear-gradient(180deg, #4c8df7, #3b82f6);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 10px;
        box-shadow: 0 10px 24px -8px rgba(59, 130, 246, 0.6);
    }
    .mic.recording {
        background: linear-gradient(180deg, #f0668a, #e04b74);
        box-shadow: 0 10px 24px -8px rgba(224, 75, 116, 0.6);
    }
    .mic-glyph,
    .mic-wave {
        width: 12px;
        height: 16px;
        border-radius: 6px;
        background: #fff;
    }
    .mic-wave {
        animation: pulse 0.9s ease-in-out infinite;
    }

    .ghost {
        appearance: none;
        border: 1px solid rgba(27, 29, 42, 0.12);
        border-radius: 13px;
        padding: 11px 22px;
        font: inherit;
        font-size: 14px;
        background: rgba(255, 255, 255, 0.7);
        cursor: pointer;
        color: #1b1d2a;
    }

    .type-row {
        display: flex;
        gap: 8px;
        width: 100%;
        max-width: 460px;
    }
    .type-field {
        flex: 1;
        border: 1px solid rgba(27, 29, 42, 0.14);
        border-radius: 11px;
        padding: 11px 14px;
        font: inherit;
        font-size: 15px;
        background: rgba(255, 255, 255, 0.9);
    }
    .type-field:focus {
        outline: none;
        border-color: rgba(59, 130, 246, 0.5);
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
    }
    .type-send {
        padding: 11px 18px;
        font-size: 14px;
    }
    .type-send:disabled {
        opacity: 0.5;
        cursor: default;
    }

    .idk {
        appearance: none;
        border: none;
        background: none;
        font: inherit;
        font-size: 13px;
        color: rgba(27, 29, 42, 0.55);
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 3px;
    }
    .idk:hover {
        color: #1b1d2a;
    }
    .mic-error {
        margin: 0;
        font-size: 13px;
        color: #b4456b;
    }

    .thinking {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        color: #565a6e;
        font-size: 15px;
    }

    .due-strip {
        display: flex;
        gap: 16px;
        font-size: 12.5px;
        color: rgba(27, 29, 42, 0.55);
    }
    .dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        margin-right: 5px;
    }
    .dot-new {
        background: #3b82f6;
    }
    .dot-learn {
        background: #f59e0b;
    }
    .dot-review {
        background: #14b8a6;
    }

    .msg {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        text-align: center;
        color: rgba(27, 29, 42, 0.6);
    }
    .msg strong {
        font-size: 18px;
        color: #1b1d2a;
    }
    kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        font: inherit;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.75);
        background: rgba(255, 255, 255, 0.18);
        border-radius: 5px;
    }
    .spinner {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        border: 2px solid rgba(27, 29, 42, 0.12);
        border-top-color: rgba(27, 29, 42, 0.5);
        animation: spin 0.8s linear infinite;
    }
    .spinner.small {
        width: 16px;
        height: 16px;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
    @keyframes blink {
        to {
            opacity: 0;
        }
    }
    @keyframes pulse {
        0%,
        100% {
            transform: scaleY(0.5);
            opacity: 0.7;
        }
        50% {
            transform: scaleY(1);
            opacity: 1;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .caret.blink,
        .mic-wave,
        .spinner {
            animation: none;
        }
    }
</style>
