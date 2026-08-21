import Foundation

public enum LogFileTools {
    private static func makeDayFormatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }

    private static func makeTimestampFormatter() -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone.current
        return formatter
    }

    public static func logURL(in directory: URL, date: Date) -> URL {
        let day = makeDayFormatter().string(from: date)
        return directory.appendingPathComponent("\(day).log")
    }

    public static func parseDay(_ value: String) -> Date? {
        makeDayFormatter().date(from: value)
    }

    public static func timestampString(from date: Date) -> String {
        makeTimestampFormatter().string(from: date)
    }

    public static func ensureLogFileExists(at url: URL, fileManager: FileManager = .default) throws {
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !fileManager.fileExists(atPath: url.path) {
            try Data().write(to: url, options: .atomic)
        }
    }

    public static func pruneLogs(
        in directory: URL,
        keepingLast retentionDays: Int,
        referenceDate: Date,
        calendar: Calendar = Calendar(identifier: .gregorian),
        fileManager: FileManager = .default
    ) throws {
        guard retentionDays > 0 else { return }

        let startOfToday = calendar.startOfDay(for: referenceDate)
        guard let cutoff = calendar.date(byAdding: .day, value: -(retentionDays - 1), to: startOfToday) else {
            return
        }

        let urls = try fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )

        for url in urls where url.pathExtension == "log" {
            let basename = url.deletingPathExtension().lastPathComponent
            guard let date = parseDay(basename) else {
                continue
            }

            if date < cutoff {
                try? fileManager.removeItem(at: url)
            }
        }
    }
}
