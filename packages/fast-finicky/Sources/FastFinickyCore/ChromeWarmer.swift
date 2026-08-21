import Foundation
import Darwin

/// Keeps Google Chrome's shared framework binary resident in the unified buffer
/// cache so that the `directBinary` launch path stays "warm".
///
/// Why this exists:
/// - The hot path spawns the full Chrome binary to honor `--profile-directory`.
/// - When Chrome's (~458 MB, profile-independent) framework pages get evicted
///   after idle / memory pressure, that spawn must page the framework back in,
///   which was measured at ~6.8s cold vs ~0.1s warm.
///
/// Strategy:
/// - `mmap` the framework binary once (shares the same physical pages Chrome
///   already maps, so it adds ~no private memory while Chrome runs).
/// - On a timer, cheaply check residency with `mincore`; only when a meaningful
///   fraction has been evicted do we `madvise(WILLNEED)` + touch pages to fault
///   them back. A resident tick is a near-free no-op.
/// - `warmNow()` lets the launch path keep things hot during active use.
/// - Back off the interval when eviction recurs (real memory pressure) so we do
///   not thrash against the OS; reset to the base interval once warm again.
public final class ChromeWarmer: @unchecked Sendable {
    private let chromeAppLocator: @Sendable () throws -> URL
    private let logger: DailyLogger?
    private let baseInterval: TimeInterval
    private let maxInterval: TimeInterval
    private let residencyThreshold: Double

    private let queue = DispatchQueue(label: "fast-finicky.chrome-warmer", qos: .utility)
    private var timer: DispatchSourceTimer?

    // All mutable state below is queue-isolated.
    private var fileDescriptor: CInt = -1
    private var mapAddress: UnsafeMutableRawPointer?
    private var mapLength: Int = 0
    private var mappedPath: String?

    private var currentInterval: TimeInterval
    private var consecutiveEvictions: Int = 0
    private var touchSink: UInt8 = 0

    public init(
        chromeAppLocator: @escaping @Sendable () throws -> URL,
        logger: DailyLogger? = nil,
        baseInterval: TimeInterval = 30,
        maxInterval: TimeInterval = 300,
        residencyThreshold: Double = 0.9
    ) {
        self.chromeAppLocator = chromeAppLocator
        self.logger = logger
        self.baseInterval = baseInterval
        self.maxInterval = maxInterval
        self.residencyThreshold = residencyThreshold
        self.currentInterval = baseInterval
    }

    deinit {
        timer?.cancel()
        if let address = mapAddress, mapLength > 0 {
            munmap(address, mapLength)
        }
        if fileDescriptor >= 0 {
            close(fileDescriptor)
        }
    }

    /// Maps the framework, warms it once, and starts the residency timer.
    public func start() {
        queue.async { [self] in
            warmLocked(trigger: "start")
            scheduleTimerLocked(after: currentInterval)
        }
    }

    /// Opportunistic warm — called right after a real launch to stay hot during active use.
    public func warmNow() {
        queue.async { [self] in
            warmLocked(trigger: "launch")
        }
    }

    public func stop() {
        queue.async { [self] in
            timer?.cancel()
            timer = nil
            unmapLocked()
        }
    }

    // MARK: - Queue-isolated core

    private func warmLocked(trigger: String) {
        ensureMappedLocked()
        guard let address = mapAddress, mapLength > 0 else { return }

        let before = residentFractionLocked() ?? 0
        let needsWarm = before < residencyThreshold

        if needsWarm {
            madvise(address, mapLength, MADV_WILLNEED)
            touchLocked(address: address, length: mapLength)
        }

        if trigger == "timer" {
            adjustIntervalLocked(evicted: needsWarm)
        }

        // Stay quiet on the common "still warm" timer tick; only log real work.
        guard needsWarm || trigger != "timer" else { return }

        let after = needsWarm ? (residentFractionLocked() ?? before) : before
        logger?.log("warm", fields: [
            "trigger": trigger,
            "warmed": needsWarm ? "true" : "false",
            "resident_before": String(format: "%.2f", before),
            "resident_after": String(format: "%.2f", after),
            "interval_s": String(Int(currentInterval)),
            "size_mb": String(mapLength / 1_048_576)
        ])
    }

