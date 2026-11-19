@testable import FastFinickyCore
import Foundation
import XCTest

final class EgoBrowserLauncherTests: XCTestCase {
    func testScriptInputIsJSONEncodedAndProfilesAreExact() throws {
        let profile = "Profile \"1\"\n\\中文"
        let url = try XCTUnwrap(URL(string: "https://example.com/a?q=%22;evil()&x=$HOME#中文"))
        let script = try EgoBrowserLauncher.script(targetURL: url, profile: profile)
        let line = try XCTUnwrap(script.components(separatedBy: "\n").first)
        let json = String(line.dropFirst("const input = ".count).dropLast())
        let input = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: String])
        XCTAssertEqual(input["url"], url.absoluteString)
        XCTAssertEqual(input["profileId"], profile)
        XCTAssertTrue(script.contains("space.profileId === input.profileId"))
        XCTAssertTrue(script.contains("space.ownership === \"user\""))
        XCTAssertTrue(script.contains("ego.createTab(input.url)"))
        XCTAssertTrue(script.contains("ego.completeTaskSpace()"))
        XCTAssertFalse(script.contains("createTaskSpace"))
    }

    func testRejectsImplicitProfileAndNonBrowserSchemes() throws {
        let url = try XCTUnwrap(URL(string: "https://example.com"))
        for profile in ["", "  ", "default"] {
            XCTAssertThrowsError(try EgoBrowserLauncher.script(targetURL: url, profile: profile))
        }
        // Ego's real, case-sensitive Default ID is not the lowercase alias.
        XCTAssertNoThrow(try EgoBrowserLauncher.script(targetURL: url, profile: "Default"))
        XCTAssertThrowsError(try EgoBrowserLauncher.script(
            targetURL: XCTUnwrap(URL(string: "javascript:alert(1)")), profile: "Default"
        ))
    }

    func testLaunchPassesOneScriptArgumentWithoutShellAndForwardsExitStatus() throws {
        let state = EgoLaunchTestState()
        let executable = URL(fileURLWithPath: "/tmp/path with spaces/ego-browser")
        let launcher = EgoBrowserLauncher(cliLocator: { executable }, commandRunner: { command, completion in
            state.command = command
            completion(EgoLaunchOutcome(exitCode: 7, errorOutput: "profile unavailable"))
            return 42
        })
        let completed = expectation(description: "CLI completion")
        try launcher.launch(targetURL: URL(fileURLWithPath: "/tmp/a b.html"), profile: "Default") {
            state.outcome = $0
            completed.fulfill()
        }
        wait(for: [completed], timeout: 1)
        XCTAssertEqual(state.command?.executableURL, executable)
        XCTAssertEqual(state.command?.arguments.count, 3)
        let command = try XCTUnwrap(state.command)
        XCTAssertEqual(Array(command.arguments.prefix(2)), ["nodejs", "-e"])
        XCTAssertTrue(state.command?.arguments[2].contains("file:") == true)
        XCTAssertEqual(state.outcome, EgoLaunchOutcome(exitCode: 7, errorOutput: "profile unavailable"))
    }

    func testMissingCLIDoesNotLaunchOrFallBack() throws {
        let launcher = EgoBrowserLauncher(cliLocator: { throw EgoLaunchError.cliNotFound }, commandRunner: { _, _ in
            XCTFail("Must not run any command")
            return 0
        })
        XCTAssertThrowsError(try launcher.launch(targetURL: URL(fileURLWithPath: "/tmp/index.html"), profile: "Default") { _ in })
    }

    func testCLIDiscoveryUsesUserLocalBinWithoutShellPATH() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: home) }
        let cli = home.appendingPathComponent(".local/bin/ego-browser")
        try FileManager.default.createDirectory(at: cli.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: cli)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: cli.path)
        XCTAssertEqual(try EgoBrowserLauncher.locateCLI(homeDirectory: home), cli)
    }
}

private final class EgoLaunchTestState: @unchecked Sendable {
    var command: EgoLaunchCommand?
    var outcome: EgoLaunchOutcome?
}
