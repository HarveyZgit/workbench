import AppKit
import Foundation

public protocol ChromeLaunching: Sendable {
    @discardableResult
    func launch(targetURL: URL, profile: String) throws -> LaunchResult
}

public enum LaunchStrategy: String, Codable, Equatable, Sendable {
    case directBinary
    case openCommandFallback
    case reuseRunningInstance
}

public enum LaunchTargetKind: String, Codable, Equatable, Sendable {
    case webURL
    case fileURL
}

public struct LaunchResult: Equatable, Sendable {
    public let appURL: URL
    public let strategy: LaunchStrategy
    public let targetKind: LaunchTargetKind
    public let chromeWasRunning: Bool
    public let spawnedProcessIdentifier: Int32?

    public init(
        appURL: URL,
        strategy: LaunchStrategy,
        targetKind: LaunchTargetKind,
        chromeWasRunning: Bool,
        spawnedProcessIdentifier: Int32? = nil
    ) {
        self.appURL = appURL
        self.strategy = strategy
        self.targetKind = targetKind
        self.chromeWasRunning = chromeWasRunning
        self.spawnedProcessIdentifier = spawnedProcessIdentifier
    }
}

public struct BrowserLauncher: ChromeLaunching {
    private let commandRunner: @Sendable (LaunchCommand) throws -> Int32?
    private let chromeAppLocator: @Sendable () throws -> URL
    private let activateChrome: @Sendable () -> Bool
    private let activationRetryScheduler: @Sendable (TimeInterval, @escaping @Sendable () -> Void) -> Void
    private let isChromeRunning: @Sendable () -> Bool
    private let chromeProfileSnapshot: @Sendable () -> ChromeProfileSnapshot
    private let reuseRunningChrome: @Sendable (URL, URL, String) throws -> Void

    public init() {
        self.init(
            commandRunner: Self.runCommand,
            chromeAppLocator: Self.locateInstalledChromeApplication,
            activateChrome: Self.activateRunningChrome,
            activationRetryScheduler: Self.scheduleActivationRetry,
            isChromeRunning: Self.isChromeRunning,
            chromeProfileSnapshot: { ChromeLocalState.snapshot() },
            reuseRunningChrome: Self.openWithRunningChrome
        )
    }

    init(
        commandRunner: @escaping @Sendable (LaunchCommand) throws -> Int32?,
        chromeAppLocator: @escaping @Sendable () throws -> URL,
        activateChrome: @escaping @Sendable () -> Bool,
        activationRetryScheduler: @escaping @Sendable (TimeInterval, @escaping @Sendable () -> Void) -> Void,
        isChromeRunning: @escaping @Sendable () -> Bool = { false },
        chromeProfileSnapshot: @escaping @Sendable () -> ChromeProfileSnapshot = {
            ChromeProfileSnapshot(lastUsedDirectory: nil, lastActiveDirectories: [])
        },
        reuseRunningChrome: @escaping @Sendable (URL, URL, String) throws -> Void = { _, _, _ in }
    ) {
        self.commandRunner = commandRunner
        self.chromeAppLocator = chromeAppLocator
        self.activateChrome = activateChrome
        self.activationRetryScheduler = activationRetryScheduler
        self.isChromeRunning = isChromeRunning
        self.chromeProfileSnapshot = chromeProfileSnapshot
        self.reuseRunningChrome = reuseRunningChrome
    }

    @discardableResult
    public func launch(targetURL: URL, profile: String) throws -> LaunchResult {
        let appURL = try chromeAppLocator()
        let targetKind: LaunchTargetKind = targetURL.isFileURL ? .fileURL : .webURL
        let chromeAlreadyRunning = isChromeRunning()

        if chromeAlreadyRunning, chromeProfileSnapshot().canReuseRunningInstance(for: profile) {
            try reuseRunningChrome(targetURL, appURL, profile)
            return LaunchResult(
                appURL: appURL,
                strategy: .reuseRunningInstance,
                targetKind: targetKind,
                chromeWasRunning: true
            )
        }

        let command = try prepareCommand(
            targetURL: targetURL,
            profile: profile,
            appURL: appURL,
            chromeAlreadyRunning: chromeAlreadyRunning
        )
        let spawnedPID = try commandRunner(command)

        // A running Chrome already owns the singleton. Activating it here
        // fronts existing windows before the URL has been handed off.
        if !chromeAlreadyRunning {
            requestChromeActivation()
        }

        return LaunchResult(
            appURL: appURL,
            strategy: targetURL.isFileURL ? .openCommandFallback : .directBinary,
            targetKind: targetKind,
            chromeWasRunning: chromeAlreadyRunning,
            spawnedProcessIdentifier: spawnedPID
        )
    }

    public func locateChromeApplication() throws -> URL {
        try chromeAppLocator()
    }

    private func prepareCommand(
        targetURL: URL,
        profile: String,
        appURL: URL,
        chromeAlreadyRunning: Bool
    ) throws -> LaunchCommand {
        if targetURL.isFileURL {
            var arguments: [String] = []
            if chromeAlreadyRunning {
                arguments.append("-g")
            }
            arguments += [
                "-n",
                "-a",
                appURL.path,
                "--args",
                "--profile-directory=\(profile)",
                targetURL.path
            ]
            return LaunchCommand(
                executableURL: URL(fileURLWithPath: "/usr/bin/open"),
                arguments: arguments
            )
        }

        let executableURL = try chromeExecutableURL(for: appURL)
        return LaunchCommand(
            executableURL: executableURL,
            arguments: [
                "--profile-directory=\(profile)",
                targetURL.absoluteString
            ]
        )
    }

    private func chromeExecutableURL(for appURL: URL) throws -> URL {
        let executableURL = appURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("MacOS", isDirectory: true)
            .appendingPathComponent("Google Chrome", isDirectory: false)

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

    private static func runCommand(_ command: LaunchCommand) throws -> Int32? {
        let process = Process()
        process.qualityOfService = .userInitiated
        process.executableURL = command.executableURL
        process.arguments = command.arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        // Foundation retains `process` until this handler runs, which also reaps the child.
        process.terminationHandler = { _ in }
        try process.run()
        return process.processIdentifier
    }

    private static func openWithRunningChrome(targetURL: URL, appURL: URL, profile: String) throws {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        configuration.addsToRecentItems = false
        configuration.arguments = ["--profile-directory=\(profile)"]

        let lock = NSLock()
        var capturedError: Error?
        var finished = false
        let done = DispatchSemaphore(value: 0)

        NSWorkspace.shared.open([targetURL], withApplicationAt: appURL, configuration: configuration) { _, error in
            lock.lock()
            capturedError = error
            finished = true
            lock.unlock()
            done.signal()
        }

        if Thread.isMainThread {
            let deadline = Date().addingTimeInterval(3)
            while Date() < deadline {
                lock.lock()
                let isFinished = finished
                lock.unlock()
                if isFinished {
                    break
                }
                RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
            }
        } else {
            _ = done.wait(timeout: .now() + 3)
        }

        lock.lock()
        let error = capturedError
        lock.unlock()
        if let error {
            throw FastFinickyError.workspaceOpenFailed(error.localizedDescription)
        }
    }

    private static func isChromeRunning() -> Bool {
        NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome")
            .contains { !$0.isTerminated }
    }

    private static func activateRunningChrome() -> Bool {
        let bundleID = "com.google.Chrome"
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: bundleID) where !app.isTerminated {
            return app.activate(options: [.activateIgnoringOtherApps])
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
