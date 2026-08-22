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
            .appendingPathComponent(".config", isDirectory: true)
            .appendingPathComponent("fast-finicky", isDirectory: true)
        self.configURL = configDirectoryURL.appendingPathComponent("config.json", isDirectory: false)
        self.stateDirectoryURL = resolvedHome
            .appendingPathComponent(".local", isDirectory: true)
            .appendingPathComponent("state", isDirectory: true)
            .appendingPathComponent("fast-finicky", isDirectory: true)
        self.logsDirectoryURL = stateDirectoryURL.appendingPathComponent("logs", isDirectory: true)
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
