import Foundation
import Darwin

public struct LaunchAtLogin {
    public static let defaultLabel = "com.harvey.fastfinicky"
    public static let legacyLabels = ["dev.fastfinicky.app"]

    private let agentDirectory: URL
    private let label: String
    private let legacyLabels: [String]
    private let appURL: URL
    private let fileManager: FileManager
    private let uid: uid_t
    private let commandRunner: ([String]) throws -> Void

    public init() {
        self.init(
            agentDirectory: FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library", isDirectory: true)
                .appendingPathComponent("LaunchAgents", isDirectory: true),
            appURL: Bundle.main.bundleURL
        )
    }

    init(
        agentDirectory: URL,
        label: String = LaunchAtLogin.defaultLabel,
        legacyLabels: [String] = LaunchAtLogin.legacyLabels,
        appURL: URL,
        fileManager: FileManager = .default,
        uid: uid_t = getuid(),
        commandRunner: @escaping ([String]) throws -> Void = LaunchAtLogin.runLaunchctl
    ) {
        self.agentDirectory = agentDirectory
        self.label = label
        self.legacyLabels = legacyLabels
        self.appURL = appURL
        self.fileManager = fileManager
        self.uid = uid
        self.commandRunner = commandRunner
    }

    public var isEnabled: Bool {
        fileManager.fileExists(atPath: plistURL.path)
    }

    public func setEnabled(_ enabled: Bool) throws {
        if enabled {
            try enable()
        } else {
            try disable()
        }
    }

    public func removeLegacyAgentsIfNeeded() {
        removeLegacyAgents()
    }

    var plistURL: URL {
        agentDirectory.appendingPathComponent("\(label).plist", isDirectory: false)
    }

    func plistContents() throws -> String {
        try validateAppBundle()
        let path = Self.xmlEscape(appURL.path)
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>Label</key>
          <string>\(Self.xmlEscape(label))</string>
          <key>LimitLoadToSessionType</key>
          <string>Aqua</string>
          <key>ProgramArguments</key>
          <array>
            <string>/usr/bin/open</string>
            <string>-ga</string>
            <string>\(path)</string>
          </array>
          <key>RunAtLoad</key>
          <true/>
        </dict>
        </plist>

        """
    }

    private func enable() throws {
        try validateAppBundle()
        removeLegacyAgents()
        try fileManager.createDirectory(at: agentDirectory, withIntermediateDirectories: true)
        let data = try plistContents().data(using: .utf8) ?? Data()
        try data.write(to: plistURL, options: .atomic)

        do {
            try loadAgent()
        } catch {
            try? fileManager.removeItem(at: plistURL)
            throw error
        }
    }

    private func disable() throws {
        unloadAgent()
        removeLegacyAgents()
        if fileManager.fileExists(atPath: plistURL.path) {
            try fileManager.removeItem(at: plistURL)
        }
    }

    private func loadAgent() throws {
        let domain = "gui/\(uid)"
        try? commandRunner(["bootout", "\(domain)/\(label)"])
        do {
            try commandRunner(["bootstrap", domain, plistURL.path])
        } catch {
            try commandRunner(["load", "-w", plistURL.path])
        }
    }

    private func unloadAgent() {
        let domain = "gui/\(uid)"
        try? commandRunner(["bootout", "\(domain)/\(label)"])
        try? commandRunner(["unload", "-w", plistURL.path])
    }

    private func removeLegacyAgents() {
        let domain = "gui/\(uid)"
        for legacy in legacyLabels where legacy != label {
            try? commandRunner(["bootout", "\(domain)/\(legacy)"])
            let legacyPlist = agentDirectory.appendingPathComponent("\(legacy).plist", isDirectory: false)
            try? commandRunner(["unload", "-w", legacyPlist.path])
            try? fileManager.removeItem(at: legacyPlist)
        }
    }

    private func validateAppBundle() throws {
        guard appURL.pathExtension == "app" else {
            throw FastFinickyError.launchAtLoginRequiresApp
        }
    }

    private static func xmlEscape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    private static func runLaunchctl(_ arguments: [String]) throws {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = arguments
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
        throw FastFinickyError.launchctlFailed(message)
    }
}
