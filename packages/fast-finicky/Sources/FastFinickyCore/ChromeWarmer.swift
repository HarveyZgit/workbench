import Foundation
import Darwin

/// Keeps Chrome's shared framework pages resident for `directBinary` launches.
///
/// The first map (and every remap) always faults pages into this process so RSS
/// holds the framework (~0.5 GB). `mincore` is system-wide and can look warm
/// even when this process has no PTEs — so a high mincore must not skip the
/// first touch. Timer ticks may skip once pages are faulted and mincore stays
/// at or above the threshold. Constraints: profile-independent; no `mlock`
/// (pages stay reclaimable); remap when `Versions/Current` changes inode.
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
    private var mappedResolvedPath: String?
    private var mappedDevice: dev_t = 0
    private var mappedInode: ino_t = 0
    private var didFaultPages = false

    private var currentInterval: TimeInterval
    private var consecutiveEvictions: Int = 0
    private var touchSink: UInt8 = 0
    private var stopped = false

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
        queue.sync {
            stopped = true
            tearDownLocked()
        }
    }

    /// Maps the framework, warms it once, and starts the residency timer.
    public func start() {
        queue.async { [self] in
            guard !stopped else { return }
            warmLocked(trigger: "start")
            scheduleTimerLocked(after: currentInterval)
        }
    }

    /// Opportunistic warm — called right after a real launch to stay hot during active use.
    public func warmNow() {
        queue.async { [self] in
            guard !stopped else { return }
            warmLocked(trigger: "launch")
        }
    }

    public func stop() {
        queue.sync {
            stopped = true
            tearDownLocked()
        }
    }

    // MARK: - Queue-isolated core

    private func tearDownLocked() {
        timer?.cancel()
        timer = nil
        unmapLocked()
    }

    private func warmLocked(trigger: String) {
        let mappedFresh = ensureMappedLocked()
        guard let address = mapAddress, mapLength > 0 else { return }

        let before = residentFractionLocked() ?? 0
        let needsWarm = mappedFresh || !didFaultPages || before < residencyThreshold

        if needsWarm {
            madvise(address, mapLength, MADV_WILLNEED)
            touchLocked(address: address, length: mapLength)
            didFaultPages = true
        }

        if trigger == "timer" {
            adjustIntervalLocked(evicted: before < residencyThreshold)
        }

        // Stay quiet on the common "still warm" timer tick; only log real work.
        guard needsWarm || trigger != "timer" else { return }

        let after = needsWarm ? (residentFractionLocked() ?? before) : before
        var fields: [String: String] = [
            "trigger": trigger,
            "warmed": needsWarm ? "true" : "false",
            "faulted": needsWarm ? "true" : "false",
            "resident_before": String(format: "%.2f", before),
            "resident_after": String(format: "%.2f", after),
            "interval_s": String(Int(currentInterval)),
            "size_mb": String(mapLength / 1_048_576)
        ]
        if let rss = processResidentSizeBytes() {
            fields["rss_mb"] = String(rss / 1_048_576)
        }
        logger?.log("warm", fields: fields)
    }

    /// Returns true only when this call created a new mapping.
    /// Reused mappings (same inode/device/resolved path) and errors return false.
    @discardableResult
    private func ensureMappedLocked() -> Bool {
        let appURL: URL
        do {
            appURL = try chromeAppLocator()
        } catch {
            logger?.log("warm_error", fields: [
                "stage": "locate",
                "error": error.localizedDescription
            ])
            return false
        }

        let path = Self.frameworkBinaryURL(forChromeApp: appURL).path
        var probe = stat()
        guard stat(path, &probe) == 0, probe.st_size > 0 else {
            logger?.log("warm_error", fields: [
                "stage": "stat",
                "path": path
            ])
            return false
        }

        let resolvedPath = URL(fileURLWithPath: path).resolvingSymlinksInPath().path
        if mapAddress != nil,
           mappedInode == probe.st_ino,
           mappedDevice == probe.st_dev,
           mappedResolvedPath == resolvedPath {
            return false
        }

        unmapLocked()

        let descriptor = open(path, O_RDONLY)
        if descriptor < 0 {
            logger?.log("warm_error", fields: [
                "stage": "open",
                "path": path,
                "errno": String(errno)
            ])
            return false
        }

        var info = stat()
        guard fstat(descriptor, &info) == 0, info.st_size > 0 else {
            close(descriptor)
            logger?.log("warm_error", fields: ["stage": "fstat", "path": path])
            return false
        }

        let length = Int(info.st_size)
        let address = mmap(nil, length, PROT_READ, MAP_SHARED, descriptor, 0)
        if address == MAP_FAILED || address == nil {
            close(descriptor)
            logger?.log("warm_error", fields: ["stage": "mmap", "errno": String(errno)])
            return false
        }

        fileDescriptor = descriptor
        mapAddress = address
        mapLength = length
        mappedPath = path
        mappedResolvedPath = resolvedPath
        mappedDevice = info.st_dev
        mappedInode = info.st_ino
        return true
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
        mappedResolvedPath = nil
        mappedDevice = 0
        mappedInode = 0
        didFaultPages = false
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

    /// This process's resident_size in bytes, or nil if `task_info` fails.
    private func processResidentSizeBytes() -> UInt64? {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(
            MemoryLayout<mach_task_basic_info>.size / MemoryLayout<natural_t>.size
        )
        let status = withUnsafeMutablePointer(to: &info) { pointer -> kern_return_t in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { rebound in
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), rebound, &count)
            }
        }
        guard status == KERN_SUCCESS else { return nil }
        return UInt64(info.resident_size)
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
            guard let self, !self.stopped else { return }
            self.warmLocked(trigger: "timer")
            self.scheduleTimerLocked(after: self.currentInterval)
        }
        timer = source
        source.resume()
    }

    private static func frameworkBinaryURL(forChromeApp appURL: URL) -> URL {
        appURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Frameworks", isDirectory: true)
            .appendingPathComponent("Google Chrome Framework.framework", isDirectory: true)
            .appendingPathComponent("Versions", isDirectory: true)
            .appendingPathComponent("Current", isDirectory: true)
            .appendingPathComponent("Google Chrome Framework", isDirectory: false)
    }

    /// Synchronously maps + warms the located framework and returns the resulting
    /// resident fraction. For tests only — exercises mmap/mincore/touch deterministically.
    func warmSynchronouslyForTesting() -> Double? {
        queue.sync {
            warmLocked(trigger: "test")
            return residentFractionLocked()
        }
    }

    func mappedIdentityForTesting() -> (inode: UInt64, size: Int)? {
        queue.sync {
            guard mapAddress != nil, mappedInode != 0 else { return nil }
            return (UInt64(mappedInode), mapLength)
        }
    }

    func didFaultPagesForTesting() -> Bool {
        queue.sync { didFaultPages }
    }
}