    private func ensureMappedLocked() {
        let appURL: URL
        do {
            appURL = try chromeAppLocator()
        } catch {
            logger?.log("warm_error", fields: [
                "stage": "locate",
                "error": error.localizedDescription
            ])
            return
        }

        let path = Self.frameworkBinaryURL(forChromeApp: appURL).path
        if mapAddress != nil, mappedPath == path {
            return
        }

        unmapLocked()

        let descriptor = open(path, O_RDONLY)
        if descriptor < 0 {
            logger?.log("warm_error", fields: [
                "stage": "open",
                "path": path,
                "errno": String(errno)
            ])
            return
        }

        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_size > 0 else {
            close(descriptor)
            logger?.log("warm_error", fields: ["stage": "fstat", "path": path])
            return
        }

        let length = Int(info.st_size)
        let address = mmap(nil, length, PROT_READ, MAP_SHARED, descriptor, 0)
        if address == MAP_FAILED || address == nil {
            close(descriptor)
            logger?.log("warm_error", fields: ["stage": "mmap", "errno": String(errno)])
            return
        }

        fileDescriptor = descriptor
        mapAddress = address
        mapLength = length
        mappedPath = path
    }

    private func unmapLocked() {
        if let address = mapAddress, mapLength > 0 {
            munmap(address, mapLength)
        }
        if fileDescriptor >= 0 {
            close(fileDescriptor)
        }
        mapAddress = nil
        mapLength = 0
        fileDescriptor = -1
        mappedPath = nil
    }

    /// Fraction of mapped pages currently resident in core, or nil if unavailable.
    private func residentFractionLocked() -> Double? {
        guard let address = mapAddress, mapLength > 0 else { return nil }

        let pageSize = Int(getpagesize())
        let pageCount = (mapLength + pageSize - 1) / pageSize
        var vector = [CChar](repeating: 0, count: pageCount)

        let result = vector.withUnsafeMutableBufferPointer { buffer in
            mincore(address, mapLength, buffer.baseAddress)
        }
        guard result == 0 else { return nil }

        var resident = 0
        for status in vector where (status & 1) != 0 {
            resident += 1
        }
        return Double(resident) / Double(pageCount)
    }

    /// Forces page-in by reading one byte per page; the accumulator defeats dead-code elimination.
    private func touchLocked(address: UnsafeMutableRawPointer, length: Int) {
        let pageSize = Int(getpagesize())
        let base = address.assumingMemoryBound(to: UInt8.self)
        var accumulator = touchSink
        var offset = 0
        while offset < length {
            accumulator = accumulator &+ base[offset]
            offset += pageSize
        }
        touchSink = accumulator
    }

    private func adjustIntervalLocked(evicted: Bool) {
        if evicted {
            consecutiveEvictions += 1
            if consecutiveEvictions >= 2 {
                currentInterval = min(maxInterval, currentInterval * 2)
            }
        } else {
            consecutiveEvictions = 0
            currentInterval = baseInterval
        }
    }

    private func scheduleTimerLocked(after interval: TimeInterval) {
        timer?.cancel()
        let source = DispatchSource.makeTimerSource(queue: queue)
        source.schedule(deadline: .now() + interval)
        source.setEventHandler { [weak self] in
            guard let self else { return }
            self.warmLocked(trigger: "timer")
            self.scheduleTimerLocked(after: self.currentInterval)
        }
        timer = source
        source.resume()
    }

    private static func frameworkBinaryURL(forChromeApp appURL: URL) -> URL {
        appURL.appending(
            path: "Contents/Frameworks/Google Chrome Framework.framework/Versions/Current/Google Chrome Framework",
            directoryHint: .notDirectory
        )
    }

    /// Synchronously maps + warms the located framework and returns the resulting
    /// resident fraction. For tests only — exercises mmap/mincore/touch deterministically.
    func warmSynchronouslyForTesting() -> Double? {
        queue.sync {
            warmLocked(trigger: "test")
            return residentFractionLocked()
        }
    }
}
