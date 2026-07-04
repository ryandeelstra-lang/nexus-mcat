// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the aim indicator's label — the short MCAT concept name (+ due/new
// count) shown above the plot the watering can targets, so "water here → these
// questions" is legible at the moment of pouring. Presentation-only; reads the
// mastery snapshot, never writes. Full AAMC leaf labels run to 117 chars, so we
// hand-author short names (≤ 24 chars) keyed by sidecar nodeId.
import type { TopicMastery } from "../state/mastery";

/** Sidecar leaf nodeId → short display name (≤ 24 chars). One per corpus leaf. */
export const SHORT_CONCEPT_NAMES: Record<string, string> = {
    // B-B — Biological & Biochemical Foundations
    "BB.1A": "Proteins & Amino Acids",
    "BB.1B": "Gene to Protein",
    "BB.1C": "Genetics & Heredity",
    "BB.1D": "Metabolism & Energy",
    "BB.2A": "Cells & Assemblies",
    "BB.2B": "Microbes & Viruses",
    "BB.2C": "Cell Division",
    "BB.3A": "Nervous & Endocrine",
    "BB.3B": "Organ Systems",
    // C-P — Chemical & Physical Foundations
    "CP.4A": "Mechanics & Energy",
    "CP.4B": "Fluids & Gas Exchange",
    "CP.4C": "Circuits & Electrochem",
    "CP.4D": "Light & Sound",
    "CP.4E": "Atomic Structure",
    "CP.5A": "Water & Solutions",
    "CP.5B": "Molecular Interactions",
    "CP.5C": "Separation Methods",
    "CP.5D": "Biological Molecules",
    "CP.5E": "Thermo & Kinetics",
    // P-S — Psychological, Social & Biological Foundations
    "PS.6A": "Sensing the Environment",
    "PS.6B": "Perception & Cognition",
    "PS.6C": "Responding to the World",
    "PS.7A": "Individual Behavior",
    "PS.7B": "Social Behavior",
    "PS.7C": "Attitude Change",
    "PS.8A": "Self-Identity",
    "PS.8B": "Social Thinking",
    "PS.8C": "Social Interactions",
    "PS.9A": "Social Structure",
    "PS.9B": "Demographics",
    "PS.10A": "Social Inequality",
    // CARS — Critical Analysis & Reasoning Skills
    "CARS.FOC": "Comprehension",
    "CARS.RW": "Reasoning Within Text",
    "CARS.RB": "Reasoning Beyond Text",
};

/** The short name for a plot's concept: authored map, else the full label
 * truncated to 24 chars (…), else the raw nodeId. */
export function shortConceptName(nodeId: string, fullLabel?: string): string {
    const authored = SHORT_CONCEPT_NAMES[nodeId];
    if (authored !== undefined) {
        return authored;
    }
    if (fullLabel !== undefined && fullLabel.length > 0) {
        return fullLabel.length > 24 ? `${fullLabel.slice(0, 23)}…` : fullLabel;
    }
    return nodeId;
}

/** The floating-label text for the aimed plot: name, "name · N due", or
 * "name · N new". Counts drop off when the mastery snapshot isn't loaded. */
export function aimLabelText(
    nodeId: string,
    topic: TopicMastery | undefined,
    fullLabel?: string,
): string {
    const name = shortConceptName(nodeId, topic?.label ?? fullLabel);
    if (topic && topic.dueCount > 0) {
        return `${name} · ${topic.dueCount} due`;
    }
    if (topic && topic.newCount > 0) {
        return `${name} · ${topic.newCount} new`;
    }
    return name;
}
