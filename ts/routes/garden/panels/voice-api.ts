// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: typed client for the voice-Keeper endpoints (voice-Keeper spec §4). Mirrors
// the gardenState transport (mediasrv JSON POST, application/binary content type). The
// server owns correctness, card binding, and the attempt ladder; this layer only shapes
// payloads (snake_case wire -> camelCase types) and converts the server's v3 ease (1-4)
// to the client CardAnswer_Rating enum (0-3) in exactly one place.

export type VoiceBucket = "good" | "okay" | "ask_again" | "dont_know";

export interface SttInfo {
    available: boolean;
    local: boolean;
    hosted: boolean;
}

export interface VoiceNextCard {
    cardId: number;
    nodeId: string;
    keeperLine: string;
    isFreshVariant: boolean;
    counts: { new: number; learning: number; review: number };
}

export type VoiceNextResult =
    | { kind: "disabled" }
    | { kind: "unavailable" }
    | { kind: "done" }
    | { kind: "noVariant" }
    | { kind: "card"; card: VoiceNextCard; stt: SttInfo };

export interface VoiceGradeResult {
    bucket: VoiceBucket;
    score: number;
    method: "semantic" | "lexical";
    sentinel: string | null;
    transcript: string;
    correctAnswer: string;
    keyPointsHit: string[];
    keyPointsMissed: string[];
    rationale: string;
    /** Client-side CardAnswer_Rating (0-3), already converted from the server's 1-4. */
    rating: number;
    recovered: boolean;
    bloomed: boolean;
    isFreshVariant: boolean;
}

export type VoiceGradeOutcome =
    | { kind: "graded"; result: VoiceGradeResult }
    | { kind: "rePrompt"; keeperLine: string; hint: string; transcript: string; score: number }
    | { kind: "sttError"; message: string }
    | { kind: "error"; message: string };

/** The server applies v3 ease (AGAIN=1..EASY=4); the client enum is AGAIN=0..EASY=3. */
export function toClientRating(serverRating: number): number {
    return Math.max(0, Math.min(3, serverRating - 1));
}

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
    const resp = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/binary" },
        body: JSON.stringify(body ?? {}),
    });
    if (!resp.ok) {
        throw new Error(`${path} failed: ${resp.status}`);
    }
    const payload: unknown = await resp.json();
    if (typeof payload !== "object" || payload === null) {
        throw new Error(`${path}: malformed payload`);
    }
    return payload as Record<string, unknown>;
}

function toSttInfo(raw: unknown): SttInfo {
    const r = (raw ?? {}) as Record<string, unknown>;
    return {
        available: Boolean(r.available),
        local: Boolean(r.local),
        hosted: Boolean(r.hosted),
    };
}

export async function fetchNextVoiceCard(
    opts?: { preferVariant?: boolean },
): Promise<VoiceNextResult> {
    const p = await postJson("/_anki/audioReviewNext", {
        preferVariant: Boolean(opts?.preferVariant),
    });
    if (!p.available) {
        return { kind: "unavailable" };
    }
    if (p.enabled === false) {
        return { kind: "disabled" };
    }
    if (p.no_variant) {
        return { kind: "noVariant" };
    }
    if (p.done) {
        return { kind: "done" };
    }
    const counts = (p.counts ?? {}) as Record<string, unknown>;
    return {
        kind: "card",
        stt: toSttInfo(p.stt),
        card: {
            cardId: Number(p.card_id),
            nodeId: String(p.node_id ?? ""),
            keeperLine: String(p.keeper_line ?? ""),
            isFreshVariant: Boolean(p.is_fresh_variant),
            counts: {
                new: Number(counts.new ?? 0),
                learning: Number(counts.learning ?? 0),
                review: Number(counts.review ?? 0),
            },
        },
    };
}

export async function gradeVoiceAnswer(req: {
    cardId: number;
    idk?: boolean;
    msTaken?: number;
    transcript?: string;
    audioBase64?: string;
    audioMime?: string;
}): Promise<VoiceGradeOutcome> {
    const p = await postJson("/_anki/audioReviewGrade", {
        cardId: req.cardId,
        idk: Boolean(req.idk),
        msTaken: req.msTaken,
        transcript: req.transcript,
        audioBase64: req.audioBase64,
        audioMime: req.audioMime,
    });
    if (!p.available) {
        return { kind: "error", message: "voice review unavailable" };
    }
    if (typeof p.stt_error === "string" && p.stt_error) {
        return { kind: "sttError", message: p.stt_error };
    }
    if (p.applied === false && typeof p.error === "string") {
        return { kind: "error", message: p.error };
    }
    const rePrompt = p.re_prompt as Record<string, unknown> | undefined;
    if (p.applied === false && rePrompt) {
        return {
            kind: "rePrompt",
            keeperLine: String(rePrompt.keeper_line ?? ""),
            hint: String(rePrompt.hint ?? ""),
            transcript: String(p.transcript ?? ""),
            score: Number(p.score ?? 0),
        };
    }
    return {
        kind: "graded",
        result: {
            bucket: p.bucket as VoiceBucket,
            score: Number(p.score ?? 0),
            method: (p.method as "semantic" | "lexical") ?? "lexical",
            sentinel: (p.sentinel as string | null) ?? null,
            transcript: String(p.transcript ?? ""),
            correctAnswer: String(p.correct_answer ?? ""),
            keyPointsHit: (p.key_points_hit as string[]) ?? [],
            keyPointsMissed: (p.key_points_missed as string[]) ?? [],
            rationale: String(p.rationale ?? ""),
            rating: toClientRating(Number(p.rating ?? 1)),
            recovered: Boolean(p.recovered),
            bloomed: Boolean(p.bloomed),
            isFreshVariant: Boolean(p.is_fresh_variant),
        },
    };
}
