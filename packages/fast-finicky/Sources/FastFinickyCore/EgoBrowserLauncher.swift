import Foundation

public enum EgoLaunchError: LocalizedError, Equatable {
    case cliNotFound
    case invalidProfile
    case unsupportedURL
    case commandFailed(Int32, String)

    public var errorDescription: String? {
        switch self {
        case .cliNotFound:
            return "ego-browser was not found in ~/.local/bin, /opt/homebrew/bin or /usr/local/bin. Complete Ego Lite's CLI setup first."
        case .invalidProfile:
            return "Ego requires an exact profile ID from profiles(); the active-profile alias 'default' is not supported."
        case .unsupportedURL:
            return "Ego routing supports only http, https and file URLs."
        case .commandFailed(let status, let detail):
            let suffix = detail.isEmpty ? "" : " Details: \(detail)"
            return "ego-browser exited with status \(status). Check Ego Lite is running, the CLI is connected, and the configured profile has a user-owned Space. No Chrome fallback was attempted.\(suffix)"
        }
    }
}

/// Ego has its own profile/session API. Never pass Chrome's --profile-directory
/// to it, or silently open the link in the currently active profile.
public struct EgoBrowserLauncher: Sendable {
    private let scheduler: EgoLaunchScheduler
    private let cliLocator: @Sendable () throws -> URL
    private let commandRunner: @Sendable (EgoLaunchCommand, @escaping @Sendable (EgoLaunchOutcome) -> Void) throws -> Int32

    public init() {
        self.init(cliLocator: { try Self.locateCLI() }, commandRunner: { command, completion in
            try Self.runCommand(command, completion: completion)
        })
    }

    init(
        cliLocator: @escaping @Sendable () throws -> URL,
        scheduler: EgoLaunchScheduler = .shared,
        commandRunner: @escaping @Sendable (EgoLaunchCommand, @escaping @Sendable (EgoLaunchOutcome) -> Void) throws -> Int32
    ) {
        self.scheduler = scheduler
        self.cliLocator = cliLocator
        self.commandRunner = commandRunner
    }

    /// Enqueues without waiting for a browser or a prior same-profile request.
    /// Completion reports spawn failures and CLI exit off the Apple Event path.
    public func launch(
        targetURL: URL,
        profile: String,
        completion: @escaping @Sendable (EgoLaunchOutcome) -> Void
    ) throws {
        let script = try Self.script(targetURL: targetURL, profile: profile)
        let command = try EgoLaunchCommand(executableURL: cliLocator(), arguments: ["nodejs", "-e", script])
        scheduler.enqueue(profile: profile, command: command, runner: commandRunner, completion: completion)
    }

    static func locateCLI(
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser,
        fileManager: FileManager = .default
    ) throws -> URL {
        // LaunchServices does not inherit the interactive shell's PATH. Use
        // known absolute locations rather than a shell or /usr/bin/env.
        let candidates = [
            homeDirectory.appendingPathComponent(".local/bin/ego-browser"),
            URL(fileURLWithPath: "/opt/homebrew/bin/ego-browser"),
            URL(fileURLWithPath: "/usr/local/bin/ego-browser")
        ]
        for candidate in candidates where fileManager.isExecutableFile(atPath: candidate.path) {
            return candidate
        }
        throw EgoLaunchError.cliNotFound
    }

