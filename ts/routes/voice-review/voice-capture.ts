// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: browser microphone capture for the voice flashcards (doc 24 §7, option A).
// getUserMedia + MediaRecorder in the trusted VOICE_REVIEW webview (mic permission is granted
// server-side for that webview kind only — see qt/aqt/webview.py). The raw audio never touches
// disk on the client; we hand the recorded blob to the server as base64, which transcribes and
// discards it (discard-by-default, §5.6/AF-8). A type-answer fallback always exists (§15), so any
// failure here is non-fatal: the caller falls back to typing.

export interface Recording {
    base64: string;
    mime: string;
}

function pickMime(): string {
    const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg",
        "audio/mp4",
    ];
    const MR = (globalThis as unknown as { MediaRecorder?: typeof MediaRecorder })
        .MediaRecorder;
    if (MR && typeof MR.isTypeSupported === "function") {
        for (const c of candidates) {
            if (MR.isTypeSupported(c)) {
                return c;
            }
        }
    }
    return "audio/webm";
}

async function blobToBase64(blob: Blob): Promise<string> {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export function micSupported(): boolean {
    return (
        typeof navigator !== "undefined"
        && !!navigator.mediaDevices
        && typeof navigator.mediaDevices.getUserMedia === "function"
        && typeof (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder
            !== "undefined"
    );
}

/**
 * A tiny start/stop recorder. `start()` opens the mic and begins recording; `stop()` resolves with
 * the recorded audio as base64 (or throws if nothing was captured). The mic track is always
 * released on stop, so the OS mic indicator never lingers.
 */
export class MicRecorder {
    private recorder: MediaRecorder | null = null;
    private stream: MediaStream | null = null;
    private chunks: Blob[] = [];
    private mime = "audio/webm";

    async start(): Promise<void> {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.mime = pickMime();
        this.chunks = [];
        this.recorder = new MediaRecorder(this.stream, { mimeType: this.mime });
        this.recorder.ondataavailable = (e: BlobEvent) => {
            if (e.data && e.data.size > 0) {
                this.chunks.push(e.data);
            }
        };
        this.recorder.start();
    }

    get active(): boolean {
        return this.recorder !== null && this.recorder.state === "recording";
    }

    private release(): void {
        if (this.stream) {
            for (const track of this.stream.getTracks()) {
                track.stop();
            }
        }
        this.stream = null;
        this.recorder = null;
    }

    async stop(): Promise<Recording> {
        const recorder = this.recorder;
        if (!recorder) {
            this.release();
            throw new Error("not recording");
        }
        const mime = this.mime;
        const done = new Promise<Recording>((resolve, reject) => {
            recorder.onstop = async () => {
                try {
                    if (this.chunks.length === 0) {
                        reject(new Error("no audio captured"));
                        return;
                    }
                    const blob = new Blob(this.chunks, { type: mime });
                    resolve({ base64: await blobToBase64(blob), mime });
                } catch (err) {
                    reject(err);
                }
            };
        });
        recorder.stop();
        try {
            return await done;
        } finally {
            this.release();
        }
    }

    cancel(): void {
        try {
            if (this.recorder && this.recorder.state !== "inactive") {
                this.recorder.stop();
            }
        } catch {
            // ignore — we only care that the mic is released
        }
        this.release();
    }
}
