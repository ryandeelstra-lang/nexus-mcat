// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// LoginView (Phase 3) — collects username / password / server URL and signs in against the
// self-hosted anki-sync-server via SyncLogin (over the FFI). The server URL defaults to the
// same value the desktop uses as its customSyncUrl, so both clients share one collection.
//
// Visually this is the Nexus hero (Home.svelte): a near-white canvas, a soft white scrim, the
// uppercase letter-spaced "Nexus" wordmark as the brand, deep-navy ink, and a filled blue
// "Sign in" with the signature glow. Only the chrome changed — sign-in behavior is untouched.

import SwiftUI

struct LoginView: View {
    @EnvironmentObject var sync: SyncManager

    @State private var username = ""
    @State private var password = ""
    @State private var serverURL = SyncManager.defaultServerURL
    @State private var error: String?

    var body: some View {
        ZStack {
            Theme.canvas.ignoresSafeArea()

            // Soft radial white scrim so the hero reads as premium / lit from above (Home.svelte).
            RadialGradient(
                colors: [Color.white.opacity(0.9), Theme.canvas.opacity(0)],
                center: .init(x: 0.5, y: 0.28),
                startRadius: 0,
                endRadius: 520
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 30) {
                    brandHeader

                    VStack(spacing: 20) {
                        fieldGroup(title: "Account") {
                            field("person", "Username", text: $username)
                            field("lock", "Password", text: $password, secure: true)
                        }

                        fieldGroup(title: "Sync server") {
                            field("network", "https://your-server/", text: $serverURL, url: true)
                        }

                        Text("Use the SAME URL your desktop has under Preferences → Syncing → self-hosted sync server.")
                            .font(Theme.font(13))
                            .foregroundStyle(Theme.muted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if let error {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "exclamationmark.triangle.fill")
                            Text(error)
                        }
                        .font(Theme.font(13, .medium))
                        .foregroundStyle(Theme.cautionInk)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: Theme.buttonRadius, style: .continuous)
                                .fill(Theme.cautionTint)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.buttonRadius, style: .continuous)
                                .strokeBorder(Theme.cautionRing, lineWidth: 1)
                        )
                    }

                    Button {
                        Task { await signIn() }
                    } label: {
                        if sync.isBusy {
                            ProgressView().tint(.white)
                        } else {
                            Text("Sign in")
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(username.isEmpty || password.isEmpty || serverURL.isEmpty || sync.isBusy)
                }
                .padding(.horizontal, 26)
                .padding(.vertical, 40)
                .frame(maxWidth: 520)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .tint(Theme.accent)
        .task {
            #if DEBUG
            // TEST-ONLY: let the screenshot harness show the enabled/glowing blue CTA by
            // pre-filling the demo credentials (it does NOT sign in). Gated on `-uitestPrefillLogin`
            // and compiled out of release by `#if DEBUG`, like the other `-uitest*` hooks.
            if ProcessInfo.processInfo.arguments.contains("-uitestPrefillLogin") {
                if username.isEmpty { username = "demo" }
                if password.isEmpty { password = "demo" }
            }
            #endif
        }
    }

    private var brandHeader: some View {
        VStack(spacing: 12) {
            NexusWordmark(size: 30)
            Text("MCAT mastery, synced to your desktop")
                .font(Theme.font(15))
                .tracking(0.75)
                .foregroundStyle(Theme.muted)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 28)
        .padding(.bottom, 4)
    }

    private func fieldGroup<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased())
                .font(Theme.font(11.5, .semibold))
                .tracking(1.1)
                .foregroundStyle(Theme.mutedLight)
                .padding(.leading, 4)
            VStack(spacing: 12) { content() }
        }
    }

    private func field(_ icon: String, _ placeholder: String, text: Binding<String>,
                       secure: Bool = false, url: Bool = false) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(Theme.accent)
                .frame(width: 22)
            Group {
                if secure {
                    SecureField(placeholder, text: text)
                } else {
                    TextField(placeholder, text: text)
                        .keyboardType(url ? .URL : .default)
                }
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .font(Theme.font(16))
            .foregroundStyle(Theme.ink)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 15)
        .background(
            RoundedRectangle(cornerRadius: Theme.fieldRadius, style: .continuous)
                .fill(Theme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Theme.fieldRadius, style: .continuous)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        )
    }

    private func signIn() async {
        error = nil
        do {
            try await sync.login(username: username, password: password, serverURL: serverURL)
            try await sync.openCollection()
            // Pull the shared collection down on first sign-in.
            try await sync.sync()
        } catch {
            self.error = String(describing: error)
        }
    }
}
