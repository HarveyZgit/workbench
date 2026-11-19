@testable import FastFinickyCore
import Foundation
import XCTest

final class EgoLaunchSchedulerTests: XCTestCase {
    func testOverlappingSameProfileWaitsUntilFirstCLICompletes() throws {
        let scheduler = EgoLaunchScheduler()
        let state = ScheduledLaunchState()
        let firstDone = expectation(description: "first completes")
        let secondDone = expectation(description: "second completes")
        let launcher = makeLauncher(scheduler: scheduler, state: state)
        try launcher.launch(targetURL: url("first"), profile: "Default") { _ in firstDone.fulfill() }
        try launcher.launch(targetURL: url("second"), profile: "Default") { _ in secondDone.fulfill() }
        scheduler.flushForTesting()
        XCTAssertEqual(state.count, 1, "Second script must not observe first request's agent ownership")
        state.complete(0)
        scheduler.flushForTesting()
        scheduler.flushForTesting()
        XCTAssertEqual(state.count, 2)
        XCTAssertTrue(state.commands[0].arguments[2].contains("first"))
        XCTAssertTrue(state.commands[1].arguments[2].contains("second"))
        state.complete(1)
        wait(for: [firstDone, secondDone], timeout: 1)
    }

    func testDifferentProfilesStartWithoutWaitingAndIDsRemainCaseSensitive() throws {
        let scheduler = EgoLaunchScheduler()
        let state = ScheduledLaunchState()
        let done = expectation(description: "three complete")
        done.expectedFulfillmentCount = 3
        let launcher = makeLauncher(scheduler: scheduler, state: state)
        for profile in ["Profile A", "Profile B", "profile a"] {
            try launcher.launch(targetURL: url(profile), profile: profile) { _ in done.fulfill() }
        }
        scheduler.flushForTesting()
        XCTAssertEqual(state.count, 3)
        for index in 0..<3 { state.complete(index) }
        wait(for: [done], timeout: 1)
    }

    func testFailedCLIReleasesQueueWithoutRetryingFailedLink() throws {
        let scheduler = EgoLaunchScheduler()
        let state = ScheduledLaunchState()
        let failed = expectation(description: "failure forwarded")
        let done = expectation(description: "next completes")
        let launcher = makeLauncher(scheduler: scheduler, state: state)
        try launcher.launch(targetURL: url("first"), profile: "Default") {
            XCTAssertEqual($0.exitCode, 7)
            failed.fulfill()
        }
        try launcher.launch(targetURL: url("second"), profile: "Default") { _ in done.fulfill() }
        scheduler.flushForTesting()
        state.complete(0, exitCode: 7)
        scheduler.flushForTesting()
        scheduler.flushForTesting()
        XCTAssertEqual(state.count, 2)
        state.complete(1)
        wait(for: [failed, done], timeout: 1)
    }

    func testSpawnFailureCompletesRequestAndNextRequestStillStarts() throws {
        let scheduler = EgoLaunchScheduler()
        let failed = expectation(description: "spawn failed")
        let done = expectation(description: "second finished")
        let command = EgoLaunchCommand(executableURL: URL(fileURLWithPath: "/tmp/ego-browser"), arguments: [])
        scheduler.enqueue(profile: "Default", command: command, runner: { _, _ in
            throw EgoLaunchError.cliNotFound
        }) {
            XCTAssertEqual($0.exitCode, -1)
            XCTAssertFalse($0.errorOutput.isEmpty)
            failed.fulfill()
        }
        scheduler.enqueue(profile: "Default", command: command, runner: { _, complete in
            complete(EgoLaunchOutcome(exitCode: 0))
            return 42
        }) { _ in done.fulfill() }
        wait(for: [failed, done], timeout: 1)
    }

