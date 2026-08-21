import Foundation
import Darwin

public final class ConfigWatcher {
    private let directoryURL: URL
    private let callback: () -> Void
    private let debounceInterval: TimeInterval
    private let queue = DispatchQueue(label: "fast-finicky.config-watcher")

    private var descriptor: CInt = -1
    private var source: DispatchSourceFileSystemObject?
    private var pendingWorkItem: DispatchWorkItem?

    public init(configURL: URL, debounceInterval: TimeInterval = 0.35, callback: @escaping () -> Void) {
        self.directoryURL = configURL.deletingLastPathComponent()
        self.debounceInterval = debounceInterval
        self.callback = callback
    }

    public func start() throws {
        guard source == nil else { return }

        descriptor = open(directoryURL.path, O_EVTONLY)
        if descriptor < 0 {
            throw NSError(
                domain: "FastFinicky.ConfigWatcher",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Failed to watch config directory at \(directoryURL.path)"]
            )
        }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor,
            eventMask: [.write, .rename, .delete, .extend, .attrib, .link, .revoke],
            queue: queue
        )

        source.setEventHandler { [weak self] in
            self?.scheduleReload()
        }

        source.setCancelHandler { [descriptor] in
            if descriptor >= 0 {
                close(descriptor)
            }
        }

        self.source = source
        source.resume()
    }

    deinit {
        pendingWorkItem?.cancel()
        source?.cancel()
    }

    private func scheduleReload() {
        pendingWorkItem?.cancel()
        let work = DispatchWorkItem { [callback] in
            callback()
        }
        pendingWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + debounceInterval, execute: work)
    }
}
