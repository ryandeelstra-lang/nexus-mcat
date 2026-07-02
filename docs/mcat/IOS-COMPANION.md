# iOS companion (ChargedUp) — architecture, build & run

> Ship "sign in + connect accounts across desktop and a mobile companion, with reviews
> syncing both ways" (instructions §3/§7b). The phone embeds the **shared Rust engine**
> through the existing C ABI (`anki-ios/lib.rs`) — it does **not** re-implement the scheduler
> in Swift. Same engine, same self-hosted sync, same three honest scores.

## Architecture

```
SwiftUI app (ios/ChargedUp)                 shared engine (rslib, Rust)
┌───────────────────────────┐   protobuf    ┌──────────────────────────────┐
│ LoginView / ReviewView /   │   bytes over  │ Backend::run_service_method   │
│ ScoresView                 │   4 C symbols │  (the ONE IPC entrypoint)     │
│   └ SyncManager (Engine)   │──────────────▶│   ├ SyncLogin / SyncCollection│
│       └ AnkiBridge  ───────┼──anki_run_────│   ├ OpenCollection            │
│           (AnkiEngineFFI)  │   method()    │   ├ GetQueuedCards/AnswerCard │
└───────────────────────────┘               │   └ MasteryQuery (fork RPC)   │
        │  SwiftProtobuf                      └──────────────┬───────────────┘
        │  ServiceIndices.swift (generated)                  │ rustls HTTPS / LAN HTTP
        ▼                                                    ▼
  ios/AnkiEngine.xcframework (device+sim staticlib)   anki-sync-server (self-hosted)
```

- **FFI:** the 4 panic-safe symbols `anki_open_backend / anki_run_method / anki_buffer_free /
  anki_close_backend` (`anki-ios/lib.rs`), mirroring `pylib/rsbridge`. Swift builds a
  SwiftProtobuf request, calls `anki_run_method(service, method, bytes)`, copies the result out
  of the Rust-owned `AnkiBuffer`, then frees it (never C `free()`).
- **(service, method) indices** are Anki codegen conventions (positional in the DescriptorPool),
  so they are **generated**, never guessed — `scripts/generate_service_indices.sh` →
  `ServiceIndices.swift`. The host-side test cross-checks the same values.
- **Sync** is stock Anki self-hosted sync; an "account" is an `anki-sync-server` account. Connect
  desktop+mobile = same credentials + same URL (see [DESKTOP-CONNECT.md](DESKTOP-CONNECT.md)).
- **Scores** reuse the engine's `MasteryQuery` for Memory; Performance/Readiness **abstain** with
  a stated give-up rule rather than fabricate a number (instructions §4 honesty rule).

## Files (all new, under `ios/`, `scripts/`, `tests/`)

| Path                                                                                                                     | Role                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `ios/include/AnkiEngine.h`, `module.modulemap`                                                                           | C ABI header + Clang module (`import AnkiEngineFFI`)                                         |
| `scripts/build_xcframework.sh`                                                                                           | build BOTH iOS slices, verify the 4-symbol/rustls ABI, assemble `ios/AnkiEngine.xcframework` |
| `scripts/service-index-dumper/` + `scripts/generate_service_indices.sh`                                                  | emit `ServiceIndices.swift` from Anki's DescriptorPool                                       |
| `scripts/generate_swift_protos.sh`                                                                                       | emit SwiftProtobuf message types from `proto/anki/*.proto`                                   |
| `ios/ChargedUp/project.yml`                                                                                              | XcodeGen spec → `ChargedUp.xcodeproj`                                                        |
| `ios/ChargedUp/ChargedUp/AnkiBridge.swift`                                                                               | thin wrapper over the 4 C symbols + protobuf                                                 |
| `…/SyncManager.swift`                                                                                                    | sign-in (SyncLogin→Keychain) + two-way sync (SyncCollection/full up-down)                    |
| `…/Keychain.swift`, `LoginView.swift`, `ReviewView.swift`, `ScoresView.swift`, `ContentView.swift`, `ChargedUpApp.swift` | UI + keychain                                                                                |
| `…/ServiceIndices.swift`                                                                                                 | GENERATED dispatch indices                                                                   |
| `…/Proto/*.pb.swift`                                                                                                     | GENERATED SwiftProtobuf types                                                                |
| `…/Resources/collection.anki2`                                                                                           | bundled MCAT seed deck (copied into the sandbox on first run)                                |
| `tests/sync/`                                                                                                            | the §7b host-side sync integration test (drives the C ABI ↔ server)                          |

## Build & run

```bash
# 0) one-time: bootstrap the toolchain + confirm the engine builds
just check

# 1) build the XCFramework (device + simulator; verifies exactly 4 _anki_ symbols, rustls-only)
scripts/build_xcframework.sh              # or: scripts/build_xcframework.sh --release

# 2) generate the FFI dispatch indices + the SwiftProtobuf types
scripts/generate_service_indices.sh
brew install swift-protobuf                # provides protoc-gen-swift (one-time)
scripts/generate_swift_protos.sh

# 3) drop in the seed deck (any MCAT .anki2; e.g. the desktop's generated seed)
cp <your-seed>.anki2 ios/ChargedUp/ChargedUp/Resources/collection.anki2

# 4) generate the Xcode project and open it
brew install xcodegen                      # one-time
(cd ios/ChargedUp && xcodegen generate)
open ios/ChargedUp/ChargedUp.xcodeproj
# then: select a simulator/device, Run (⌘R). Sign in with demo/demo + your server URL.

# 5) prove the sync contract (automated, host-side, no device needed)
#    start the server (see DESKTOP-CONNECT.md), then:
scripts/run_sync_test.sh
```

## Invariants held

- Additive / read-only w.r.t. collections except normal review + normal sync (Decision 19); no
  schema bump; no proto change (the app only _calls_ existing RPCs).
- `anki-ios` stays workspace-EXCLUDED; the new Rust helper crates (`scripts/service-index-dumper`,
  `tests/sync`) each carry their own `[workspace]` and build into `./target/*`, so `just check`'s
  unscoped `cargo --all` + `minilints` never touch them.
- Honesty: the phone never fabricates a readiness number — Memory is a real FSRS aggregate;
  Performance/Readiness abstain with the give-up rule.

## Human-gated (cannot be executed head-less here)

1. **Open Xcode & run** on a simulator/device (`xcodegen generate` → ⌘R). Free-Apple-ID sideload
   is fine (7-day provisioning) — no paid account needed.
2. **Generate `*.pb.swift`** requires `protoc-gen-swift` (brew) — a local install step.
3. **Screen-record** a phone review session on the shared engine, and a phone→desktop sync
   (review on phone → appears on desktop). This is the §6/§7b demo proof.
4. **Real device HTTPS/trust-store** sync against a real internet endpoint (the LAN path is plain
   HTTP; device TLS is the one thing the host-side test can't cover).
