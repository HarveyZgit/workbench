// swift-tools-version: 5.7
import PackageDescription

// Linux is a core-test host, not a supported desktop app platform.
var products: [Product] = [
    .library(name: "FastFinickyCore", targets: ["FastFinickyCore"])
]
var excludedCoreFiles: [String] = []
#if !os(macOS)
excludedCoreFiles = ["ChromeWarmer.swift", "ConfigWatcher.swift"]
#endif
var targets: [Target] = [
    .target(
        name: "FastFinickyCore",
        exclude: excludedCoreFiles,
        linkerSettings: [.linkedFramework("AppKit", .when(platforms: [.macOS]))]
    ),
    .testTarget(name: "FastFinickyCoreTests", dependencies: ["FastFinickyCore"])
]
#if os(macOS)
products += [
    .executable(name: "FastFinicky", targets: ["FastFinickyApp"]),
    .executable(name: "fast-finicky-cli", targets: ["FastFinickyCLI"])
]
targets += [
    .executableTarget(
        name: "FastFinickyApp",
        dependencies: ["FastFinickyCore"],
        linkerSettings: [.linkedFramework("AppKit"), .linkedFramework("Carbon")]
    ),
    .executableTarget(name: "FastFinickyCLI", dependencies: ["FastFinickyCore"])
]
#endif

let package = Package(
    name: "FastFinicky",
    platforms: [.macOS(.v12)],
    products: products,
    targets: targets
)
