// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// App entry point. One SyncManager (owning one shared Engine) for the whole session.

import SwiftUI

@main
struct ChargedUpApp: App {
    @StateObject private var sync = SyncManager()

    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(sync)
        }
    }
}
