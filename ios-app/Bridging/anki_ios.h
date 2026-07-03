/* Copyright: Ankitects Pty Ltd and contributors
   License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

   The 4-symbol charged_up iOS FFI ABI — mirrors anki-ios/lib.rs EXACTLY. Buffer ownership is
   Rust's: every AnkiBuffer returned by anki_run_method MUST be released with anki_buffer_free
   (never C free()). AnkiBuffer's #[repr(C)] layout is the ABI contract; keep this struct in sync
   with the Rust one (its fields are `pub` so this header can name them). */
#ifndef ANKI_IOS_H
#define ANKI_IOS_H

#include <stddef.h>
#include <stdint.h>

typedef struct AnkiBuffer {
    uint8_t *ptr;
    size_t len;
    size_t cap;
} AnkiBuffer;

typedef struct AnkiBackend AnkiBackend; /* opaque handle from anki_open_backend */

/* Open a backend from protobuf BackendInit bytes. Returns NULL on error or panic. */
AnkiBackend *anki_open_backend(const uint8_t *in_ptr, size_t in_len);

/* Run one (service, method) with protobuf `input`; returns the response bytes.
   *is_err: 0 = ok, 1 = backend returned a (protobuf) error in the buffer, 2 = panic (buffer empty). */
AnkiBuffer anki_run_method(AnkiBackend *backend, uint32_t service, uint32_t method,
                           const uint8_t *in_ptr, size_t in_len, uint8_t *is_err);

/* Free a buffer returned by anki_run_method (exact capacity). */
void anki_buffer_free(AnkiBuffer buf);

/* Close and free a backend from anki_open_backend. */
void anki_close_backend(AnkiBackend *backend);

#endif /* ANKI_IOS_H */
