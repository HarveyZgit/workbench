import Foundation

public struct ExtractedUpdate: Equatable {
    public let appURL: URL
    public let version: String
}

public enum AppUpdateError: Error, Equatable, LocalizedError, Sendable {
    case zipMissingApp
    case invalidInfoPlist
    case wrongBundleIdentifier(String)
    case missingExecutable
    case notAnAppBundle
    case commandFailed(String, String)

    public var errorDescription: String? {
        switch self {
        case .zipMissingApp:
            return "The zip does not contain Fast Finicky.app."
        case .invalidInfoPlist:
            return "The update is missing a valid Info.plist."
        case .wrongBundleIdentifier(let identifier):
            let value = identifier.isEmpty ? "(missing)" : identifier
            return "The zip is not a Fast Finicky app (bundle id \(value))."
        case .missingExecutable:
            return "The update is missing Contents/MacOS/FastFinicky."
        case .notAnAppBundle:
            return "Install Update requires Fast Finicky.app."
        case .commandFailed(let command, let message):
            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                return "\(command) failed."
            }
            return "\(command) failed: \(trimmed)"
        }
    }
}

public struct AppUpdater {
    public static let bundleIdentifier = "com.harvey.fastfinicky"
    public static let appFileName = "Fast Finicky.app"
    public static let stagingAppFileName = "Fast Finicky.app.new"
    public static let backupAppFileName = "Fast Finicky.app.old"
    public static let executableName = "FastFinicky"

    private let fileManager: FileManager
    private let commandRunner: ([String]) throws -> Void

    public init() {
        self.init(fileManager: .default, commandRunner: AppUpdater.runCommand)
    }

    init(
        fileManager: FileManager = .default,
        commandRunner: @escaping ([String]) throws -> Void
    ) {
        self.fileManager = fileManager
        self.commandRunner = commandRunner
    }

    public func extract(zip: URL, to workDirectory: URL) throws -> ExtractedUpdate {
        try fileManager.createDirectory(at: workDirectory, withIntermediateDirectories: true)
        try commandRunner(["/usr/bin/xattr", "-cr", zip.path])
        try commandRunner(["/usr/bin/ditto", "-x", "-k", zip.path, workDirectory.path])
        let appURL = try findApp(in: workDirectory)
        try commandRunner(["/usr/bin/xattr", "-cr", appURL.path])
        let version = try validate(appAt: appURL)
        return ExtractedUpdate(appURL: appURL, version: version)
    }

    public func stage(_ extracted: ExtractedUpdate, nextTo currentApp: URL) throws -> URL {
        guard currentApp.pathExtension == "app" else {
            throw AppUpdateError.notAnAppBundle
        }
        let staging = currentApp.deletingLastPathComponent().appendingPathComponent(Self.stagingAppFileName)
        if fileManager.fileExists(atPath: staging.path) {
            try fileManager.removeItem(at: staging)
        }
        try commandRunner(["/usr/bin/ditto", extracted.appURL.path, staging.path])
        try commandRunner(["/usr/bin/xattr", "-cr", staging.path])
        return staging
    }

    public func findApp(in root: URL) throws -> URL {
        let direct = root.appendingPathComponent(Self.appFileName)
        if fileManager.fileExists(atPath: direct.path) {
            return direct
        }
        let contents = try fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )
        if let match = contents.first(where: { $0.lastPathComponent == Self.appFileName }) {
            return match
        }
        for item in contents {
            let nested = item.appendingPathComponent(Self.appFileName)
            if fileManager.fileExists(atPath: nested.path) {
                return nested
            }
        }
        throw AppUpdateError.zipMissingApp
    }

    public func validate(appAt url: URL) throws -> String {
        let plistURL = url.appendingPathComponent("Contents/Info.plist")
        let executableURL = url.appendingPathComponent("Contents/MacOS/\(Self.executableName)")
        guard fileManager.fileExists(atPath: executableURL.path) else {
            throw AppUpdateError.missingExecutable
        }
        guard let dict = NSDictionary(contentsOf: plistURL) as? [String: Any] else {
            throw AppUpdateError.invalidInfoPlist
        }
        let identifier = dict["CFBundleIdentifier"] as? String ?? ""
        guard identifier == Self.bundleIdentifier else {
            throw AppUpdateError.wrongBundleIdentifier(identifier)
        }
        return (dict["CFBundleShortVersionString"] as? String ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public static func stagingURL(nextTo currentApp: URL) -> URL {
        currentApp.deletingLastPathComponent().appendingPathComponent(stagingAppFileName)
    }

    public static func backupURL(nextTo currentApp: URL) -> URL {
        currentApp.deletingLastPathComponent().appendingPathComponent(backupAppFileName)
    }

    public static func replacementScript() -> String {
        """
        #!/bin/bash
        set -euo pipefail
        CURRENT="$1"
        STAGING="$2"
        PID="$3"
        OLD="${CURRENT}.old"
        reopen() {
          if [ -d "$CURRENT" ]; then
            /usr/bin/open "$CURRENT" 2>/dev/null || true
          elif [ -d "$OLD" ]; then
            /bin/mv "$OLD" "$CURRENT" 2>/dev/null || true
            /usr/bin/open "$CURRENT" 2>/dev/null || true
          fi
        }
        i=0
        while /bin/kill -0 "$PID" 2>/dev/null; do
          sleep 0.1
          i=$((i + 1))
          if [ "$i" -gt 100 ]; then
            reopen
            exit 1
          fi
        done
        sleep 0.3
        if [ ! -d "$STAGING" ]; then
          reopen
          exit 1
        fi
        /bin/rm -rf "$OLD"
        if ! /bin/mv "$CURRENT" "$OLD"; then
          reopen
          exit 1
        fi
        if ! /bin/mv "$STAGING" "$CURRENT"; then
          reopen
          exit 1
        fi
        /bin/rm -rf "$OLD" || true
        /usr/bin/xattr -cr "$CURRENT" || true
        /usr/bin/open "$CURRENT" || true
        """
    }

    public static func isNewer(latest: String, than current: String) -> Bool {
        let latestParts = versionParts(latest)
        let currentParts = versionParts(current)
        let count = max(latestParts.count, currentParts.count)
        for index in 0..<count {
            let latestPart = index < latestParts.count ? latestParts[index] : 0
            let currentPart = index < currentParts.count ? currentParts[index] : 0
            if latestPart != currentPart {
                return latestPart > currentPart
            }
        }
        return false
    }

    public static func normalizedVersion(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first, first == "v" || first == "V", trimmed.count > 1 else {
            return trimmed
        }
        let second = trimmed[trimmed.index(after: trimmed.startIndex)]
        guard second.isNumber else {
            return trimmed
        }
        return String(trimmed.dropFirst())
    }

    private static func versionParts(_ raw: String) -> [Int] {
        normalizedVersion(raw)
            .split(separator: ".")
            .map { Int($0) ?? 0 }
    }

    private static func runCommand(_ arguments: [String]) throws {
        guard let executable = arguments.first else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = Array(arguments.dropFirst())
        process.standardInput = FileHandle.nullDevice
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        process.waitUntilExit()
        if process.terminationStatus == 0 {
            return
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        let message = String(data: data, encoding: .utf8) ?? ""
        throw AppUpdateError.commandFailed(executable, message)
    }
}
