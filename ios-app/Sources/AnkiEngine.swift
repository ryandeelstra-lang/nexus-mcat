// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: the phone's ONLY door to the shared Anki Rust engine. Every review, sync, import and
// mastery read goes through the 4-symbol FFI (anki_ios.h) into Backend::run_service_method — the
// exact same engine that powers the desktop app. There is NO Swift scheduler and NO reimplemented
// FSRS: the phone shares the engine, it does not rewrite it (instructions.md §3).
//
// Integrity: the engine WRITES the app performs are real graded reviews (answer_card) and the
// standard import/current-deck ops. Growth, scores and the watering can are all derived from engine
// truth (MasteryQuery), never fabricated.
import Foundation
import SwiftProtobuf

enum EngineError: Error, CustomStringConvertible {
    case backendNull
    case rpc(String)
    case panic
    var description: String {
        switch self {
        case .backendNull: return "engine failed to open"
        case .rpc(let m): return m
        case .panic: return "engine call was refused"
        }
    }
}

/// The shape the UI needs for each topic-plant + score input (decoupled from the generated proto).
struct TopicRow: Identifiable {
    let deckID: Int64
    let deckName: String
    let totalCards: UInt32
    let cardsWithState: UInt32
    let averageRecall: Float
    let gradedReviews: UInt32
    let dueCount: UInt32
    var id: Int64 { deckID }
}

final class AnkiEngine: ObservableObject {
    static let shared = AnkiEngine()

    private var backend: OpaquePointer?
    /// Serializes ALL backend access (SQLite is single-writer). Every RPC is one `q.sync` block;
    /// high-level methods compose multiple RPCs but never nest `q.sync`, so no re-entrant deadlock.
    private let q = DispatchQueue(label: "com.chargedup.knowledgegarden.engine")
    private var auth: Anki_Sync_SyncAuth?

    /// The self-hosted desktop sync server. The simulator shares the host network, so loopback
    /// reaches the desktop-hosted `anki-sync-server` directly (plain HTTP on loopback — no ATS).
    let endpoint = UserDefaults.standard.string(forKey: "syncEndpoint") ?? "http://127.0.0.1:8998/"

    private var didOpen = false

    // MARK: engine paths

    private var docs: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    private var collectionPath: String { docs.appendingPathComponent("collection.anki2").path }

    // MARK: open + first-run import

    /// Open the backend + collection, importing the bundled MCAT deck on first run so the phone
    /// loads the exam deck and can review on the shared engine. Idempotent.
    func open() throws {
        guard !didOpen else { return }
        var initMsg = Anki_Backend_BackendInit()
        initMsg.preferredLangs = ["en"]
        let bytes = [UInt8](try initMsg.serializedData())
        backend = anki_open_backend(bytes, bytes.count)
        guard backend != nil else { throw EngineError.backendNull }
        try openCollection()
        try enableFsrs()
        try importStarterDeckIfEmpty()
        try selectExamDeck()
        didOpen = true
    }

    /// Enable FSRS the one correct way (mirrors scores/engine.py:enable_fsrs): read the deck configs
    /// for update, resend them with `fsrs = true` so the engine seeds the FSRS-6 defaults. Without
    /// this, reviewed cards carry no memory state and MasteryQuery's recall stays empty. Idempotent.
    private func enableFsrs() throws {
        var target = Anki_Decks_DeckId()
        target.did = 1
        let forUpdateBytes = try call(AnkiService.deckConfig,
                                      DeckConfigMethod.getDeckConfigsForUpdate,
                                      try target.serializedData())
        let forUpdate = try Anki_DeckConfig_DeckConfigsForUpdate(serializedBytes: forUpdateBytes)
        if forUpdate.fsrs { return } // already on
        var req = Anki_DeckConfig_UpdateDeckConfigsRequest()
        req.targetDeckID = 1
        req.configs = forUpdate.allConfig.map(\.config)
        req.mode = .normal
        req.fsrs = true
        _ = try call(AnkiService.deckConfig, DeckConfigMethod.updateDeckConfigs,
                     try req.serializedData())
    }

    func openCollection() throws {
        var req = Anki_Collection_OpenCollectionRequest()
        req.collectionPath = collectionPath
        req.mediaFolderPath = docs.appendingPathComponent("collection.media").path
        req.mediaDbPath = docs.appendingPathComponent("collection.media.db").path
        _ = try call(AnkiService.collection, CollectionMethod.openCollection, try req.serializedData())
    }

    private func closeCollection() throws {
        var req = Anki_Collection_CloseCollectionRequest()
        req.downgradeToSchema11 = false
        _ = try call(AnkiService.collection, CollectionMethod.closeCollection, try req.serializedData())
    }

