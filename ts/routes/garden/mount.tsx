// charged_up: React root for the Knowledge Garden (Decision 41). The .svelte page calls
// mountGarden(); everything below this line is React.
import React from "react";
import { createRoot } from "react-dom/client";

import { GardenApp } from "./GardenApp";

export function mountGarden(host: HTMLElement): () => void {
    const root = createRoot(host);
    root.render(React.createElement(GardenApp));
    return () => root.unmount();
}
