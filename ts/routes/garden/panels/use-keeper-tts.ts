// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Keeper's voice (voice spec §6, AF-10). Web Speech when the platform
// ships voices; the native Qt TTS bridge (POST /_anki/gardenTts) otherwise; silence
// (crawl-only) as the honest floor. The Keeper reads the QUESTION only, never the answer.
import { useCallback, useEffect, useRef, useState } from "react";

type Strategy = "web" | "native";

function detectWebVoices(): Promise<boolean> {
    return new Promise((resolve) => {
        const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
        if (!synth) {
            resolve(false);
            return;
        }
        if (synth.getVoices().length > 0) {
            resolve(true);
            return;
        }
        // QtWebEngine commonly reports voices only after voiceschanged — or never.
        const timeout = setTimeout(() => resolve(synth.getVoices().length > 0), 500);
        synth.addEventListener(
            "voiceschanged",
            () => {
                clearTimeout(timeout);
                resolve(synth.getVoices().length > 0);
            },
            { once: true },
        );
    });
}

export function useKeeperTts(): {
    speak(text: string): void;
    stop(): void;
    muted: boolean;
    setMuted(m: boolean): void;
    capable: boolean;
} {
    const strategy = useRef<Strategy>("native");
    const [capable, setCapable] = useState(false);
    const [muted, setMuted] = useState(false);

    useEffect(() => {
        let cancelled = false;
        void detectWebVoices().then((hasWeb) => {
            if (cancelled) {
                return;
            }
            strategy.current = hasWeb ? "web" : "native";
            // The native bridge exists on every desktop build; worst case it no-ops.
            setCapable(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const stop = useCallback((): void => {
        (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis?.cancel();
    }, []);

    const speak = useCallback(
        (text: string): void => {
            if (muted || !text) {
                return;
            }
            if (strategy.current === "web") {
                const synth = (globalThis as { speechSynthesis?: SpeechSynthesis })
                    .speechSynthesis;
                if (synth) {
                    synth.cancel();
                    synth.speak(new SpeechSynthesisUtterance(text));
                    return;
                }
            }
            void fetch("/_anki/gardenTts", {
                method: "POST",
                headers: { "Content-Type": "application/binary" },
                body: JSON.stringify({ text }),
            }).catch(() => undefined);
        },
        [muted],
    );

    return { speak, stop, muted, setMuted, capable };
}
