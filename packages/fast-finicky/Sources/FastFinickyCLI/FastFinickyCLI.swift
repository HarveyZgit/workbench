import FastFinickyCore
import Foundation

@main
struct FastFinickyCLI {
    static func main() {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            if arguments.contains("--setup") {
                try runSetup()
                return
            }

            guard let url = value(for: "--url", in: arguments) else {
                printUsage()
                exit(2)
            }

            let dryRun = arguments.contains("--dry-run")

            let paths = AppPaths()
            let store = try ConfigStore(paths: paths)
            let engine = RoutingEngine()
            let decision = try engine.decide(urlString: url, config: store.currentConfig)

            if !dryRun {
                guard let launchURL = URL(string: url) else {
                    throw FastFinickyError.invalidURL(url)
                }
                if decision.browser == .ego {
                    // The diagnostic CLI waits for the result; the menu-bar app
                    // uses the same adapter asynchronously.
                    let completion = EgoCLICompletion()
                    try EgoBrowserLauncher().launch(targetURL: launchURL, profile: decision.profile) {
                        completion.finish($0)
                    }
                    let outcome = completion.wait()
                    guard outcome.exitCode == 0 else {
                        throw EgoLaunchError.commandFailed(outcome.exitCode, outcome.errorOutput)
                    }
                } else {
                    _ = try BrowserLauncher().launch(targetURL: launchURL, profile: decision.profile)
                }
            }

            let payload = CLIOutput(configPath: paths.configURL.path, decision: decision)
            let data = try JSONEncoder.pretty.encode(payload)
            print(String(decoding: data, as: UTF8.self))
        } catch {
            fputs("fast-finicky error: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    private static func runSetup() throws {
        let paths = AppPaths()
        let store = try ConfigStore(paths: paths)
        let result = try store.setupProfiles()
        let payload = SetupCLIOutput(
            configPath: paths.configURL.path,
            discovered: result.discoveredCount,
            added: result.added,
            labeled: result.labeled
        )
        let data = try JSONEncoder.pretty.encode(payload)
        print(String(decoding: data, as: UTF8.self))
    }

    private static func value(for flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }

    private static func printUsage() {
        fputs(
            """
            Usage:
              fast-finicky-cli --setup
              fast-finicky-cli --url <url> [--dry-run]

            Examples:
              fast-finicky-cli --setup
              fast-finicky-cli --url https://github.com --dry-run
              fast-finicky-cli --url https://meet.google.com

            """,
            stderr
        )
    }
}

private struct CLIOutput: Codable {
    let configPath: String
    let decision: RouteDecision
}

private struct SetupCLIOutput: Codable {
    let configPath: String
    let discovered: Int
    let added: [ChromeProfileEntry]
    let labeled: Int
}

private extension JSONEncoder {
    static var pretty: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}


private final class EgoCLICompletion: @unchecked Sendable {
    private let done = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var outcome = EgoLaunchOutcome(exitCode: -1)

    func finish(_ value: EgoLaunchOutcome) {
        lock.lock()
        outcome = value
        lock.unlock()
        done.signal()
    }

    func wait() -> EgoLaunchOutcome {
        done.wait()
        lock.lock()
        defer { lock.unlock() }
        return outcome
    }
}
