// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// (service, method) coordinates for Backend.run_service_method — PINNED by the Rust test
// anki-ios/tests/service_indices.rs (which asserts each pair against the REAL generated dispatch
// table). NEVER edit a value here without re-running that test; the two must always agree.
//
// Invariant: BackendStatsService (and the other backend service lists) stay stable. Our one engine
// change (MasteryQuery) was appended to the previously-EMPTY BackendStatsService, so stats = 43 and
// every later delegating index is unmoved.
enum AnkiService {
    static let sync: UInt32 = 1            // backend-level SyncService
    static let collection: UInt32 = 3      // backend-level CollectionService
    static let decks: UInt32 = 7           // backend-level DecksService
    static let deckConfig: UInt32 = 11     // backend-level DeckConfigService
    static let scheduler: UInt32 = 13      // backend-level SchedulerService
    static let cardRendering: UInt32 = 27  // backend-level CardRenderingService
    static let importExport: UInt32 = 39   // backend-level ImportExportService
    static let stats: UInt32 = 43          // backend-level StatsService
}

enum SyncMethod {
    static let syncLogin: UInt32 = 3               // SyncLoginRequest -> SyncAuth
    static let syncStatus: UInt32 = 4              // SyncAuth -> SyncStatusResponse
    static let syncCollection: UInt32 = 5          // SyncCollectionRequest -> SyncCollectionResponse
    static let fullUploadOrDownload: UInt32 = 6    // FullUploadOrDownloadRequest -> ()
}

enum CollectionMethod {
    static let openCollection: UInt32 = 0          // OpenCollectionRequest -> ()
    static let closeCollection: UInt32 = 1         // CloseCollectionRequest -> ()
}

enum DecksMethod {
    static let getDeckIdByName: UInt32 = 7         // generic.String -> DeckId
    static let setCurrentDeck: UInt32 = 22         // DeckId -> OpChanges
}

enum DeckConfigMethod {
    static let getDeckConfigsForUpdate: UInt32 = 6 // decks.DeckId -> DeckConfigsForUpdate
    static let updateDeckConfigs: UInt32 = 7       // UpdateDeckConfigsRequest -> OpChanges
}

enum SchedulerMethod {
    static let getQueuedCards: UInt32 = 3          // GetQueuedCardsRequest -> QueuedCards
    static let answerCard: UInt32 = 4              // CardAnswer -> OpChanges
}

enum CardRenderingMethod {
    static let renderExistingCard: UInt32 = 6      // RenderExistingCardRequest -> RenderCardResponse
}

enum ImportExportMethod {
    static let importAnkiPackage: UInt32 = 2       // ImportAnkiPackageRequest -> ImportResponse
}

enum StatsMethod {
    static let masteryQuery: UInt32 = 5            // MasteryQueryRequest -> MasteryQueryResponse
}
