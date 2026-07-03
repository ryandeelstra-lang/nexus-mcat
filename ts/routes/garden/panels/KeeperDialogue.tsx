// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the Keeper's dialogue box, styled after the keeper-dialogue mockup art —
// a vine-wrapped wooden frame over parchment, a carved round medallion holding the
// portrait, and the glowing arrow coin as the continue affordance. The body is a
// word-by-word "talking" crawl the caller controls; while the Keeper is still composing
// (grade in flight) the box shows the "…" typing dots like a person replying. This
// component is pure chrome: it owns no review logic and issues no network.
import React, { useEffect, useState } from "react";

import { assetUrl } from "../game/assets";

export interface KeeperDialogueProps {
    /** Portrait image URL, shown inside the medallion; the medallion hides if it fails. */
    portraitSrc?: string;
    /** The speaker's name shown above the line (e.g. "The Keeper"). */
    speakerName?: string;
    /** The visible dialogue body — typically a crawling substring the caller controls. */
    body: React.ReactNode;
    /** Full text mirrored into an sr-only aria-live node (AT can't read a word-crawl). */
    srText?: string;
    /** Show the blinking caret (while the crawl is still revealing known text). */
    showCaret?: boolean;
    /** Show the "…" typing indicator (the Keeper is still composing — reply in flight). */
    dots?: boolean;
    /** Click anywhere on the text to skip the crawl. */
    onBodyClick?: () => void;
    /** Optional badge (e.g. the reworded-variant marker). */
    badge?: React.ReactNode;
    /** Extra class on the frame (bucket tone tint on the reply beat). */
    tone?: string;
    /** Renders the glowing arrow coin, bottom-right (the mockup's continue affordance). */
    onContinue?: () => void;
    continueLabel?: string;
    /** The controls / "choices" row rendered under the line. */
    children?: React.ReactNode;
}

/** Animated "dot dot dot" — the Keeper is typing. Purely decorative; sr text carries meaning. */
export function TypingDots(): React.ReactElement {
    return (
        <span className="keeper-typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
        </span>
    );
}

/** The Keeper's dialogue box. Reused for every beat: ask, listen, replying, and the verdict. */
export function KeeperDialogue(props: KeeperDialogueProps): React.ReactElement {
    const {
        portraitSrc,
        speakerName = "The Keeper",
        body,
        srText,
        showCaret = false,
        dots = false,
        onBodyClick,
        badge,
        tone,
        onContinue,
        continueLabel = "Continue",
        children,
    } = props;
    const [portraitOk, setPortraitOk] = useState(true);

    useEffect(() => {
        setPortraitOk(true);
    }, [portraitSrc]);

    const frameArt = {
        "--keeper-frame": cssUrl(assetUrl("ui-panel-frame")),
        "--keeper-parchment": cssUrl(assetUrl("ui-keeper-parchment")),
        "--keeper-medallion": cssUrl(assetUrl("ui-keeper-medallion")),
        "--keeper-arrow": cssUrl(assetUrl("ui-keeper-arrow")),
    } as React.CSSProperties;

    return (
        <div className={`keeper-dialogue${tone ? ` ${tone}` : ""}`} style={frameArt}>
            {portraitSrc && portraitOk && (
                <div className="keeper-medallion" aria-hidden="true">
                    <img
                        className="keeper-medallion-face"
                        src={portraitSrc}
                        alt=""
                        onError={() => setPortraitOk(false)}
                    />
                </div>
            )}
            <div className="keeper-dialogue-body">
                <div className="keeper-dialogue-namerow">
                    <span className="keeper-dialogue-name">{speakerName}</span>
                    {badge}
                </div>
                <div
                    className="keeper-dialogue-text"
                    onClick={onBodyClick}
                    role={onBodyClick ? "button" : undefined}
                    tabIndex={onBodyClick ? 0 : undefined}
                    onKeyDown={onBodyClick
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                onBodyClick();
                            }
                        }
                        : undefined}
                >
                    <p aria-hidden={srText ? "true" : undefined}>
                        {body}
                        {showCaret && !dots && <span className="voice-caret" />}
                        {dots && <TypingDots />}
                    </p>
                    {srText !== undefined && <p className="sr-only" aria-live="polite">{srText}</p>}
                </div>
                {children && <div className="keeper-dialogue-choices">{children}</div>}
            </div>
            {onContinue && (
                <button
                    className="keeper-arrow-coin"
                    onClick={onContinue}
                    aria-label={continueLabel}
                    title={continueLabel}
                />
            )}
        </div>
    );
}

function cssUrl(url: string | undefined): string {
    return url ? `url("${url}")` : "none";
}
