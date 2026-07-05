// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the garden's safety net (2026-07-03). React's createRoot un-mounts the ENTIRE
// root on any uncaught render error — with no boundary, one panel throwing blanks the whole
// game, canvas included ("the entire game just disappeared"). This boundary catches the throw,
// logs it, and shows a calm in-world card the player can retry/reload from, while the Phaser
// world underneath keeps running. (It cannot catch a native renderer-process crash — see the
// exam-date fix in placement.ts — but it stops every JS-level panel fault from taking the
// garden down.)
import React from "react";

interface Props {
    children: React.ReactNode;
    /** Where the boundary sits, for the console log ("panels", "app"). */
    label?: string;
}

interface State {
    error: Error | null;
}

export class GardenErrorBoundary extends React.Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        console.error(
            `[garden] error boundary (${this.props.label ?? "unknown"}) caught:`,
            error,
            info.componentStack,
        );
    }

    private readonly reset = (): void => {
        this.setState({ error: null });
    };

    render(): React.ReactNode {
        if (this.state.error) {
            return (
                <div className="garden-overlay keeper-overlay" role="alert">
                    <div className="keeper-panel-shell garden-error-card">
                        <h2>The garden hit a snag 🌧️</h2>
                        <p>
                            Something in this panel stumbled — but your garden is safe and nothing was lost. Try again,
                            or reload to return to solid ground.
                        </p>
                        <div className="keeper-actions">
                            <button className="keeper-reveal" onClick={this.reset}>
                                Try again
                            </button>
                            <button
                                className="hud-ghost-button"
                                onClick={() => globalThis.location.reload()}
                            >
                                Reload the garden
                            </button>
                        </div>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
