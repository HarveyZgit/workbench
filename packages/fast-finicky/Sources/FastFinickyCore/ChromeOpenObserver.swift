import AppKit
import Darwin
import Foundation

public enum ChromeOpenStatus: String, Equatable, Sendable {
    /// Spawned Chrome finished launching, or reuse already handed the URL off.
    case ready
    /// Spawned helper exited (typical singleton handoff while Chrome is running).
    case exited
    /// No ready/exited signal before the wait budget.
    case timeout
}

public struct ChromeOpenObservation: Equatable, Sendable {
    public let status: ChromeOpenStatus
    public let elapsedMs: Int

    public init(status: ChromeOpenStatus, elapsedMs: Int) {
        self.status = status
        self.elapsedMs = elapsedMs
    }
}

/// Wall-clock open time: `process.run()` returns immediately, so `[route] elapsed_ms`
/// cannot capture Chrome loading the framework. Wait off the hot path instead.
public enum ChromeOpenObserver {
    public static let defaultTimeout: TimeInterval = 20
    public static let defaultPollInterval: TimeInterval = 0.05

    /// Terminal status, or nil to keep waiting.
    public static func status(
        strategy: LaunchStrategy,
        chromeWasRunning: Bool,
        spawnedProcessRunning: Bool?,
        chromeFinishedLaunching: Bool,
        spawnedAppFinishedLaunching: Bool
    ) -> ChromeOpenStatus? {
        if strategy == .reuseRunningInstance {
            return .ready
        }

        if let running = spawnedProcessRunning, !running {
            // `open`(1) exits before a cold Chrome is up.
            if strategy == .openCommandFallback, !chromeWasRunning {
                return chromeFinishedLaunching ? .ready : nil
            }
            return .exited
        }

        if spawnedAppFinishedLaunching {
            return .ready
        }

        if !chromeWasRunning, chromeFinishedLaunching {
            return .ready
        }

        if spawnedProcessRunning == nil, chromeWasRunning {
            return .ready
        }

        return nil
    }

    public static func wait(
        startedAt: Date,
        result: LaunchResult,
        timeout: TimeInterval = defaultTimeout,
        pollInterval: TimeInterval = defaultPollInterval,
        now: @escaping @Sendable () -> Date = { Date() },
        sleep: @escaping @Sendable (TimeInterval) -> Void = { Thread.sleep(forTimeInterval: $0) },
        isProcessRunning: @escaping @Sendable (Int32) -> Bool = { pid in
            kill(pid, 0) == 0
        },
        isChromeFinishedLaunching: @escaping @Sendable () -> Bool = {
            NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome")
                .contains { !$0.isTerminated && $0.isFinishedLaunching }
        },
        isSpawnedAppFinishedLaunching: @escaping @Sendable (Int32) -> Bool = { pid in
            NSRunningApplication(processIdentifier: pid)?.isFinishedLaunching == true
        }
    ) -> ChromeOpenObservation {
        let elapsedMs = { Int((now().timeIntervalSince(startedAt) * 1_000).rounded()) }

        if result.strategy == .reuseRunningInstance {
            return ChromeOpenObservation(status: .ready, elapsedMs: elapsedMs())
        }

        let deadline = startedAt.addingTimeInterval(timeout)
        while now() < deadline {
            let running = result.spawnedProcessIdentifier.map(isProcessRunning)
            let spawnedReady = result.spawnedProcessIdentifier.map(isSpawnedAppFinishedLaunching) ?? false
            if let resolved = Self.status(
                strategy: result.strategy,
                chromeWasRunning: result.chromeWasRunning,
                spawnedProcessRunning: running,
                chromeFinishedLaunching: isChromeFinishedLaunching(),
                spawnedAppFinishedLaunching: spawnedReady
            ) {
                return ChromeOpenObservation(status: resolved, elapsedMs: elapsedMs())
            }
            sleep(pollInterval)
        }

        return ChromeOpenObservation(status: .timeout, elapsedMs: elapsedMs())
    }
}
