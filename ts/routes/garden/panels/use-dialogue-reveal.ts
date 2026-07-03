// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the streamed graded-reply primitives for the Keeper dialogue (dialogue-UX plan §4).
// The Keeper "speaks" his verdict as dialogue — a few words at a time, definition first, then the
// why — and the pass/fail verdict resolves when the crawl finishes. This is pure PRESENTATION of the
// single grade response the server already returns (`correctAnswer`, `rationale`, `bucket`); it adds
// no new trust and no network. The pure helpers are test-pinned; the hook drives the word crawl.
import { useEffect, useRef, useState } from "react";

import type { VoiceBucket } from "./voice-api";

const WORDS_PER_TICK = 2;
const TICK_MS = 55;
const _WS = /\s+/;

export interface KeeperReplyInput {
    correctAnswer: string;
    rationale: string;
}

/**
 * Compose the line the Keeper speaks back: the real definition/answer first, then the "why" if the
 * grader gave one. Pure and test-pinned. Whitespace is collapsed so the word crawl steps evenly.
 */
export function composeKeeperReply(input: KeeperReplyInput): string {
    const answer = (input.correctAnswer || "").trim();
    const why = (input.rationale || "").trim();
    const lead = answer ? `The answer: ${answer}` : "";
    const parts = [lead, why].filter((s) => s.length > 0);
    return parts.join(" — ").replace(/\s+/g, " ").trim();
}

export interface Verdict {
    /** The headline the Keeper lands on when the reply finishes. */
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

/** The first `wordCount` whitespace-delimited words of `text`, clamped. Pure/test-pinned. */
export function wordCrawlStep(text: string, wordCount: number): string {
    if (wordCount <= 0) {
        return "";
    }
    const words = text.split(_WS).filter((w) => w.length > 0);
    return words.slice(0, wordCount).join(" ");
}

function totalWords(text: string): number {
    return text.split(_WS).filter((w) => w.length > 0).length;
}

function prefersReducedMotion(): boolean {
    return (
        typeof globalThis.matchMedia === "function"
        && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

export interface DialogueReveal {
    /** The words revealed so far. */
    shown: string;
    /** True once the whole reply is on screen — the caller reveals the verdict now. */
    done: boolean;
    /** Snap to the full reply (click-to-skip). */
    finish(): void;
}

/**
 * Reveal `text` a few words per tick — the "one idea at a time" Keeper crawl. `prefers-reduced-motion`
 * snaps to full instantly. The caller MUST also render the full text in an sr-only aria-live node
 * (assistive tech can't read a progressive reveal — dialogue-UX plan §6).
 */
export function useDialogueReveal(
    text: string,
    opts?: { wordsPerTick?: number; tickMs?: number },
): DialogueReveal {
    const wordsPerTick = opts?.wordsPerTick ?? WORDS_PER_TICK;
    const tickMs = opts?.tickMs ?? TICK_MS;
    const [count, setCount] = useState(0);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);
    const total = totalWords(text);

    useEffect(() => {
        if (timer.current) {
            clearInterval(timer.current);
            timer.current = null;
        }
        if (prefersReducedMotion() || total === 0) {
            setCount(total);
            return;
        }
        setCount(0);
        timer.current = setInterval(() => {
            setCount((c) => {
                const next = c + wordsPerTick;
                if (next >= total && timer.current) {
                    clearInterval(timer.current);
                    timer.current = null;
                }
                return next;
            });
        }, tickMs);
        return () => {
            if (timer.current) {
                clearInterval(timer.current);
                timer.current = null;
            }
        };
    }, [text, total, wordsPerTick, tickMs]);

    return {
        shown: wordCrawlStep(text, count),
        done: count >= total,
        finish: () => setCount(total),
    };
}
