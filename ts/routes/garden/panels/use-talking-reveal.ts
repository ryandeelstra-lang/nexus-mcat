// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Keeper "talks" by TEXT — one word lands at a time on a human cadence
// (~70ms with random variation, longer breaths after punctuation), like a Zelda villager.
// The hook is append-aware: the reply beat starts crawling its opener the instant you stop
// speaking, and when the server grade lands the text simply GROWS — the crawl continues
// into it without restarting. While the crawl has caught up but more words are still
// coming (`final: false`), the caller shows the "…" typing dots. Pure helpers are
// test-pinned; timing is injectable so tests never sleep.
import { useEffect, useRef, useState } from "react";

import type { VoiceBucket } from "./voice-api";

/** The human cadence contract: a word roughly every 70ms, varied so it never metronomes. */
export const WORD_BASE_MS = 70;
export const WORD_JITTER_MS = 30;
/** Breath multipliers: sentence ends pause longest, clause breaks in between. */
export const SENTENCE_PAUSE_MULT = 3.2;
export const CLAUSE_PAUSE_MULT = 1.9;

const _WS = /\s+/;

export function wordsOf(text: string): string[] {
    return text.split(_WS).filter((w) => w.length > 0);
}

/** The first `count` words of `text`, clamped — the visible slice of the crawl. */
export function revealWords(text: string, count: number): string {
    if (count <= 0) {
        return "";
    }
    return wordsOf(text).slice(0, count).join(" ");
}

/**
 * The pause AFTER a word, in ms: base ± jitter, stretched at punctuation so the rhythm
 * reads like speech ("…another word appears. Another word appears."). `rand` is 0..1.
 */
export function delayAfterWord(
    word: string,
    rand: number,
    baseMs: number = WORD_BASE_MS,
    jitterMs: number = WORD_JITTER_MS,
): number {
    const jitter = (rand * 2 - 1) * jitterMs;
    let mult = 1;
    if (/[.!?…]["')\]]?$/.test(word)) {
        mult = SENTENCE_PAUSE_MULT;
    } else if (/[,;:—–-]["')\]]?$/.test(word)) {
        mult = CLAUSE_PAUSE_MULT;
    }
    return Math.max(24, Math.round((baseMs + jitter) * mult));
}

/** Neutral thinking openers — spoken BEFORE the grade exists, so they must not presume a verdict. */
export const REPLY_OPENERS = [
    "Hmm… let me look at that.",
    "Mm — let's see.",
    "Ah, alright…",
    "Let me think on what you said…",
    "Okay…",
] as const;

/** Deterministic opener pick (stable per card/attempt so re-renders never reshuffle words). */
export function pickOpener(seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
        h = (h * 31 + seed.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(h) % REPLY_OPENERS.length;
    return REPLY_OPENERS[idx] ?? REPLY_OPENERS[0];
}

export interface Verdict {
    /** The line the Keeper lands on at the end of his reply. */
    headline: string;
    /** True when the answer counted as a pass (grew the plant): good / okay. */
    passed: boolean;
}

/**
 * The pass/fail verdict for a terminal result bucket, in the user's own words. Result buckets are
 * only ever good | okay | dont_know (ask_again re-prompts before it can terminate). Pure/test-pinned.
 */
export function verdictFor(bucket: VoiceBucket): Verdict {
    switch (bucket) {
        case "good":
            return { headline: "You got it!", passed: true };
        case "okay":
            return { headline: "You got it — close enough.", passed: true };
        case "ask_again":
            return { headline: "Let's try that another way.", passed: false };
        case "dont_know":
            return { headline: "Maybe next time.", passed: false };
        default: {
            const exhaustive: never = bucket;
            return exhaustive;
        }
    }
}

export interface KeeperReplyInput {
    opener: string;
    correctAnswer: string;
    rationale: string;
    /** The verdict sentence the Keeper SAYS at the end (his words, not a status chip). */
    verdictHeadline: string;
}

/**
 * Compose the whole graded reply the Keeper speaks: opener → the real answer → the why →
 * the verdict, one talking line. Pure/test-pinned; whitespace collapsed so words step evenly.
 */
export function composeKeeperReply(input: KeeperReplyInput): string {
    const answer = (input.correctAnswer || "").trim();
    const why = (input.rationale || "").trim();
    const lead = answer ? `The answer: ${answer}` : "";
    const body = [lead, why].filter((s) => s.length > 0).join(" — ");
    return [input.opener.trim(), body, input.verdictHeadline.trim()]
        .filter((s) => s.length > 0)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

function prefersReducedMotion(): boolean {
    return (
        typeof globalThis.matchMedia === "function"
        && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

export interface TalkingReveal {
    /** The words on screen so far. */
    shown: string;
    /** All CURRENTLY KNOWN text is on screen, but more is still coming (show the "…" dots). */
    waiting: boolean;
    /** The text is final AND fully on screen — land the verdict/choices now. */
    done: boolean;
    /** Snap everything known so far onto the screen (click-to-skip). */
    finish(): void;
}

export interface TalkingRevealOpts {
    /** False while the tail of the text is still unknown (grade in flight). Default true. */
    final?: boolean;
    /** Changing this restarts the crawl from word zero (a new ask/reply beat). */
    resetKey?: string | number;
    baseMs?: number;
    jitterMs?: number;
}

/**
 * Reveal `text` one word at a time on the human cadence. The text may GROW between renders
 * (streamed reply): the crawl keeps its place and talks on into the new words. The caller MUST
 * also render the full text in an sr-only aria-live node (AT can't read a progressive reveal).
 */
export function useTalkingReveal(text: string, opts?: TalkingRevealOpts): TalkingReveal {
    const final = opts?.final ?? true;
    const resetKey = opts?.resetKey ?? "";
    const baseMs = opts?.baseMs ?? WORD_BASE_MS;
    const jitterMs = opts?.jitterMs ?? WORD_JITTER_MS;

    const [count, setCount] = useState(0);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const words = wordsOf(text);
    const total = words.length;

    // A new beat starts from silence.
    useEffect(() => {
        setCount(0);
    }, [resetKey]);

    useEffect(() => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        if (prefersReducedMotion()) {
            setCount(total);
            return;
        }
        if (count >= total) {
            return; // caught up — either done (final) or waiting on more words
        }
        const lastShown = count > 0 ? words[count - 1] ?? "" : "";
        const delay = count === 0 ? 90 : delayAfterWord(lastShown, Math.random(), baseMs, jitterMs);
        timer.current = setTimeout(() => {
            timer.current = null;
            setCount((c) => Math.min(c + 1, total));
        }, delay);
        return () => {
            if (timer.current) {
                clearTimeout(timer.current);
                timer.current = null;
            }
        };
        // `text` stands in for `words` (fresh array each render).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count, total, text, baseMs, jitterMs]);

    return {
        shown: revealWords(text, count),
        waiting: count >= total && !final,
        done: final && count >= total,
        finish: () => setCount(total),
    };
}
