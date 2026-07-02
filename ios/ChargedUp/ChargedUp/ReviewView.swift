// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// ReviewView (Phase 4) — a real review session on the SHARED Rust engine: GetQueuedCards to
// pull the next due card, RenderExistingCard to render it with the engine's own templates,
// and AnswerCard to grade it. Reviews are written locally (usn = -1) whether or not the
// network is up, so "offline review" just means "don't sync yet"; the Sync button flushes
// them to the desktop when the connection returns.

import SwiftUI
import WebKit
import SwiftProtobuf

@MainActor
final class Reviewer: ObservableObject {
    @Published var questionHTML: String = ""
    @Published var answerHTML: String = ""
    @Published var css: String = ""
    @Published var showingAnswer = false
    @Published var reviewedThisSession = 0
    @Published var finished = false
    @Published var error: String?

    private let engine: Engine
    private var currentCardID: Int64?
    private var states: Anki_Scheduler_SchedulingStates?

    init(engine: Engine) { self.engine = engine }

    /// Point the engine at the "MCAT" deck before the first fetch so a card always appears,
    /// even if a synced collection's current deck differs. Best-effort: if the deck is missing
    /// we just proceed (the bundled seed already selects MCAT), then run the normal queue.
    func prepareAndLoad() async {
        await ensureMCATDeck()
        await loadNext()
    }

    private func ensureMCATDeck() async {
        do {
            var nameReq = Anki_Generic_String()
            nameReq.val = "MCAT"
            let deckID: Anki_Decks_DeckId = try await engine.perform { bridge in
                try bridge.call(
                    service: ServiceIndices.BackendDecksService.index,
                    method: ServiceIndices.BackendDecksService.getDeckIdByName,
                    nameReq
                )
            }
            guard deckID.did != 0 else { return }
            let _: Anki_Collection_OpChanges = try await engine.perform { bridge in
                try bridge.call(
                    service: ServiceIndices.BackendDecksService.index,
                    method: ServiceIndices.BackendDecksService.setCurrentDeck,
                    deckID
                )
            }
        } catch {
            // Deck missing or backend not ready — proceed; the seed already selects MCAT.
        }
    }

    func loadNext() async {
        showingAnswer = false
        do {
            var request = Anki_Scheduler_GetQueuedCardsRequest()
            request.fetchLimit = 1
            let queued: Anki_Scheduler_QueuedCards = try await engine.perform { bridge in
                try bridge.call(
                    service: ServiceIndices.BackendSchedulerService.index,
                    method: ServiceIndices.BackendSchedulerService.getQueuedCards,
                    request
                )
            }
            guard let first = queued.cards.first else {
                finished = true
                currentCardID = nil
                return
            }
            currentCardID = first.card.id
            states = first.states
            try await render(cardID: first.card.id)
        } catch {
            self.error = String(describing: error)
        }
    }

    private func render(cardID: Int64) async throws {
        var request = Anki_CardRendering_RenderExistingCardRequest()
        request.cardID = cardID
        let rendered: Anki_CardRendering_RenderCardResponse = try await engine.perform { bridge in
            try bridge.call(
                service: ServiceIndices.BackendCardRenderingService.index,
                method: ServiceIndices.BackendCardRenderingService.renderExistingCard,
                request
            )
        }
        css = rendered.css
        questionHTML = Self.joinNodes(rendered.questionNodes)
        answerHTML = Self.joinNodes(rendered.answerNodes)
    }

    func reveal() { showingAnswer = true }

    func answer(_ rating: Anki_Scheduler_CardAnswer.Rating) async {
        guard let cardID = currentCardID, let states else { return }
        do {
            var answer = Anki_Scheduler_CardAnswer()
            answer.cardID = cardID
            answer.currentState = states.current
            answer.newState = {
                switch rating {
                case .again: return states.again
                case .hard: return states.hard
                case .good: return states.good
                case .easy: return states.easy
                case .UNRECOGNIZED: return states.good
                }
            }()
            answer.rating = rating
            answer.answeredAtMillis = Int64(Date().timeIntervalSince1970 * 1000)
            answer.millisecondsTaken = 1500
            try await engine.perform { bridge in
                try bridge.callVoid(
                    service: ServiceIndices.BackendSchedulerService.index,
                    method: ServiceIndices.BackendSchedulerService.answerCard,
                    answer
                )
            }
            reviewedThisSession += 1
            await loadNext()
        } catch {
            self.error = String(describing: error)
        }
    }

