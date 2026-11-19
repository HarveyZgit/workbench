@testable import FastFinickyCore
import Foundation
import XCTest

final class DailyLoggerTests: XCTestCase {
    func testLoggerAppendsSortedEscapedFieldsAndKeepsExistingLines() throws {
        let home = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: home) }
        let logger = DailyLogger(paths: AppPaths(homeDirectory: home))
        let date = Date(timeIntervalSince1970: 1_700_000_000)
        let file = try logger.ensureTodayLogFile(referenceDate: date)
        logger.log("route", fields: ["z": "last", "a": "a \"quote\""], referenceDate: date)
        logger.log("open", fields: ["status": "completed"], referenceDate: date)
        logger.flushForTesting()
        let lines = try String(contentsOf: file, encoding: .utf8).split(separator: "\n")
        XCTAssertEqual(lines.count, 2)
        XCTAssertTrue(lines[0].contains("[route] a=\"a \\\"quote\\\"\" z=\"last\""))
        XCTAssertTrue(lines[1].contains("[open] status=\"completed\""))
        XCTAssertEqual(try logger.ensureTodayLogFile(referenceDate: date), file)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8).split(separator: "\n").count, 2)
    }

    func testRetentionKeepsUnrelatedFilesAndCanBeDisabled() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for name in ["2000-01-01.log", "notes.log", "2000-01-01.txt", ".2000-01-01.log"] {
            try Data("keep".utf8).write(to: directory.appendingPathComponent(name))
        }
        try LogFileTools.pruneLogs(in: directory, keepingLast: 0, referenceDate: Date())
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path).count, 4)
        try LogFileTools.pruneLogs(in: directory, keepingLast: 7, referenceDate: Date())
        XCTAssertEqual(Set(try FileManager.default.contentsOfDirectory(atPath: directory.path)), Set(["notes.log", "2000-01-01.txt", ".2000-01-01.log"]))
    }
}