    func testDuplicateOldCompletionCannotReleaseNextRequest() throws {
        let scheduler = EgoLaunchScheduler()
        let state = ScheduledLaunchState()
        let done = expectation(description: "three complete once")
        done.expectedFulfillmentCount = 3
        let launcher = makeLauncher(scheduler: scheduler, state: state)
        for name in ["first", "second", "third"] {
            try launcher.launch(targetURL: url(name), profile: "Default") { _ in done.fulfill() }
        }
        scheduler.flushForTesting()
        state.complete(0)
        scheduler.flushForTesting()
        scheduler.flushForTesting()
        XCTAssertEqual(state.count, 2)
        state.complete(0)
        scheduler.flushForTesting()
        XCTAssertEqual(state.count, 2)
        state.complete(1)
        scheduler.flushForTesting()
        scheduler.flushForTesting()
        XCTAssertEqual(state.count, 3)
        state.complete(2)
        wait(for: [done], timeout: 1)
    }

    func testBurstOfOneHundredRequestsPreservesFIFOAndCompletesExactlyOnce() throws {
        let scheduler = EgoLaunchScheduler()
        let state = ScheduledLaunchState()
        let done = expectation(description: "all queued requests finish")
        done.expectedFulfillmentCount = 100
        done.assertForOverFulfill = true
        let launcher = makeLauncher(scheduler: scheduler, state: state)
        for index in 0..<100 {
            try launcher.launch(targetURL: url("request-\(index)/"), profile: "Default") { _ in done.fulfill() }
        }
        scheduler.flushForTesting()
        XCTAssertEqual(state.count, 1)
        for index in 0..<100 {
            XCTAssertEqual(state.count, index + 1)
            XCTAssertTrue(state.commands[index].arguments[2].contains("request-\(index)"))
            state.complete(index)
            scheduler.flushForTesting()
            scheduler.flushForTesting()
        }
        wait(for: [done], timeout: 5)
        XCTAssertEqual(state.count, 100)
    }

    func testSynchronousCompletionThenThrowDoesNotCompleteTwiceOrStallQueue() {
        let scheduler = EgoLaunchScheduler()
        let first = expectation(description: "first outcome once")
        first.assertForOverFulfill = true
        let next = expectation(description: "next request starts")
        let command = EgoLaunchCommand(executableURL: URL(fileURLWithPath: "/tmp/unused"), arguments: [])
        scheduler.enqueue(profile: "Default", command: command, runner: { _, complete in
            complete(EgoLaunchOutcome(exitCode: 0))
            throw EgoLaunchError.cliNotFound
        }) { outcome in
            // Throw is handled on the scheduler before the queued completion.
            XCTAssertEqual(outcome.exitCode, -1)
            first.fulfill()
        }
        scheduler.enqueue(profile: "Default", command: command, runner: { _, complete in
            complete(EgoLaunchOutcome(exitCode: 0))
            return 42
        }) { outcome in
            XCTAssertEqual(outcome.exitCode, 0)
            next.fulfill()
        }
        wait(for: [first, next], timeout: 5)
        scheduler.flushForTesting()
    }

    private func url(_ name: String) -> URL { URL(string: "https://example.com/" + name.replacingOccurrences(of: " ", with: "%20"))! }

    private func makeLauncher(scheduler: EgoLaunchScheduler, state: ScheduledLaunchState) -> EgoBrowserLauncher {
        EgoBrowserLauncher(
            cliLocator: { URL(fileURLWithPath: "/tmp/ego-browser") },
            scheduler: scheduler,
            commandRunner: { command, completion in state.append(command, completion: completion); return 42 }
        )
    }
}

private final class ScheduledLaunchState: @unchecked Sendable {
    private let lock = NSLock()
    private var storedCommands: [EgoLaunchCommand] = []
    private var callbacks: [@Sendable (EgoLaunchOutcome) -> Void] = []
    var count: Int { lock.lock(); defer { lock.unlock() }; return storedCommands.count }
    var commands: [EgoLaunchCommand] { lock.lock(); defer { lock.unlock() }; return storedCommands }

    func append(_ command: EgoLaunchCommand, completion: @escaping @Sendable (EgoLaunchOutcome) -> Void) {
        lock.lock(); defer { lock.unlock() }
        storedCommands.append(command)
        callbacks.append(completion)
    }
    func complete(_ index: Int, exitCode: Int32 = 0) {
        lock.lock()
        let callback = callbacks[index]
        lock.unlock()
        callback(EgoLaunchOutcome(exitCode: exitCode))
    }
}
