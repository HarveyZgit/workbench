import Foundation

public struct AppPaths: Sendable {
    public let homeDirectory: URL
    public let configDirectoryURL: URL
    public let configURL: URL
    public let stateDirectoryURL: URL
    public let logsDirectoryURL: URL

    public init(homeDirectory: URL? = nil) {
        let resolvedHome = homeDirectory ?? Self.resolveHomeDirectory()
        self.homeDirectory = resolvedHome
        self.configDirectoryURL = resolvedHome
            .appending(path: ".config", directoryHint: .isDirectory)
            .appending(path: "fast-finicky", directoryHint: .isDirectory)
        self.configURL = configDirectoryURL.appending(path: "config.json", directoryHint: .notDirectory)
        self.stateDirectoryURL = resolvedHome
            .appending(path: ".local", directoryHint: .isDirectory)
            .appending(path: "state", directoryHint: .isDirectory)
            .appending(path: "fast-finicky", directoryHint: .isDirectory)
        self.logsDirectoryURL = stateDirectoryURL.appending(path: "logs", directoryHint: .isDirectory)
    }

    public func ensureBaseDirectories(fileManager: FileManager = .default) throws {
        try fileManager.createDirectory(at: configDirectoryURL, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: logsDirectoryURL, withIntermediateDirectories: true)
    }

    private static func resolveHomeDirectory() -> URL {
        if let override = ProcessInfo.processInfo.environment["FAST_FINICKY_HOME"], !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }

        return URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
    }
}
