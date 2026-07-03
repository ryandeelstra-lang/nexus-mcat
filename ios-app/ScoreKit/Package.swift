// swift-tools-version:5.9
// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html
import PackageDescription

let package = Package(
    name: "ScoreKit",
    products: [.library(name: "ScoreKit", targets: ["ScoreKit"])],
    targets: [
        .target(name: "ScoreKit"),
        .testTarget(name: "ScoreKitTests", dependencies: ["ScoreKit"]),
    ]
)
