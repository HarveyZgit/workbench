import Foundation

public final class DailyLogger: @unchecked Sendable {
    private let paths: AppPaths
    private let retentionDays: Int
    private let queue = DispatchQueue(label: "fast-finicky.logger", qos: .utility)

    public init(paths: AppPaths = AppPaths(), retentionDays: Int = 7) {
        self.paths = paths
        self.retentionDays = retentionDays
    }

    @discardableResult
    public func ensureTodayLogFile(referenceDate: Date = Date()) throws -> URL {
        try paths.ensureBaseDirectories()
        let url = LogFileTools.logURL(in: paths.logsDirectoryURL, date: referenceDate)
        try LogFileTools.ensureLogFileExists(at: url)
        try LogFileTools.pruneLogs(in: paths.logsDirectoryURL, keepingLast: retentionDays, referenceDate: referenceDate)
        return url
    }

    public func log(_ category: String, fields: [String: String], referenceDate: Date = Date()) {
        queue.async { [paths, retentionDays] in
            do {
                try paths.ensureBaseDirectories()
                let url = LogFileTools.logURL(in: paths.logsDirectoryURL, date: referenceDate)
                try LogFileTools.ensureLogFileExists(at: url)
                try LogFileTools.pruneLogs(in: paths.logsDirectoryURL, keepingLast: retentionDays, referenceDate: referenceDate)

                let timestamp = LogFileTools.timestampString(from: referenceDate)
                let payload = fields
                    .sorted { $0.key < $1.key }
                    .map { "\($0.key)=\(Self.escape($0.value))" }
                    .joined(separator: " ")
                let line = "\(timestamp) [\(category)] \(payload)\n"
                try Self.append(line: line, to: url)
            } catch {
                fputs("fast-finicky logger error: \(error.localizedDescription)\n", stderr)
            }
        }
    }

    private static func escape(_ value: String) -> String {
        "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
    }

    private static func append(line: String, to url: URL) throws {
        guard let data = line.data(using: .utf8) else { return }

        let handle = try FileHandle(forWritingTo: url)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    }
}