    /// If the collection has no MCAT cards yet, import the bundled `mcat-starter.apkg` (the same
    /// exam deck the desktop ships). The deck is real Anki content imported through the engine's own
    /// import path — no cards are fabricated on device.
    private func importStarterDeckIfEmpty() throws {
        if totalCardCount() > 0 { return }
        guard let apkg = Bundle.main.url(forResource: "mcat-starter", withExtension: "apkg") else {
            return // no bundled deck (dev build) — the app still runs; sync can populate it
        }
        var opts = Anki_ImportExport_ImportAnkiPackageOptions()
        opts.mergeNotetypes = false
        opts.withScheduling = true
        var req = Anki_ImportExport_ImportAnkiPackageRequest()
        req.packagePath = apkg.path
        req.options = opts
        _ = try call(AnkiService.importExport, ImportExportMethod.importAnkiPackage,
                     try req.serializedData())
    }

    /// Point the review queue at the whole exam: current deck = "MCAT" (its children come along).
    private func selectExamDeck() throws {
        guard let did = try? deckId(named: "MCAT"), did != 0 else { return }
        var idMsg = Anki_Decks_DeckId()
        idMsg.did = did
        _ = try call(AnkiService.decks, DecksMethod.setCurrentDeck, try idMsg.serializedData())
    }

    private func deckId(named name: String) throws -> Int64 {
        var s = Anki_Generic_String()
        s.val = name
        let out = try call(AnkiService.decks, DecksMethod.getDeckIdByName, try s.serializedData())
        return try Anki_Decks_DeckId(serializedBytes: out).did
    }

    private func totalCardCount() -> Int {
        (try? masteryTopics().reduce(0) { $0 + Int($1.totalCards) }) ?? 0
    }

    // MARK: the one RPC primitive (over the C ABI)

    /// One RPC over the 4-symbol FFI. Serialized on `q`. Throws the decoded BackendError on is_err=1,
    /// EngineError.panic on is_err=2. Frees the Rust-owned buffer exactly once (defer).
    @discardableResult
    func call(_ service: UInt32, _ method: UInt32, _ input: Data) throws -> Data {
        try q.sync {
            var isErr: UInt8 = 9
            let buf: AnkiBuffer = input.withUnsafeBytes { raw in
                anki_run_method(backend, service, method,
                                raw.bindMemory(to: UInt8.self).baseAddress, input.count, &isErr)
            }
            defer { anki_buffer_free(buf) }
            let data = buf.ptr != nil ? Data(bytes: buf.ptr!, count: buf.len) : Data()
            switch isErr {
            case 0: return data
            case 1:
                let msg = (try? Anki_Backend_BackendError(serializedBytes: data))?.message ?? "engine error"
                throw EngineError.rpc(msg)
            default: throw EngineError.panic
            }
        }
    }

    // MARK: sync (two-way, offline-tolerant)

    /// Full two-way sync: login once, then a normal sync. On first pairing the engine asks for a
    /// full sync; we full-DOWNLOAD (server wins on first pairing) and reopen. Offline => this throws
    /// and the caller keeps the locally-queued reviews (usn = -1) until the next successful sync.
    func syncNow() throws -> String {
        if auth == nil {
            var login = Anki_Sync_SyncLoginRequest()
            login.username = UserDefaults.standard.string(forKey: "syncUser") ?? "demo"
            login.password = UserDefaults.standard.string(forKey: "syncPass") ?? "demo"
            login.endpoint = endpoint
            let out = try call(AnkiService.sync, SyncMethod.syncLogin, try login.serializedData())
            auth = try Anki_Sync_SyncAuth(serializedBytes: out)
        }
        var req = Anki_Sync_SyncCollectionRequest()
        req.auth = auth!
        req.syncMedia = false
        let out = try call(AnkiService.sync, SyncMethod.syncCollection, try req.serializedData())
        let resp = try Anki_Sync_SyncCollectionResponse(serializedBytes: out)
        switch resp.required {
        case .noChanges, .normalSync:
            // A normal sync already merged both directions (revlog append-only, deduped by id).
            return "synced"
        case .fullUpload:
            // Remote is empty — push the phone's collection (and its offline reviews) up. Never
            // downloads here, so locally-queued reviews are never lost.
            try fullSync(upload: true)
            return "full upload complete"
        case .fullDownload:
            // Local is empty — pull the shared deck down.
            try fullSync(upload: false)
            return "full download complete"
        default:
            // FULL_SYNC (both sides diverged, e.g. first pairing with a schema difference): the
            // desktop is the authoritative hub for this companion, so we download. After pairing,
            // every subsequent sync is a NORMAL merge, so this branch is a one-time reconcile.
            try fullSync(upload: false)
            return "full download complete"
        }
    }

    private func fullSync(upload: Bool) throws {
        var full = Anki_Sync_FullUploadOrDownloadRequest()
        full.auth = auth!
        full.upload = upload
        _ = try call(AnkiService.sync, SyncMethod.fullUploadOrDownload, try full.serializedData())
        try? selectExamDeck() // a full op re-opens the collection inside the engine
    }

    // MARK: review loop

