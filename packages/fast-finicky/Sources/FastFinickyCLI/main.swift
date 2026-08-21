import FastFinickyCore
import Foundation

@main
struct FastFinickyCLI {
    static func main() {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard let url = value(for: "--url", in: arguments) else {
                printUsage()
                return
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
                let launcher = BrowserLauncher()
                _ = try launcher.launch(targetURL: launchURL, profile: decision.profile)
            }

            let payload = CLIOutput(configPath: paths.configURL.path, decision: decision)
            let data = try JSONEncoder.pretty.encode(payload)
            print(String(decoding: data, as: UTF8.self))
        } catch {
            fputs("fast-finicky error: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    private static func value(for flag: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else {
            return nil
        }
        return arguments[index + 1]
    }

    private static func printUsage() {
        print(
            """
            Usage:
              fast-finicky-cli --url <url> [--dry-run]

            Examples:
              fast-finicky-cli --url https://github.com --dry-run
              fast-finicky-cli --url https://meet.google.com
            """
        )
    }
}

private struct CLIOutput: Codable {
    let configPath: String
    let decision: RouteDecision
}

private extension JSONEncoder {
    static var pretty: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return encoder
    }
}