    static func script(targetURL: URL, profile: String) throws -> String {
        guard !profile.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, profile != "default" else {
            throw EgoLaunchError.invalidProfile
        }
        guard ["http", "https", "file"].contains(targetURL.scheme?.lowercased() ?? "") else {
            throw EgoLaunchError.unsupportedURL
        }
        let input = EgoScriptInput(
            url: targetURL.absoluteString,
            profileId: profile
        )
        let json = String(decoding: try JSONEncoder().encode(input), as: UTF8.self)
        // JSON is data, not executable input. Process passes this as one argv
        // value without a shell; Node accepts JSON's Unicode string literals.
        return """
        const input = \(json);
        function checked(result, operation) {
          if (result && typeof result === "object" && result.error != null) {
            const error = new Error("Fast Finicky: " + operation + ": " + String(result.error));
            if (result.error_code) error.error_code = result.error_code;
            throw error;
          }
          return result;
        }
        async function spaces() {
          const result = checked(await ego.listTaskSpaces(), "listTaskSpaces");
          if (!Array.isArray(result?.taskSpaces)) {
            throw new Error("Fast Finicky: invalid listTaskSpaces response");
          }
          return result.taskSpaces;
        }
        const selected = (await spaces()).find(space =>
          space && space.profileId === input.profileId && space.ownership === "user"
        );
        if (!selected) {
          throw new Error("Fast Finicky: no existing user-owned Ego Space for profile " + input.profileId
            + ". Open that profile in Ego first; agent-owned Spaces are excluded. No Space was created.");
        }
        if (!Number.isSafeInteger(selected.id) || selected.id < 0) {
          throw new Error("Fast Finicky: selected Space has an invalid numeric ID");
        }
        // Recheck the selected destination rather than silently selecting a
        // different one if its ownership changes. The native API has no atomic
        // compare-and-claim; this reduces, but cannot eliminate, the race.
        const current = (await spaces()).find(space => space?.id === selected.id);
        if (!current || current.profileId !== input.profileId || current.ownership !== "user"
            || current.name !== selected.name) {
          throw new Error("Fast Finicky: selected Ego Space changed before opening; no retry");
        }
        const claimed = checked(await ego.claimTaskSpace(selected.id), "claimTaskSpace");
        if (claimed?.id !== selected.id) {
          throw new Error("Fast Finicky: claim returned an unexpected Space; stopped");
        }
        const confirmed = (await spaces()).find(space => space?.id === selected.id);
        if (!confirmed || confirmed.profileId !== input.profileId || confirmed.ownership !== "agent"
            || confirmed.name !== selected.name) {
          throw new Error("Fast Finicky: selected Ego Space changed after claiming; stopped");
        }
        const selectedId = checked(ego.useTaskSpace(selected.id), "useTaskSpace");
        if (selectedId !== selected.id) {
          throw new Error("Fast Finicky: could not select the requested Space; stopped");
        }
        // createTab dispatches URL opening without waiting for page load.
        // Native completion preserves every existing tab; never close tabs or
        // use the SDK's managed-page cleanup on this user's existing Space.
        const opened = checked(await ego.createTab(input.url), "createTab");
        if (typeof opened?.targetId !== "string" || !opened.targetId) {
          throw new Error("Fast Finicky: createTab returned no target ID; outcome uncertain, no retry");
        }
        const completed = checked(await ego.completeTaskSpace(), "completeTaskSpace");
        if (typeof completed !== "string") {
          throw new Error("Fast Finicky: completion outcome uncertain; no retry");
        }
        """
    }

    static func runCommand(
        _ command: EgoLaunchCommand,
        completion: @escaping @Sendable (EgoLaunchOutcome) -> Void
    ) throws -> Int32 {
        let process = Process()
        process.qualityOfService = .userInitiated
        process.executableURL = command.executableURL
        process.arguments = command.arguments
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        let errors = Pipe()
        process.standardError = errors
        try process.run()
        errors.fileHandleForWriting.closeFile()
        let pid = process.processIdentifier
        // Drain continuously so verbose errors cannot fill a pipe and stall the
        // child. Retain at most 8 KiB, and keep all waiting off the event thread.
        DispatchQueue.global(qos: .utility).async {
            var captured = Data()
            while true {
                let chunk = errors.fileHandleForReading.readData(ofLength: 4096)
                if chunk.isEmpty { break }
                if captured.count < 8192 {
                    captured.append(contentsOf: chunk.prefix(8192 - captured.count))
                }
            }
            errors.fileHandleForReading.closeFile()
            process.waitUntilExit()
            completion(EgoLaunchOutcome(
                exitCode: process.terminationStatus,
                errorOutput: String(decoding: captured, as: UTF8.self)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .replacingOccurrences(of: "\r", with: "\\r")
                    .replacingOccurrences(of: "\n", with: "\\n")
            ))
        }
        return pid
    }
}

struct EgoLaunchCommand: Equatable, Sendable {
    let executableURL: URL
    let arguments: [String]
}

private struct EgoScriptInput: Encodable {
    let url: String
    let profileId: String
}

public struct EgoLaunchOutcome: Equatable, Sendable {
    public let exitCode: Int32
    public let errorOutput: String

    public init(exitCode: Int32, errorOutput: String = "") {
        self.exitCode = exitCode
        self.errorOutput = errorOutput
    }
}
