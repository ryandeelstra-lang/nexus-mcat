// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

//! charged_up iOS FFI — a 4-symbol, panic-safe `extern "C"` ABI over Anki's single engine
//! entrypoint `Backend::run_service_method` (mirrors `pylib/rsbridge/lib.rs`). Swift builds the
//! request bytes with SwiftProtobuf (same service/method u32 indices), calls these symbols, copies
//! the result into `Data`, then MUST call `anki_buffer_free` (never C `free`). Buffer ownership is
//! Rust's: Rust allocates the `Vec`, the buffer carries its exact `len`+`cap`, Rust frees it.

use anki::backend::init_backend;
use anki::backend::Backend;
use std::panic::catch_unwind;

/// A Rust-owned byte buffer handed to Swift. Free it with `anki_buffer_free` (exact cap).
#[repr(C)]
pub struct AnkiBuffer {
    ptr: *mut u8,
    len: usize,
    cap: usize,
}

impl AnkiBuffer {
    fn from_vec(mut v: Vec<u8>) -> Self {
        let ptr = v.as_mut_ptr();
        let len = v.len();
        let cap = v.capacity();
        std::mem::forget(v); // ownership transfers to Swift; reclaimed via anki_buffer_free
        AnkiBuffer { ptr, len, cap }
    }
    fn empty() -> Self {
        AnkiBuffer {
            ptr: std::ptr::null_mut(),
            len: 0,
            cap: 0,
        }
    }
}

/// Open a backend from protobuf init bytes. Returns null on error or panic.
///
/// # Safety
/// `in_ptr` must point to `in_len` valid bytes, or be null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn anki_open_backend(in_ptr: *const u8, in_len: usize) -> *mut Backend {
    catch_unwind(|| {
        let input: &[u8] = if in_ptr.is_null() {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(in_ptr, in_len) }
        };
        match init_backend(input) {
            Ok(backend) => Box::into_raw(Box::new(backend)),
            Err(_) => std::ptr::null_mut(),
        }
    })
    .unwrap_or(std::ptr::null_mut())
}

/// Run one service/method with protobuf `input`; returns the response bytes.
/// `*is_err` is set to 0 on success, 1 if the backend returned a (protobuf) error in the buffer,
/// or 2 if a panic was caught (buffer empty).
///
/// # Safety
/// `backend` must be a pointer from `anki_open_backend`; `in_ptr`/`in_len` a valid slice or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn anki_run_method(
    backend: *mut Backend,
    service: u32,
    method: u32,
    in_ptr: *const u8,
    in_len: usize,
    is_err: *mut u8,
) -> AnkiBuffer {
    let outcome = catch_unwind(|| {
        let backend = unsafe { &*backend };
        let input: &[u8] = if in_ptr.is_null() {
            &[]
        } else {
            unsafe { std::slice::from_raw_parts(in_ptr, in_len) }
        };
        backend.run_service_method(service, method, input)
    });
    match outcome {
        Ok(Ok(out)) => {
            unsafe { *is_err = 0 };
            AnkiBuffer::from_vec(out)
        }
        Ok(Err(err_bytes)) => {
            unsafe { *is_err = 1 };
            AnkiBuffer::from_vec(err_bytes)
        }
        Err(_) => {
            unsafe { *is_err = 2 };
            AnkiBuffer::empty()
        }
    }
}

/// Free a buffer returned by `anki_run_method`.
///
/// # Safety
/// `buf` must have come from this library and not already been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn anki_buffer_free(buf: AnkiBuffer) {
    if !buf.ptr.is_null() {
        unsafe { drop(Vec::from_raw_parts(buf.ptr, buf.len, buf.cap)) };
    }
}

/// Close and free a backend from `anki_open_backend`.
///
/// # Safety
/// `backend` must have come from `anki_open_backend` and not already been closed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn anki_close_backend(backend: *mut Backend) {
    if !backend.is_null() {
        unsafe { drop(Box::from_raw(backend)) };
    }
}
