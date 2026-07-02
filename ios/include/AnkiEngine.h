// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// charged_up iOS FFI — C declarations for the 4-symbol, panic-safe extern "C" ABI
// exported by the `anki-ios` staticlib (see anki-ios/lib.rs). This header is the
// contract Swift imports (as the `AnkiEngineFFI` clang module, see module.modulemap)
// to call the shared Rust engine. Keep it byte-for-byte in sync with anki-ios/lib.rs.

#ifndef ANKI_ENGINE_H
#define ANKI_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// A Rust-owned byte buffer handed to the caller. The caller MUST copy the bytes
// out and then release it with `anki_buffer_free` (which frees with the exact
// capacity). Swift must NEVER call C `free()` on `ptr`.
typedef struct AnkiBuffer {
  uint8_t *ptr;
  size_t len;
  size_t cap;
} AnkiBuffer;

// Opaque handle to a Rust `anki::backend::Backend`. Only ever passed back to the
// functions below; never dereferenced by the caller.
typedef struct Backend Backend;

// Open a backend from protobuf `anki.backend.BackendInit` bytes (may be NULL/0 for
// defaults). Returns NULL on error or a caught panic.
Backend *anki_open_backend(const uint8_t *in_ptr, size_t in_len);

// Run one service/method with protobuf `input`; returns the response bytes.
// `*is_err` is set to 0 on success, 1 if the backend returned a protobuf-encoded
// error in the buffer, or 2 if a panic was caught (buffer empty). A NULL `backend`
// fails closed to is_err=2 / empty buffer.
AnkiBuffer anki_run_method(Backend *backend, uint32_t service, uint32_t method,
                           const uint8_t *in_ptr, size_t in_len, uint8_t *is_err);

// Free a buffer returned by `anki_run_method`.
void anki_buffer_free(AnkiBuffer buf);

// Close and free a backend returned by `anki_open_backend`.
void anki_close_backend(Backend *backend);

#ifdef __cplusplus
}
#endif

#endif // ANKI_ENGINE_H
