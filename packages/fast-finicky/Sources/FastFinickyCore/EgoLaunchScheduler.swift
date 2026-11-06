import Foundation

/// Serializes this process's opens for the same exact Ego profile. A new CLI
/// must not observe the temporary agent ownership held by our previous open.
final class EgoLaunchScheduler: @unchecked Sendable {
    static let shared = EgoLaunchScheduler()

    private let queue = DispatchQueue(label: "fast-finicky.ego-launches")
    private var pending: [String: [Request]] = [:]

    func enqueue(
        profile: String,
        command: EgoLaunchCommand,
        runner: @escaping @Sendable (EgoLaunchCommand, @escaping @Sendable (EgoLaunchOutcome) -> Void) throws -> Int32,
        completion: @escaping @Sendable (EgoLaunchOutcome) -> Void
    ) {
        queue.async {
            let shouldStart = self.pending[profile] == nil
            self.pending[profile, default: []].append(Request(command: command, runner: runner, completion: completion))
            if shouldStart { self.startNext(profile: profile) }
        }
    }

    private func startNext(profile: String) {
        guard let request = pending[profile]?.first else { return }
        do {
            _ = try request.runner(request.command) { outcome in
                self.queue.async {
                    self.finish(profile: profile, requestID: request.id, outcome: outcome)
                }
            }
        } catch {
            finish(profile: profile, requestID: request.id, outcome: EgoLaunchOutcome(exitCode: -1, errorOutput: error.localizedDescription))
        }
    }

    private func finish(profile: String, requestID: UUID, outcome: EgoLaunchOutcome) {
        guard var requests = pending[profile], requests.first?.id == requestID else { return }
        let completed = requests.removeFirst()
        pending[profile] = requests.isEmpty ? nil : requests
        // User callbacks never block the scheduler or the Apple Event thread.
        DispatchQueue.global(qos: .utility).async { completed.completion(outcome) }
        if !requests.isEmpty { queue.async { self.startNext(profile: profile) } }
    }

    /// Test-only barrier: drains queue bookkeeping, never waits for a browser.
    func flushForTesting() { queue.sync {} }

    private struct Request: Sendable {
        let id = UUID()
        let command: EgoLaunchCommand
        let runner: @Sendable (EgoLaunchCommand, @escaping @Sendable (EgoLaunchOutcome) -> Void) throws -> Int32
        let completion: @Sendable (EgoLaunchOutcome) -> Void
    }
}
