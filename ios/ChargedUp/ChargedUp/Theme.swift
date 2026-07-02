// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
//
// Theme — the shared "Nexus" design language for the phone companion, matched faithfully to the
// desktop (ts/routes/home/Home.svelte + ts/routes/scores-dashboard/ScoresDashboard.svelte +
// qt/aqt/data/web/css/reviewer-bottom.scss). One near-white canvas, deep-navy ink, a single blue
// accent with a soft glow, the uppercase letter-spaced "Nexus" wordmark, 18px card surfaces, and
// a CALM grade rail (grades read as intervals, never a red/green pass-fail). Typography is Inter
// (bundled 400/500/600, OFL) with a graceful fall back to the system font (SF Pro) — the desktop
// stack is likewise `Inter, system-ui, …`, so either way the app reads as one cohesive product.

import SwiftUI
import UIKit

enum Theme {
    // MARK: - Palette (Nexus tokens)

    /// Near-white canvas / background (#FBFBFD).
    static let canvas = Color(hex: 0xFBFBFD)
    /// Elevated card surface (#FFFFFF).
    static let surface = Color(hex: 0xFFFFFF)
    /// Deep-navy primary ink (#1B1D2A).
    static let ink = Color(hex: 0x1B1D2A)
    /// Muted secondary ink (#565A6E).
    static let muted = Color(hex: 0x565A6E)
    /// Lighter tertiary ink (#8B93A7).
    static let mutedLight = Color(hex: 0x8B93A7)

    /// Nexus blue — the one brand accent (#3B82F6).
    static let accent = Color(hex: 0x3B82F6)
    /// Pressed state for the primary CTA (#2F74E8).
    static let accentPressed = Color(hex: 0x2F74E8)
    /// Deeper end of the accent (#2563EB).
    static let accentDeep = Color(hex: 0x2563EB)

    // Section-identity accents — used calmly (card rails, small accents), matching the graph's
    // color language. Blue / purple / teal / amber (+ slate for the "not-yet" performance rail).
    static let sectionBlue = Color(hex: 0x3B82F6)
    static let sectionPurple = Color(hex: 0x8B5CF6)
    static let sectionTeal = Color(hex: 0x14B8A6)
    static let sectionAmber = Color(hex: 0xF59E0B)
    static let sectionSlate = Color(hex: 0x94A3B8)

    // Hairlines / borders (ink at low opacity), matching rgba(27,29,42,0.14 | 0.08 | 0.07).
    static let hairline = ink.opacity(0.14)
    static let hairlineSubtle = ink.opacity(0.08)
    static let track = ink.opacity(0.07)

    // Calm grade-rail tokens (reviewer-bottom.scss): neutral pills, accent-tint only for "Good".
    static let gradeNeutral = Color(hex: 0xF5F6FA)
    static let gradeNeutralHover = Color(hex: 0xEEF0F6)
    static let gradeAccentTint = accent.opacity(0.10)
    static let gradeAccentRing = accent.opacity(0.35)

    // Amber "caveat" notice tones (calm, never error-red) — matches the dashboard caveat/chip-warn.
    static let cautionInk = Color(hex: 0x92580A)
    static let cautionTint = sectionAmber.opacity(0.12)
    static let cautionRing = sectionAmber.opacity(0.45)
    // Teal "calibrated" chip tones.
    static let calibratedInk = Color(hex: 0x0F9488)
    static let calibratedTint = sectionTeal.opacity(0.12)

    // Radii.
    static let cardRadius: CGFloat = 18
    static let buttonRadius: CGFloat = 12
    static let fieldRadius: CGFloat = 12

    /// Primary-button glow (0 6px 20px rgba(59,130,246,0.28)).
    static let accentGlow = accent.opacity(0.28)

    // MARK: - Global UIKit appearance (nav + tab bars in the Nexus palette / Inter)

