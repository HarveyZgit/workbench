// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "FastFinickyRewrite",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "FastFinickyCore",
            targets: ["FastFinickyCore"]
        ),
        .executable(
            name: "FastFinicky",
            targets: ["FastFinickyApp"]
        ),
        .executable(
            name: "fast-finicky-cli",
            targets: ["FastFinickyCLI"]
        )
    ],
    targets: [
        .target(
            name: "FastFinickyCore",
            linkerSettings: [
                .linkedFramework("AppKit")
            ]
        ),
        .executableTarget(
            name: "FastFinickyApp",
            dependencies: ["FastFinickyCore"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Carbon")
            ]
        ),
        .executableTarget(
            name: "FastFinickyCLI",
            dependencies: ["FastFinickyCore"]
        ),
        .testTarget(
            name: "FastFinickyCoreTests",
            dependencies: ["FastFinickyCore"]
        )
    ]
)