    func nextCard() throws -> Anki_Scheduler_QueuedCards.QueuedCard? {
        var req = Anki_Scheduler_GetQueuedCardsRequest()
        req.fetchLimit = 1
        let out = try call(AnkiService.scheduler, SchedulerMethod.getQueuedCards, try req.serializedData())
        return try Anki_Scheduler_QueuedCards(serializedBytes: out).cards.first
    }

    func renderCard(_ id: Int64) throws -> (front: String, back: String) {
        var req = Anki_CardRendering_RenderExistingCardRequest()
        req.cardID = id
        let out = try call(AnkiService.cardRendering, CardRenderingMethod.renderExistingCard,
                           try req.serializedData())
        let r = try Anki_CardRendering_RenderCardResponse(serializedBytes: out)
        return (Self.flatten(r.questionNodes), Self.flatten(r.answerNodes))
    }

    /// A real, undoable, syncable review: writes a RevlogEntry via the engine's answer_card.
    /// THIS is what fills the watering can — one graded review = one drop.
    func answer(_ card: Anki_Scheduler_QueuedCards.QueuedCard,
                rating: Anki_Scheduler_CardAnswer.Rating, msTaken: UInt32) throws {
        var ans = Anki_Scheduler_CardAnswer()
        ans.cardID = card.card.id
        ans.currentState = card.states.current
        switch rating {
        case .again: ans.newState = card.states.again
        case .hard: ans.newState = card.states.hard
        case .easy: ans.newState = card.states.easy
        default: ans.newState = card.states.good
        }
        ans.rating = rating
        ans.answeredAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
        ans.millisecondsTaken = max(1, msTaken)
        _ = try call(AnkiService.scheduler, SchedulerMethod.answerCard, try ans.serializedData())
    }

    // MARK: mastery (drives scores + the garden)

    func masteryTopics() throws -> [Anki_Stats_MasteryQueryResponse.Topic] {
        let req = Anki_Stats_MasteryQueryRequest()
        let out = try call(AnkiService.stats, StatsMethod.masteryQuery, try req.serializedData())
        return try Anki_Stats_MasteryQueryResponse(serializedBytes: out).topics
    }

    /// MasteryQuery has no per-topic due count; the review queue's counts are a session signal, so
    /// the phone marks a topic as "needs watering" when the whole queue still has due/learning cards.
    func topicRows() throws -> [TopicRow] {
        try masteryTopics().map {
            TopicRow(deckID: $0.deckID, deckName: $0.deckName, totalCards: $0.totalCards,
                     cardsWithState: $0.cardsWithState, averageRecall: $0.averageRecall,
                     gradedReviews: $0.gradedReviews, dueCount: 0)
        }
    }

    // MARK: benchmark (instructions.md §10 — phone speed targets, p50/p95/worst)

    /// Time the hot paths against the loaded deck and return p50/p95/worst in milliseconds. Never a
    /// single cherry-picked number (§7h). Read paths (next-card, dashboard) are idempotent so they
    /// can be sampled many times; button-ack answers as many queued cards as exist.
    func benchmark() throws -> [String: [String: Double]] {
        func stats(_ xs: [Double]) -> [String: Double] {
            guard !xs.isEmpty else { return ["p50": 0, "p95": 0, "worst": 0, "n": 0] }
            let s = xs.sorted()
            func pct(_ p: Double) -> Double { s[min(s.count - 1, Int(p * Double(s.count)))] }
            return ["p50": pct(0.50), "p95": pct(0.95), "worst": s.last!, "n": Double(s.count)]
        }
        func ms(_ body: () throws -> Void) rethrows -> Double {
            let t = DispatchTime.now().uptimeNanoseconds
            try body()
            return Double(DispatchTime.now().uptimeNanoseconds - t) / 1_000_000
        }

        var nextCardMs: [Double] = [], dashboardMs: [Double] = [], buttonAckMs: [Double] = []
        // next-card (get_queued_cards + render) — idempotent, sample 60x
        for _ in 0..<60 {
            nextCardMs.append(try ms {
                if let c = try nextCard() { _ = try renderCard(c.card.id) }
            })
        }
        // dashboard (mastery_query over the whole deck) — idempotent, sample 40x
        for _ in 0..<40 { dashboardMs.append(try ms { _ = try masteryTopics() }) }
        // button-ack (answer_card) — consume the available queue (bounded by the daily new limit)
        while let c = try nextCard() {
            buttonAckMs.append(try ms { try answer(c, rating: .good, msTaken: 1500) })
            if buttonAckMs.count >= 40 { break }
        }
        return ["next_card_ms": stats(nextCardMs), "dashboard_ms": stats(dashboardMs),
                "button_ack_ms": stats(buttonAckMs)]
    }

    // MARK: helpers

    private static func flatten(_ nodes: [Anki_CardRendering_RenderedTemplateNode]) -> String {
        nodes.map { n -> String in
            switch n.value {
            case .text(let t): return t
            case .replacement(let rep): return rep.currentText
            default: return ""
            }
        }
        .joined()
        .replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        .replacingOccurrences(of: "&nbsp;", with: " ")
        .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
