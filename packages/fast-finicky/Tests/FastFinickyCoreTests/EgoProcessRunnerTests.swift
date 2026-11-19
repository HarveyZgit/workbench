@testable import FastFinickyCore
import Foundation
import XCTest

/// Real subprocess tests using temporary scripts, without Ego or a browser.
final class EgoProcessRunnerTests: XCTestCase {
    func testArgumentsStayLiteralAndNonzeroExitIsReportedOnce() throws {
        let cli = try makeCLI("printf '%s' \"$1\" >&2\nexit 7\n")
        defer { try? FileManager.default.removeItem(at: cli.deletingLastPathComponent()) }
        let complete = expectation(description: "process exits")
        complete.assertForOverFulfill = true
        let literal = "spaces ; $(echo injected) ' \" 中文"
        let pid = try EgoBrowserLauncher.runCommand(EgoLaunchCommand(executableURL: cli, arguments: [literal])) {
            XCTAssertEqual($0.exitCode, 7)
            XCTAssertEqual($0.errorOutput, literal)
            complete.fulfill()
        }
        XCTAssertGreaterThan(pid, 0)
        wait(for: [complete], timeout: 5)
    }

    func testVerboseStderrIsDrainedAndCaptureIsBounded() throws {
        let cli = try makeCLI("i=0; while [ $i -lt 5000 ]; do printf '0123456789abcdef0123456789abcdef' >&2; i=$((i+1)); done\nexit 9\n")
        defer { try? FileManager.default.removeItem(at: cli.deletingLastPathComponent()) }
        let complete = expectation(description: "large stderr does not deadlock")
        _ = try EgoBrowserLauncher.runCommand(EgoLaunchCommand(executableURL: cli, arguments: [])) {
            XCTAssertEqual($0.exitCode, 9)
            XCTAssertEqual($0.errorOutput.utf8.count, 8192)
            XCTAssertEqual($0.errorOutput, String(repeating: "0123456789abcdef", count: 512))
            complete.fulfill()
        }
        wait(for: [complete], timeout: 10)
    }

    func testStderrIsTrimmedAndNewlinesEscaped() throws {
        let cli = try makeCLI("printf '  first\\r\\nsecond\\n  ' >&2\n")
        defer { try? FileManager.default.removeItem(at: cli.deletingLastPathComponent()) }
        let complete = expectation(description: "stderr normalized")
        _ = try EgoBrowserLauncher.runCommand(EgoLaunchCommand(executableURL: cli, arguments: [])) {
            XCTAssertEqual($0.exitCode, 0)
            XCTAssertEqual($0.errorOutput, "first\\r\\nsecond")
            complete.fulfill()
        }
        wait(for: [complete], timeout: 5)
    }

    func testMissingExecutableThrowsWithoutCompletion() {
        let complete = expectation(description: "must not complete an unspawned process")
        complete.isInverted = true
        let missing = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        XCTAssertThrowsError(try EgoBrowserLauncher.runCommand(EgoLaunchCommand(executableURL: missing, arguments: [])) { _ in complete.fulfill() })
        wait(for: [complete], timeout: 0.1)
    }

    private func makeCLI(_ body: String) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ego runner " + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let cli = directory.appendingPathComponent("fake ego-browser")
        try Data(("#!/bin/sh\n" + body).utf8).write(to: cli)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: cli.path)
        return cli
    }
}
