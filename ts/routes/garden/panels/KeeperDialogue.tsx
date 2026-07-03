// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the indie/Zelda dialogue box for the Keeper (dialogue-UX plan §3). A cozy wooden
// frame with an optional Keeper portrait, a readable-font body that a caller crawls out
// character-by-character (with a blinking caret), a "reworded ✿" badge slot, and a bottom
// controls/"choices" row (children). Card content stays a readable font — NEVER a pixel font
// (doc 24 §5.7). This component is pure chrome: it owns no review logic and issues no network.
import React, { useEffect, useState } from "react";

export interface KeeperDialogueProps {
    /** Portrait image URL; hidden automatically if it fails to load. */
    portraitSrc?: string;
    /** The speaker's name shown above the line (e.g. "The Keeper"). */
    speakerName?: string;
    /** The visible dialogue body — typically a crawling substring the caller controls. */
    body: React.ReactNode;
    /** Full text mirrored into an sr-only aria-live node (AT can't read a char-crawl). */
    srText?: string;
    /** Show the blinking caret (while the crawl is still revealing). */
    showCaret?: boolean;
    /** Click anywhere on the text to skip the crawl. */
    onBodyClick?: () => void;
    /** Optional badge (e.g. the reworded-variant marker). */
    badge?: React.ReactNode;
    /** Extra class on the frame (bucket tone tint on the reply beat). */
    tone?: string;
    /** The controls / "choices" row rendered under the line. */
    children?: React.ReactNode;
}

/** The Keeper's dialogue box. Reused for every beat: ask, listen, thinking, and the graded reply. */
export function KeeperDialogue(props: KeeperDialogueProps): React.ReactElement {
    const {
        portraitSrc,
        speakerName = "The Keeper",
        body,
        srText,
        showCaret = false,
        onBodyClick,
        badge,
        tone,
        children,
    } = props;
    const [portraitOk, setPortraitOk] = useState(true);

    useEffect(() => {
        setPortraitOk(true);
    }, [portraitSrc]);

    return (
        <div className={`keeper-dialogue${tone ? ` ${tone}` : ""}`}>
            {portraitSrc && portraitOk && (
                <img
                    className="keeper-dialogue-portrait"
                    src={portraitSrc}
                    alt=""
                    onError={() => setPortraitOk(false)}
                />
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
                        {showCaret && <span className="voice-caret" />}
                    </p>
                    {srText !== undefined && <p className="sr-only" aria-live="polite">{srText}</p>}
                </div>
                {children && <div className="keeper-dialogue-choices">{children}</div>}
            </div>
        </div>
    );
}
