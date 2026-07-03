// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Zelda text crawl (voice spec §3.1) — 22ms/char, click-to-snap,
// prefers-reduced-motion snaps instantly. The caller must ALSO render the full text for
// assistive tech (spec §11): AT cannot read character-by-character reveals.
import { useEffect, useRef, useState } from "react";

const MS_PER_CHAR = 22;

/** Pure step function (test-pinned): the first `count` characters, clamped. */
export function crawlStep(text: string, count: number): string {
    return text.slice(0, Math.max(0, Math.min(text.length, count)));
}

function prefersReducedMotion(): boolean {
    return (
        typeof globalThis.matchMedia === "function"
        && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

export function useTextCrawl(text: string): {
    shown: string;
    done: boolean;
    finish(): void;
} {
    const [count, setCount] = useState(0);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (prefersReducedMotion()) {
            setCount(text.length);
            return;
        }
        setCount(0);
        timer.current = setInterval(() => {
            setCount((c) => {
                if (c >= text.length && timer.current) {
                    clearInterval(timer.current);
                    timer.current = null;
                }
                return c + 1;
            });
        }, MS_PER_CHAR);
        return () => {
            if (timer.current) {
                clearInterval(timer.current);
                timer.current = null;
            }
        };
    }, [text]);

    return {
        shown: crawlStep(text, count),
        done: count >= text.length,
        finish: () => setCount(text.length),
    };
}
