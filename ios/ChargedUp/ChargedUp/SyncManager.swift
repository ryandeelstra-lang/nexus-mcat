// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// SyncManager — sign-in (Phase 3) + two-way sync (Phase 4) over the shared Rust engine.
// An "account" here is an Anki sync account on the SELF-HOSTED anki-sync-server; connecting
// desktop + mobile = both clients log in with the SAME credentials against the SAME server
// URL, so they share one collection. This file invents no bespoke auth: SyncLogin /
// SyncCollection / FullUploadOrDownload are stock engine RPCs, called over the FFI.

import Foundation
import SwiftProtobuf

/// Serializes all AnkiBridge calls onto one background queue (AnkiBridge is not reentrant).
/// `@unchecked Sendable` is sound because every access is funneled through `queue`.
final class Engine: @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.chargedup.engine")
    private var bridge: AnkiBridge?

    func perform<T>(_ body: @escaping (AnkiBridge) throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                do {
                    if self.bridge == nil { self.bridge = try AnkiBridge() }
                    continuation.resume(returning: try body(self.bridge!))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}

@MainActor
final class SyncManager: ObservableObject {
    /// Default server URL — set this to match the desktop's Preferences → Syncing →
    /// "self-hosted sync server" (customSyncUrl). See docs/mcat/DESKTOP-CONNECT.md.
    static let defaultServerURL = "http://127.0.0.1:27701/"

    @Published var isLoggedIn: Bool
    @Published var statusMessage: String = ""
    @Published var isBusy: Bool = false

    let engine = Engine()
    let collectionURL: URL

    private let defaults = UserDefaults.standard

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        collectionURL = docs.appendingPathComponent("collection.anki2")
        isLoggedIn = Keychain.get(account: "hkey") != nil
    }

    // MARK: - persisted config

    var serverURL: String {
        get { defaults.string(forKey: "serverURL") ?? Self.defaultServerURL }
        set { defaults.set(newValue, forKey: "serverURL") }
    }

    var username: String {
        get { defaults.string(forKey: "username") ?? "" }
        set { defaults.set(newValue, forKey: "username") }
    }

    private var hkey: String? { Keychain.get(account: "hkey") }

    private func authProto() -> Anki_Sync_SyncAuth {
        var auth = Anki_Sync_SyncAuth()
        auth.hkey = hkey ?? ""
        auth.endpoint = serverURL
        return auth
    }

    // MARK: - collection lifecycle

    /// Open the collection, copying the bundled MCAT seed deck into the sandbox on first run
    /// so the phone starts with the same exam deck as the desktop.
    func openCollection() async throws {
        let fm = FileManager.default
        if !fm.fileExists(atPath: collectionURL.path) {
            if let seed = Bundle.main.url(forResource: "collection", withExtension: "anki2") {
                try fm.copyItem(at: seed, to: collectionURL)
            }
        }
        let mediaDir = collectionURL.deletingLastPathComponent().appendingPathComponent("collection.media")
        try? fm.createDirectory(at: mediaDir, withIntermediateDirectories: true)

        var request = Anki_Collection_OpenCollectionRequest()
        request.collectionPath = collectionURL.path
        request.mediaFolderPath = mediaDir.path
        request.mediaDbPath = collectionURL.deletingLastPathComponent()
            .appendingPathComponent("collection.media.db").path
        try await engine.perform { bridge in
            try bridge.callVoid(
                service: ServiceIndices.BackendCollectionService.index,
                method: ServiceIndices.BackendCollectionService.openCollection,
                request
            )
        }
    }

    // MARK: - Phase 3: sign-in

    func login(username: String, password: String, serverURL: String) async throws {
        isBusy = true
        defer { isBusy = false }
        self.username = username
        self.serverURL = serverURL

        var request = Anki_Sync_SyncLoginRequest()
        request.username = username
        request.password = password
        request.endpoint = serverURL

        let auth: Anki_Sync_SyncAuth = try await engine.perform { bridge in
            try bridge.call(
                service: ServiceIndices.BackendSyncService.index,
                method: ServiceIndices.BackendSyncService.syncLogin,
                request
            )
        }
        guard !auth.hkey.isEmpty else { throw AnkiError.backend("empty host key from SyncLogin") }
        Keychain.set(auth.hkey, account: "hkey")
        isLoggedIn = true
        statusMessage = "Signed in as \(username)"
    }

    func signOut() {
        Keychain.delete(account: "hkey")
        isLoggedIn = false
        statusMessage = "Signed out"
    }

    #if DEBUG
    /// TEST-ONLY sign-in used by the screenshot harness. Runs only when the app is launched
    /// with the `-uitestAutologin 1` argument (which nothing but the harness passes), and is
    /// compiled out entirely of release builds by `#if DEBUG` — so it can never auto-sign-in a
    /// real user. Mirrors LoginView.signIn (login → open → sync) with the demo/demo dev account.
    func debugAutologinIfRequested() async {
        guard ProcessInfo.processInfo.arguments.contains("-uitestAutologin") else { return }
        guard !isLoggedIn else { return }
        do {
            try await login(username: "demo", password: "demo", serverURL: Self.defaultServerURL)
            try await openCollection()
            try await sync()
        } catch {
            statusMessage = "autologin failed: \(String(describing: error))"
        }
    }
    #endif

    // MARK: - Phase 4: two-way sync

    /// A normal (bidirectional) sync; on a brand-new collection it performs the required
    /// full up/down first. Offline reviews queued locally (usn = -1) flush on the next call.
    func sync() async throws {
        isBusy = true
        defer { isBusy = false }
        statusMessage = "Syncing…"

        var request = Anki_Sync_SyncCollectionRequest()
        request.auth = authProto()
        request.syncMedia = false

        let response: Anki_Sync_SyncCollectionResponse = try await engine.perform { bridge in
            try bridge.call(
                service: ServiceIndices.BackendSyncService.index,
                method: ServiceIndices.BackendSyncService.syncCollection,
                request
            )
        }

        switch response.required {
        case .noChanges, .normalSync:
            statusMessage = "Up to date"
        case .fullUpload, .fullSync:
            try await fullUpOrDown(upload: true)
            statusMessage = "Uploaded"
        case .fullDownload:
            try await fullUpOrDown(upload: false)
            statusMessage = "Downloaded"
        case .UNRECOGNIZED(let raw):
            throw AnkiError.backend("unknown sync requirement \(raw)")
        }
    }

    private func fullUpOrDown(upload: Bool) async throws {
        var request = Anki_Sync_FullUploadOrDownloadRequest()
        request.auth = authProto()
        request.upload = upload
        try await engine.perform { bridge in
            try bridge.callVoid(
                service: ServiceIndices.BackendSyncService.index,
                method: ServiceIndices.BackendSyncService.fullUploadOrDownload,
                request
            )
        }
    }
}