    /// Best-effort HTML from rendered template nodes (text nodes + resolved replacements).
    private static func joinNodes(_ nodes: [Anki_CardRendering_RenderedTemplateNode]) -> String {
        nodes.map { node in
            switch node.value {
            case .text(let t): return t
            case .replacement(let r): return r.currentText
            case .none: return ""
            }
        }
        .joined()
    }
}

struct ReviewView: View {
    @EnvironmentObject var sync: SyncManager
    @StateObject private var reviewer: Reviewer

    init(engine: Engine) {
        _reviewer = StateObject(wrappedValue: Reviewer(engine: engine))
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if reviewer.finished {
                emptyState
            } else {
                card
                controls
            }
        }
        .background(Theme.canvas)
        .navigationTitle("Review")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { try? await sync.sync() }
                } label: {
                    if sync.isBusy {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                }
                .tint(Theme.accent)
            }
        }
        .task {
            await reviewer.prepareAndLoad()
            #if DEBUG
            // TEST-ONLY: let the screenshot harness capture the graded state via `-uitestReveal`.
            if ProcessInfo.processInfo.arguments.contains("-uitestReveal") {
                reviewer.reveal()
            }
            #endif
        }
        .alert("Error", isPresented: .constant(reviewer.error != nil)) {
            Button("OK") { reviewer.error = nil }
        } message: {
            Text(reviewer.error ?? "")
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 5) {
                Image(systemName: "brain.head.profile")
                Text("MCAT")
            }
            .nexusPill(background: Theme.gradeAccentTint, foreground: Theme.accent)

            Spacer()

            Text("\(reviewer.reviewedThisSession) reviewed")
                .font(Theme.font(14, .medium))
                .foregroundStyle(Theme.muted)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 6)
    }

    private var card: some View {
        CardWebView(html: reviewer.showingAnswer ? reviewer.answerHTML : reviewer.questionHTML,
                    css: reviewer.css)
            .background(Theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                    .strokeBorder(Theme.hairlineSubtle, lineWidth: 1)
            )
            .shadow(color: Theme.ink.opacity(0.06), radius: 15, x: 0, y: 10)
            .shadow(color: Theme.ink.opacity(0.04), radius: 1, x: 0, y: 1)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var controls: some View {
        VStack(spacing: 12) {
            if reviewer.showingAnswer {
                HStack(spacing: 10) {
                    gradeButton("Again", .again, .again)
                    gradeButton("Hard", .hard, .hard)
                    gradeButton("Good", .good, .good)
                    gradeButton("Easy", .easy, .easy)
                }
            } else {
                Button("Show answer") { reviewer.reveal() }
                    .buttonStyle(PrimaryButtonStyle())
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 10)
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 52))
                .foregroundStyle(Theme.sectionTeal)
            Text("All caught up")
                .font(Theme.font(22, .semibold))
                .foregroundStyle(Theme.ink)
            Text("You've reviewed every due card for now. Pull sync to fetch more from your desktop.")
                .font(Theme.font(15))
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func gradeButton(_ title: String, _ rating: Anki_Scheduler_CardAnswer.Rating, _ kind: GradeKind) -> some View {
        Button(title) { Task { await reviewer.answer(rating) } }
            .buttonStyle(GradeButtonStyle(kind: kind))
    }
}

/// Renders engine card HTML (with its CSS) in a WKWebView, on a clean white "paper" surface
/// so the card is readable in both light and dark mode. The SwiftUI parent supplies the
/// rounded corners + shadow; here we just keep the content legible and well-spaced.
struct CardWebView: UIViewRepresentable {
    let html: String
    let css: String

    func makeUIView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.isOpaque = false
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        let document = """
        <!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
        \(css)
        html, body { background: #ffffff; margin: 0; height: 100%; }
        body {
            box-sizing: border-box;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: safe center;
            align-items: center;
            font-family: "Inter", -apple-system, "SF Pro Text", system-ui, sans-serif;
            font-size: 21px;
            line-height: 1.55;
            color: #1b1d2a;
            -webkit-text-size-adjust: 100%;
            padding: 24px 22px;
        }
        .card { background: #ffffff; text-align: center; width: 100%; }
        img { max-width: 100%; height: auto; }
        </style>
        </head><body><div class="card">\(html)</div></body></html>
        """
        webView.loadHTMLString(document, baseURL: nil)
    }
}
