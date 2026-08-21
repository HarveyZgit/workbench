import AppKit
import Foundation

public protocol ChromeLaunching: Sendable {
    @discardableResult
    func launch(targetURL: URL, profile: String) throws -> LaunchResult
}

public enum LaunchStrategy: String, Codable, Equatable, Sendable {
    case directBinary
    case openCommandFallback
}

public enum LaunchTargetKind: String, Codable, Equatable, Sendable {
    case webURL
    case fileURL
}

public struct LaunchResult: Equatable, Sendable {
    public let appURL: URL
    public let strategy: LaunchStrategy
    public let targetKind: LaunchTargetKind

    public init(appURL: URL, strategy: LaunchStrategy, targetKind: LaunchTargetKind) {
        self.appURL = appURL
        self.strategy = strategy
        self.targetKind = targetKind
    }
}

public struct BrowserLauncher: ChromeLaunching {
    private let commandRunner: @Sendable (LaunchCommand) throws -> Void
    private let chromeAppLocator: @Sendable () throws -> URL
    private let activateChrome: @Sendable () -> Bool
    private let activationRetryScheduler: @Sendable (TimeInterval, @escaping @Sendable () -> Void) -> Void

    public init() {
        self.init(
            commandRunner: Self.runCommand,
            chromeAppLocator: Self.locateInstalledChromeApplication,
            activateChrome: Self.activateRunningChrome,
            activationRetryScheduler: Self.scheduleActivationRetry
        )
    }

    init(
        commandRunner: @escaping @Sendable (LaunchCommand) throws -> Void,
        chromeAppLocator: @escaping @Sendable () throws -> URL,
        activateChrome: @escaping @Sendable () -> Bool,
        activationRetryScheduler: @escaping @Sendable (TimeInterval, @escaping @Sendable () -> Void) -> Void
    ) {
        self.commandRunner = commandRunner
        self.chromeAppLocator = chromeAppLocator
        self.activateChrome = activateChrome
        self.activationRetryScheduler = activationRetryScheduler
    }

    @discardableResult
    public func launch(targetURL: URL, profile: String) throws -> LaunchResult {
        let appURL = try chromeAppLocator()
        let launchDetails = try prepareLaunch(targetURL: targetURL, profile: profile, appURL: appURL)
        try commandRunner(launchDetails.command)
        requestChromeActivation()
        return launchDetails.result
    }

    public func locateChromeApplication() throws -> URL {
        try chromeAppLocator()
    }

    private func prepareLaunch(targetURL: URL, profile: String, appURL: URL) throws -> PreparedLaunch {
        if targetURL.isFileURL {
            return PreparedLaunch(
                command: LaunchCommand(
                    executableURL: URL(fileURLWithPath: "/usr/bin/open"),
                    arguments: [
                        "-n",
                        "-a",
                        appURL.path,
                        "--args",
                        "--profile-directory=\(profile)",
                        targetURL.path
                    ]
                ),
                result: LaunchResult(
                    appURL: appURL,
                    strategy: .openCommandFallback,
                    targetKind: .fileURL
                )
            )
        }

        let executableURL = try chromeExecutableURL(for: appURL)
        return PreparedLaunch(
            command: LaunchCommand(
                executableURL: executableURL,
                arguments: [
                    "--profile-directory=\(profile)",
                    targetURL.absoluteString
                ]
            ),
            result: LaunchResult(
                appURL: appURL,
                strategy: .directBinary,
                targetKind: .webURL
            )
        )
    }

    private func chromeExecutableURL(for appURL: URL) throws -> URL {
        let executableURL = appURL.appending(path: "Contents/MacOS/Google Chrome", directoryHint: .notDirectory)

        guard FileManager.default.isExecutableFile(atPath: executableURL.path) else {
            throw FastFinickyError.chromeExecutableMissing(executableURL.path)
        }

        return executableURL
    }

    private func requestChromeActivation() {
        if activateChrome() {
            return
        }

        activationRetryScheduler(0.1) {
            _ = activateChrome()
        }
    }

    private static func locateInstalledChromeApplication() throws -> URL {
        if let resolved = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome") {
            return resolved
        }

        let candidates = [
            "/Applications/Google Chrome.app",
            NSString(string: "~/Applications/Google Chrome.app").expandingTildeInPath
        ]

        for candidate in candidates where FileManager.default.fileExists(atPath: candidate) {
            return URL(fileURLWithPath: candidate, isDirectory: true)
        }

        throw FastFinickyError.chromeNotFound
    }

    private static func runCommand(_ command: LaunchCommand) throws {
        let process = Process()
        process.qualityOfService = .userInitiated
        process.executableURL = command.executableURL
        process.arguments = command.arguments
        try process.run()
    }

    private static func activateRunningChrome() -> Bool {
        let bundleID = "com.google.Chrome"
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: bundleID) where !app.isTerminated {
            return app.activate(options: [.activateAllWindows])
        }

        return false
    }

    private static func scheduleActivationRetry(
        after delay: TimeInterval,
        action: @escaping @Sendable () -> Void
    ) {
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
            action()
        }
    }
}

struct LaunchCommand: Equatable, Sendable {
    let executableURL: URL
    let arguments: [String]
}

private struct PreparedLaunch {
    let command: LaunchCommand
    let result: LaunchResult
}
