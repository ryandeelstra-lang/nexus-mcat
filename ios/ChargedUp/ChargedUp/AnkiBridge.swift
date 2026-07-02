// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// AnkiBridge — the thin Swift wrapper over the 4-symbol Rust engine C ABI (AnkiEngineFFI,
// from ios/AnkiEngine.xcframework). Every engine call is: build a SwiftProtobuf request,
// serialize it, hand the bytes to `anki_run_method(service, method, ...)`, copy the result
// out of the Rust-owned AnkiBuffer, then `anki_buffer_free` it (NEVER C free()). Service /
// method indices come from the generated ServiceIndices.swift, never guessed.

import AnkiEngineFFI
import Foundation
import SwiftProtobuf

enum AnkiError: Error, CustomStringConvertible {
    case openFailed
    case notOpen
    /// The backend returned a protobuf-encoded error (is_err == 1).
    case backend(String)
    /// A Rust panic was caught at the FFI boundary (is_err == 2).
    case panic

    var description: String {
        switch self {
        case .openFailed: return "failed to open the Anki backend"
        case .notOpen: return "the Anki backend is not open"
        case .backend(let m): return "engine error: \(m)"
        case .panic: return "the engine panicked (caught at the FFI boundary)"
        }
    }
}

/// Owns one `*mut Backend`. Not thread-safe; confine calls to one actor/queue (SyncManager
/// serializes them). Reused for the whole app session, closed on deinit.
final class AnkiBridge {
    private var backend: OpaquePointer?

    init(preferredLangs: [String] = ["en"]) throws {
        var initMsg = Anki_Backend_BackendInit()
        initMsg.preferredLangs = preferredLangs
        initMsg.server = false
        let data = try initMsg.serializedData()
        backend = data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> OpaquePointer? in
            anki_open_backend(raw.bindMemory(to: UInt8.self).baseAddress, data.count)
        }
        guard backend != nil else { throw AnkiError.openFailed }
    }

    deinit {
        if let backend { anki_close_backend(backend) }
    }

    /// Raw call: bytes in, bytes out. Copies the response out of the Rust buffer and frees it.
    func run(service: UInt32, method: UInt32, input: Data) throws -> Data {
        guard let backend else { throw AnkiError.notOpen }
        var isErr: UInt8 = 0
        let buffer: AnkiBuffer = input.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> AnkiBuffer in
            anki_run_method(
                backend,
                service,
                method,
                raw.bindMemory(to: UInt8.self).baseAddress,
                input.count,
                &isErr
            )
        }
        // Copy out BEFORE freeing; the buffer is Rust-owned with its exact capacity.
        defer { anki_buffer_free(buffer) }
        let out: Data = buffer.ptr != nil ? Data(bytes: buffer.ptr, count: buffer.len) : Data()

        switch isErr {
        case 0:
            return out
        case 1:
            let message = (try? Anki_Backend_BackendError(serializedData: out).message) ?? "unknown"
            throw AnkiError.backend(message)
        default:
            throw AnkiError.panic
        }
    }

    /// Typed call: SwiftProtobuf request in, SwiftProtobuf response out.
    func call<Request: SwiftProtobuf.Message, Response: SwiftProtobuf.Message>(
        service: UInt32,
        method: UInt32,
        _ request: Request
    ) throws -> Response {
        let out = try run(service: service, method: method, input: try request.serializedData())
        return try Response(serializedData: out)
    }

    /// Call for RPCs whose response is `generic.Empty` (we ignore the bytes).
    @discardableResult
    func callVoid<Request: SwiftProtobuf.Message>(
        service: UInt32,
        method: UInt32,
        _ request: Request
    ) throws -> Data {
        try run(service: service, method: method, input: try request.serializedData())
    }
}
