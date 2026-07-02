// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// ContentView — routes between sign-in (Phase 3) and the signed-in tabs (Review + Scores).
// The whole app shares ONE Engine (one Rust backend + one collection), passed to the tabs.

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var sync: SyncManager
    @State private var opened = false
    @State private var selectedTab = Tab.review

    private enum Tab: Hashable { case review, scores }

    init() {
        // Paint the nav + tab bar chrome in the Nexus palette / Inter, once, before first render.
        Theme.configureAppearance()
    }

    var body: some View {
        Group {
            if sync.isLoggedIn {
                TabView(selection: $selectedTab) {
                    NavigationStack {
                        ReviewView(engine: sync.engine)
                    }
                    .tabItem { Label("Review", systemImage: "rectangle.stack") }
                    .tag(Tab.review)

                    NavigationStack {
                        ScoresView(engine: sync.engine)
                    }
                    .tabItem { Label("Scores", systemImage: "chart.bar") }
                    .tag(Tab.scores)
                }
                .task {
                    // Make sure the collection is open (and the seed copied) before reviewing.
                    if !opened {
                        opened = true
                        try? await sync.openCollection()
                        try? await sync.sync()
                    }
                }
            } else {
                LoginView()
            }
        }
        .background(Theme.canvas)
        .tint(Theme.accent)
        .task {
            #if DEBUG
            // TEST-ONLY: the screenshot harness may deep-link straight to a tab via
            // `-uitestTab scores`. Compiled out of release builds by `#if DEBUG`.
            if ProcessInfo.processInfo.arguments.contains("-uitestTab"),
               let i = ProcessInfo.processInfo.arguments.firstIndex(of: "-uitestTab"),
               i + 1 < ProcessInfo.processInfo.arguments.count,
               ProcessInfo.processInfo.arguments[i + 1] == "scores" {
                selectedTab = .scores
            }
            await sync.debugAutologinIfRequested()
            #endif
        }
    }
}
