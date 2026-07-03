// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: DISPLAY-ONLY live speech-to-text for the Keeper dialogue (dialogue-UX plan §2/§4).
// This shows the user their words as they speak, via the browser Web Speech API. It is a best-effort
// affordance ONLY — it is NEVER sent anywhere and NEVER decides correctness. The graded transcript is
// always the server-side faster-whisper transcription of the recorded clip (ai/stt.py); this hook is
// purely cosmetic and is expected to no-op where the API is unavailable (common in QtWebEngine).
// Because of that, every consumer must degrade gracefully: `supported === false` means "just show a
// listening pulse; the real transcript lands in the Keeper's reply."
import { useCallback, useEffect, useRef, useState } from "react";

// --- Minimal Web Speech API surface (not in the standard DOM lib types). ---------------------------

interface SpeechRecognitionAlternativeLike {
    transcript: string;
}
interface SpeechRecognitionResultLike {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionAlternativeLike;
    [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
    readonly length: number;
    item(index: number): SpeechRecognitionResultLike;
    [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionLike {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}
type SpeechRecognitionCtor = new() => SpeechRecognitionLike;

function recognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof globalThis === "undefined") {
        return null;
    }
    const w = globalThis as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** True when the browser exposes a usable Web Speech recognition engine. */
export function liveTranscriptSupported(): boolean {
    return recognitionCtor() !== null;
}

/**
 * Join the settled ("final") text with the in-flight ("interim") guess into one display string.
 * Pure and test-pinned: a single space between the two, no leading/trailing whitespace, and either
 * side may be empty.
 */
export function mergeTranscript(finalText: string, interim: string): string {
    return [finalText.trim(), interim.trim()].filter((s) => s.length > 0).join(" ");
}

/** Flatten a Web Speech results list into settled + interim text (pure; exported for tests). */
export function readResults(
    results: SpeechRecognitionResultListLike,
): { finalText: string; interim: string } {
    let finalText = "";
    let interim = "";
    for (let i = 0; i < results.length; i++) {
        const result = results.item(i);
        const alt = result.item(0);
        const text = alt ? alt.transcript : "";
        if (result.isFinal) {
            finalText = mergeTranscript(finalText, text);
        } else {
            interim = mergeTranscript(interim, text);
        }
    }
    return { finalText, interim };
}

export interface LiveTranscript {
    /** Whether a live engine exists at all — false means "render a listening pulse instead." */
    supported: boolean;
    /** The current best-guess text to show the user (settled + interim). */
    display: string;
    /** Whether recognition is actively running. */
    listening: boolean;
    /** Begin live captioning (safe to call when unsupported — it no-ops). */
    start(): void;
    /** Stop live captioning and release the engine. */
    stop(): void;
    /** Clear the display for a fresh card. */
    reset(): void;
}

/**
 * Display-only live captions for the "listening" beat. Never authoritative. On any error or where
 * the API is missing, it silently degrades to `supported: false` / empty `display`.
 */
export function useLiveTranscript(lang = "en-US"): LiveTranscript {
    const supported = liveTranscriptSupported();
    const [display, setDisplay] = useState("");
    const [listening, setListening] = useState(false);
    const recognition = useRef<SpeechRecognitionLike | null>(null);
    const finalText = useRef("");

    const stop = useCallback((): void => {
        const rec = recognition.current;
        recognition.current = null;
        setListening(false);
        if (rec) {
            rec.onresult = null;
            rec.onerror = null;
            rec.onend = null;
            try {
                rec.abort();
            } catch {
                // ignore — we only care that the engine is released
            }
        }
    }, []);

    const reset = useCallback((): void => {
        finalText.current = "";
        setDisplay("");
    }, []);

    const start = useCallback((): void => {
        const Ctor = recognitionCtor();
        if (!Ctor || recognition.current) {
            return;
        }
        finalText.current = "";
        setDisplay("");
        let rec: SpeechRecognitionLike;
        try {
            rec = new Ctor();
        } catch {
            return;
        }
        rec.lang = lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.onresult = (event: SpeechRecognitionEventLike): void => {
            const { finalText: settled, interim } = readResults(event.results);
            if (settled) {
                finalText.current = settled;
            }
            setDisplay(mergeTranscript(finalText.current, interim));
        };
        rec.onerror = (): void => {
            // A denied/errored engine is non-fatal: drop live captions, keep the real path.
            stop();
        };
        rec.onend = (): void => {
            setListening(false);
        };
        recognition.current = rec;
        try {
            rec.start();
            setListening(true);
        } catch {
            recognition.current = null;
            setListening(false);
        }
    }, [lang, stop]);

    useEffect(() => stop, [stop]);

    return { supported, display, listening, start, stop, reset };
}