    /// Configure the navigation and tab bars once so their chrome speaks Nexus too: near-white
    /// canvas, deep-navy ink titles in Inter, the blue accent for the selected tab.
    static func configureAppearance() {
        let inkColor = UIColor(ink)
        let mutedColor = UIColor(muted)

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(canvas)
        nav.shadowColor = .clear
        nav.titleTextAttributes = [.foregroundColor: inkColor, .font: uiFont(17, .semibold)]
        nav.largeTitleTextAttributes = [.foregroundColor: inkColor, .font: uiFont(32, .semibold)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = UIColor(accent)

        let tab = UITabBarAppearance()
        tab.configureWithDefaultBackground() // translucent near-white material, like the reviewer bar
        let items = [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance]
        for item in items {
            item.selected.iconColor = UIColor(accent)
            item.selected.titleTextAttributes = [.foregroundColor: UIColor(accent), .font: uiFont(10, .medium)]
            item.normal.iconColor = mutedColor
            item.normal.titleTextAttributes = [.foregroundColor: mutedColor, .font: uiFont(10, .medium)]
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

// MARK: - Typography (Inter, bundled, with a system fallback)

/// The three Inter weights the desktop uses (400/500/600). `.font(_:_:)` returns Inter when it is
/// bundled and registered, otherwise the matching system-font weight so the app still reads right.
enum NexusFont {
    enum Weight {
        case regular, medium, semibold

        var postScriptName: String {
            switch self {
            case .regular: return "Inter-Regular"
            case .medium: return "Inter-Medium"
            case .semibold: return "Inter-SemiBold"
            }
        }

        var system: Font.Weight {
            switch self {
            case .regular: return .regular
            case .medium: return .medium
            case .semibold: return .semibold
            }
        }

        var uiWeight: UIFont.Weight {
            switch self {
            case .regular: return .regular
            case .medium: return .medium
            case .semibold: return .semibold
            }
        }
    }

    /// True when the bundled Inter is available; drives the fallback everywhere.
    static let interAvailable: Bool = UIFont(name: Weight.regular.postScriptName, size: 12) != nil

    static func font(_ size: CGFloat, _ weight: Weight = .regular) -> Font {
        interAvailable ? .custom(weight.postScriptName, size: size) : .system(size: size, weight: weight.system)
    }
}

extension Theme {
    /// SwiftUI Inter (or system) font.
    static func font(_ size: CGFloat, _ weight: NexusFont.Weight = .regular) -> Font {
        NexusFont.font(size, weight)
    }

    /// UIKit Inter (or system) font, for appearance proxies.
    static func uiFont(_ size: CGFloat, _ weight: NexusFont.Weight) -> UIFont {
        UIFont(name: weight.postScriptName, size: size) ?? .systemFont(ofSize: size, weight: weight.uiWeight)
    }
}

// MARK: - The "Nexus" brand wordmark (uppercase, weight 600, letter-spacing 0.18em, opacity 0.9)

struct NexusWordmark: View {
    var size: CGFloat = 19

    var body: some View {
        Text("NEXUS")
            .font(Theme.font(size, .semibold))
            .tracking(size * 0.18)
            .foregroundStyle(Theme.ink.opacity(0.9))
    }
}

// MARK: - Buttons

/// The one obvious action per screen: a filled Nexus-blue CTA with the soft blue glow
/// (Home.svelte `.cta.primary`; radius 12, weight 500, pressed #2F74E8).
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        let fill: Color = !isEnabled ? Theme.mutedLight.opacity(0.5)
            : (configuration.isPressed ? Theme.accentPressed : Theme.accent)
        return configuration.label
            .font(Theme.font(17, .medium))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                RoundedRectangle(cornerRadius: Theme.buttonRadius, style: .continuous).fill(fill)
            )
            .shadow(color: isEnabled ? Theme.accentGlow : .clear, radius: 10, x: 0, y: 6)
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// The calm secondary CTA (Home.svelte `.cta.ghost`): white-72% fill, hairline border, ink label.
struct GhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.font(17, .medium))
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                RoundedRectangle(cornerRadius: Theme.buttonRadius, style: .continuous)
                    .fill(Theme.surface.opacity(0.72))
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.buttonRadius, style: .continuous)
                    .strokeBorder(configuration.isPressed ? Theme.ink.opacity(0.30) : Theme.hairline, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.99 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// The four grade keys of the CALM reviewer rail (reviewer-bottom.scss): grades read as INTERVALS,
/// not a red/green pass-fail. Again = neutral grey ink, Hard/Easy = near-neutral, Good = the section
/// accent (blue tint + blue ink + a soft ring) — the scheduler's default nudge.
enum GradeKind { case again, hard, good, easy }

struct GradeButtonStyle: ButtonStyle {
    let kind: GradeKind

    private var isGood: Bool { kind == .good }

    private var labelColor: Color {
        switch kind {
        case .good: return Theme.accent
        case .again: return Theme.muted
        case .hard, .easy: return Theme.ink
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.font(15, .semibold))
            .foregroundStyle(labelColor)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                RoundedRectangle(cornerRadius: Theme.buttonRadius, style: .continuous)
                    .fill(isGood ? Theme.gradeAccentTint : Theme.gradeNeutral)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.buttonRadius, style: .continuous)
                    .strokeBorder(isGood ? Theme.gradeAccentRing : Theme.hairlineSubtle, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.85 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

// MARK: - Surfaces

/// A soft, elevated white card (radius 18) matching the dashboard `.card` shadow stack
/// (0 1px 2px rgba(27,29,42,0.04), 0 10px 30px rgba(27,29,42,0.06)).
private struct CardSurface: ViewModifier {
    var cornerRadius: CGFloat = Theme.cardRadius

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).fill(Theme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(Theme.hairlineSubtle, lineWidth: 1)
            )
            .shadow(color: Theme.ink.opacity(0.06), radius: 15, x: 0, y: 10)
            .shadow(color: Theme.ink.opacity(0.04), radius: 1, x: 0, y: 1)
    }
}

extension View {
    func cardSurface(cornerRadius: CGFloat = Theme.cardRadius) -> some View {
        modifier(CardSurface(cornerRadius: cornerRadius))
    }

    /// A rounded 999px "pill" (dashboard chip / "Abstained" tag).
    func nexusPill(background: Color, foreground: Color) -> some View {
        self
            .font(Theme.font(12, .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, 11)
            .padding(.vertical, 4)
            .background(Capsule().fill(background))
    }
}

// MARK: - Color(hex:)

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}
