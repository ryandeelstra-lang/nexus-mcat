# Voice bench fixtures

`answer5s.wav` — a ~5s spoken-answer recording used by `scripts/bench_voice.py` to bench
local faster-whisper STT (voice spec §10, STT p95 < 2500ms). Not committed (binary + voice
audio); record once on the dev machine (any ~5s clip of a spoken flashcard answer) and drop
it here. The bench skips the STT stage honestly when the fixture is absent.
