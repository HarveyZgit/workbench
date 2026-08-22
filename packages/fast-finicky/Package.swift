// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "FastFinicky",
    platforms: [
        .macOS(.v12)
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
