// charged_up: React root for the Knowledge Garden (Decision 41). The .svelte page calls
// mountGarden(); everything below this line is React.
import React from "react";
import { createRoot } from "react-dom/client";

import { GardenApp } from "./GardenApp";
import { GardenErrorBoundary } from "./panels/GardenErrorBoundary";

export function mountGarden(host: HTMLElement): () => void {
    const root = createRoot(host);
    // The root boundary is the last line of defense: even a shell/boot throw shows a calm
    // card instead of an empty host (createRoot un-mounts the whole tree on an uncaught error).
    root.render(
        React.createElement(GardenErrorBoundary, { label: "app" }, React.createElement(GardenApp)),
    );
    return () => root.unmount();
}
