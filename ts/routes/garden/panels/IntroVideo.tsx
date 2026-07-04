// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the skippable first-run cinematic intro (video/STORYBOARD.md), occupying
// the Decision-37 splash slot. Plays video/out/intro.* (staged into assets/video/)
// exactly once — a localStorage seen-flag persists across sessions — then hands off to
// the existing tutorial flow. Skip button + Esc always available; if the file is absent
// or autoplay is blocked entirely, the overlay simply steps aside.
import React, { useCallback, useEffect, useRef } from "react";

// Bump this when the intro video changes so the new cut replays once for players who
// already saw a prior version (the seen-flag is versioned, not a bare boolean).
const INTRO_SEEN_KEY = "garden.introSeen.v2";

// Deferred via glob so builds without the rendered video stay green. Both a WebM
// (VP9/Opus) and an MP4 (H.264/AAC) cut may be staged; WebM is preferred because
// Anki's bundled QtWebEngine ships without the proprietary H.264/AAC codecs, so the
// MP4 fails to decode there. The MP4 remains as a fallback for codec-complete browsers.
const INTRO_URLS = import.meta.glob("../assets/video/intro.{webm,mp4}", {
    eager: true,
    query: "?url",
    import: "default",
}) as Record<string, string>;

function introUrl(): string | null {
    const entries = Object.entries(INTRO_URLS);
    if (entries.length === 0) {
        return null;
    }
    const webm = entries.find(([path]) => path.endsWith(".webm"));
    return webm ? webm[1] : entries[0][1];
}

function seen(): boolean {
    try {
        return localStorage.getItem(INTRO_SEEN_KEY) === "1";
    } catch {
        return true; // storage unavailable: never risk replaying forever
    }
}

function markSeen(): void {
    try {
        localStorage.setItem(INTRO_SEEN_KEY, "1");
    } catch {
        // cosmetic only
    }
}

/** Clear the seen-flag so the cinematic replays on the next boot / replay request (dev tool). */
export function resetIntroSeen(): void {
    try {
        localStorage.removeItem(INTRO_SEEN_KEY);
    } catch {
        // cosmetic only
    }
}

/** Mark the cinematic seen so it never plays again this build — the dev "skip intro" path. */
export function markIntroSeen(): void {
    markSeen();
}

/** Whether a rendered intro exists to (re)play at all — gates the dev replay affordance. */
export function introAvailable(): boolean {
    return introUrl() !== null;
}

/** Whether the intro should play on this boot (file present + not seen yet). */
export function introPending(): boolean {
    return introUrl() !== null && !seen();
}

export interface IntroVideoProps {
    onDone: () => void;
}

export function IntroVideo({ onDone }: IntroVideoProps): React.ReactElement | null {
    const videoRef = useRef<HTMLVideoElement>(null);
    const url = introUrl();

    const finish = useCallback((): void => {
        markSeen();
        onDone();
    }, [onDone]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") {
                finish();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [finish]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) {
            return;
        }
        void video.play().catch(() => {
            // Autoplay with sound blocked: retry muted so the visuals still run.
            video.muted = true;
            void video.play().catch(() => finish());
        });
    }, [finish]);

    if (!url) {
        return null;
    }

    return (
        <div className="garden-intro" role="dialog" aria-modal="true" aria-label="Intro cinematic">
            <video
                ref={videoRef}
                className="garden-intro-video"
                src={url}
                playsInline
                preload="auto"
                onEnded={finish}
                onError={finish}
            />
            {
                /* autoFocus: Tab must not wander into the invisible HUD behind the black
              * overlay; Enter/Space then skip directly. */
            }
            <button type="button" className="garden-intro-skip" onClick={finish} autoFocus>
                Skip&nbsp;▸
            </button>
        </div>
    );
}
