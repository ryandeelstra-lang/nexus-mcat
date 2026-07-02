// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up screenshot harness (test-only): build a binary anki.stats.MasteryQueryResponse so the
// knowledge-graph route can be rendered with mock "live" mastery, without an open collection.
//
// The fields KnowledgeGraph.svelte reads are Topic.deck_name (#2, string), Topic.cards_with_state
// (#4, uint32) and Topic.average_recall (#6, float), inside Response.topics (#1, repeated message).
// We hand-encode the protobuf wire format so the harness needs NO generated-proto import (keeps
// Playwright's loader + svelte-check happy and adds zero dependencies). The real client decodes these
// bytes with MasteryQueryResponse.fromBinary().

interface Topic {
    deck: string;
    cards: number;
    recall: number;
}

function varint(value: number): number[] {
    const out: number[] = [];
    let v = value >>> 0;
    while (v > 0x7f) {
        out.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    out.push(v);
    return out;
}

const tag = (fieldNo: number, wireType: number): number => (fieldNo << 3) | wireType;

function encodeTopic(t: Topic): number[] {
    const deck = Array.from(new TextEncoder().encode(t.deck));
    const f32 = new Uint8Array(4);
    new DataView(f32.buffer).setFloat32(0, t.recall, /* littleEndian */ true);
    return [
        tag(2, 2),
        ...varint(deck.length),
        ...deck, // deck_name
        tag(4, 0),
        ...varint(t.cards), // cards_with_state
        tag(6, 5),
        ...Array.from(f32), // average_recall (float32 LE)
    ];
}

function encodeMastery(topics: Topic[]): Buffer {
    const body: number[] = [];
    for (const t of topics) {
        const msg = encodeTopic(t);
        body.push(tag(1, 2), ...varint(msg.length), ...msg); // topics (repeated message)
    }
    return Buffer.from(body);
}

// The SvelteKit root layout awaits setupGlobalI18n() → i18nResources(), which decodes an
// anki.generic.Json { bytes json = 1 } and JSON.parses it as { resources, langs }. With no engine in
// the dev harness we must answer it with a valid (empty) payload, or the whole route render aborts.
export function i18nResourcesBytes(): Buffer {
    // One empty "en" FTL bundle — enough for firstLanguage()/direction() to resolve. The screens use
    // hardcoded English copy, so no real translations are needed.
    const payload = Array.from(
        new TextEncoder().encode(JSON.stringify({ resources: [""], langs: ["en"] })),
    );
    return Buffer.from([tag(1, 2), ...varint(payload.length), ...payload]);
}

// The 34 coverage leaves, verbatim from graph/sidecar.json (deck paths must match pathToId).
const LEAVES: string[] = [
    "MCAT::B-B::1A",
    "MCAT::B-B::1B",
    "MCAT::B-B::1C",
    "MCAT::B-B::1D",
    "MCAT::B-B::2A",
    "MCAT::B-B::2B",
    "MCAT::B-B::2C",
    "MCAT::B-B::3A",
    "MCAT::B-B::3B",
    "MCAT::C-P::4A",
    "MCAT::C-P::4B",
    "MCAT::C-P::4C",
    "MCAT::C-P::4D",
    "MCAT::C-P::4E",
    "MCAT::C-P::5A",
    "MCAT::C-P::5B",
    "MCAT::C-P::5C",
    "MCAT::C-P::5D",
    "MCAT::C-P::5E",
    "MCAT::P-S::6A",
    "MCAT::P-S::6B",
    "MCAT::P-S::6C",
    "MCAT::P-S::7A",
    "MCAT::P-S::7B",
    "MCAT::P-S::7C",
    "MCAT::P-S::8A",
    "MCAT::P-S::8B",
    "MCAT::P-S::8C",
    "MCAT::P-S::9A",
    "MCAT::P-S::9B",
    "MCAT::P-S::10A",
    "MCAT::CARS::Foundations of Comprehension",
    "MCAT::CARS::Reasoning Within the Text",
    "MCAT::CARS::Reasoning Beyond the Text",
];

// ~10 lit leaves with varied mid recall; the rest stay un-lit ghosts.
export function masteryPartial(): Buffer {
    const recalls = [0.72, 0.55, 0.41, 0.68, 0.6, 0.5, 0.45, 0.75, 0.52, 0.63];
    return encodeMastery(
        LEAVES.slice(0, recalls.length).map((deck, i) => ({ deck, cards: 25, recall: recalls[i] })),
    );
}

// Most leaves richly lit (0.86–0.96, deterministic) except one weak-but-prereqs-met node (B-B 2A),
// which becomes the deterministic best-next so the "start here" node pulses in the screenshot.
export function masteryRich(): Buffer {
    return encodeMastery(
        LEAVES.map((deck, i) => ({
            deck,
            cards: 40,
            recall: deck === "MCAT::B-B::2A" ? 0.52 : 0.86 + (i % 6) * 0.02,
        })),
    );
}
