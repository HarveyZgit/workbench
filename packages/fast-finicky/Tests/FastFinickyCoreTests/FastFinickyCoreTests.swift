@testable import FastFinickyCore
import Foundation
import Testing

@Test
func configStoreBootstrapsDefaultConfig() throws {
    let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)

    let store = try ConfigStore(paths: AppPaths(homeDirectory: tempHome))
    #expect(store.currentConfig.defaultProfile == "Profile 1")
    #expect(FileManager.default.fileExists(atPath: store.paths.configURL.path))
}

@Test
func routingMatchesFirstRuleAndIgnoresQuery() throws {
    let config = AppConfig(
        defaultProfile: "Profile 1",
        rules: [
            ConfigRule(contains: ["github.com/openai"], profile: "Profile 9"),
            ConfigRule(contains: ["github.com"], profile: "Profile 4")
        ]
    )
    let engine = RoutingEngine()
    let decision = try engine.decide(urlString: "https://github.com/openai/openai?tab=readme", config: config)

    #expect(decision.profile == "Profile 9")
    #expect(decision.matchedRuleIndex == 0)
    #expect(decision.matchText == "github.com/openai/openai")
}

@Test
func routingFallsBackToDefaultProfile() throws {
    let config = AppConfig(
        defaultProfile: "Profile 1",
        rules: [ConfigRule(contains: ["internal-only"], profile: "Profile 9")]
    )
    let engine = RoutingEngine()
    let decision = try engine.decide(urlString: "https://example.com/docs", config: config)

    #expect(decision.profile == "Profile 1")
    #expect(decision.matchedRuleIndex == nil)
}

@Test
func logRetentionDeletesOldFiles() throws {
    let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let paths = AppPaths(homeDirectory: tempHome)
    try paths.ensureBaseDirectories()

    let calendar = Calendar(identifier: .gregorian)
    let referenceDate = try #require(LogFileTools.parseDay("2026-03-20"))

    let keepDates = ["2026-03-20", "2026-03-19", "2026-03-18", "2026-03-17", "2026-03-16", "2026-03-15", "2026-03-14"]
    let dropDates = ["2026-03-13", "2026-03-01"]

    for name in keepDates + dropDates {
        let url = paths.logsDirectoryURL.appendingPathComponent("\(name).log")
        try Data().write(to: url)
    }

    try LogFileTools.pruneLogs(in: paths.logsDirectoryURL, keepingLast: 7, referenceDate: referenceDate, calendar: calendar)

    for name in keepDates {
        #expect(FileManager.default.fileExists(atPath: paths.logsDirectoryURL.appendingPathComponent("\(name).log").path))
    }

    for name in dropDates {
        #expect(!FileManager.default.fileExists(atPath: paths.logsDirectoryURL.appendingPathComponent("\(name).log").path))
    }
}

@Test
func browserLauncherUsesDirectBinaryForWebURLs() throws {
    let chromeAppURL = try makeFakeChromeApp()
    let state = LauncherTestState()

    let launcher = BrowserLauncher(
        commandRunner: { command in
            state.recordedCommand = command
        },
        chromeAppLocator: { chromeAppURL },
        activateChrome: {
            state.activationAttempts += 1
            return true
        },
        activationRetryScheduler: { delay, _ in
            state.scheduledRetryDelay = delay
        }
    )

    let targetURL = try #require(URL(string: "https://example.com/docs?q=1"))
    let result = try launcher.launch(targetURL: targetURL, profile: "Profile 7")

    #expect(result.appURL == chromeAppURL)
    #expect(result.strategy == .directBinary)
    #expect(result.targetKind == .webURL)

    let command = try #require(state.recordedCommand)
    #expect(command.executableURL == chromeAppURL.appending(path: "Contents/MacOS/Google Chrome", directoryHint: .notDirectory))
    #expect(command.arguments == [
        "--profile-directory=Profile 7",
        "https://example.com/docs?q=1"
    ])
    #expect(state.activationAttempts == 1)
    #expect(state.scheduledRetryDelay == nil)
}

@Test
func browserLauncherUsesOpenFallbackForFileURLsAndSchedulesOneRetry() throws {
    let chromeAppURL = try makeFakeChromeApp()
    let state = LauncherTestState()

    let launcher = BrowserLauncher(
        commandRunner: { command in
            state.recordedCommand = command
        },
        chromeAppLocator: { chromeAppURL },
        activateChrome: {
            state.activationAttempts += 1
            return state.activationAttempts > 1
        },
        activationRetryScheduler: { delay, action in
            state.scheduledRetryDelay = delay
            state.scheduledRetry = action
        }
    )

    let fileURL = URL(fileURLWithPath: "/tmp/fixtures/index.html")
    let result = try launcher.launch(targetURL: fileURL, profile: "Profile 3")

    #expect(result.appURL == chromeAppURL)
    #expect(result.strategy == .openCommandFallback)
    #expect(result.targetKind == .fileURL)

    let command = try #require(state.recordedCommand)
    #expect(command.executableURL == URL(fileURLWithPath: "/usr/bin/open"))
    #expect(command.arguments == [
        "-n",
        "-a",
        chromeAppURL.path,
        "--args",
        "--profile-directory=Profile 3",
        "/tmp/fixtures/index.html"
    ])
    #expect(state.activationAttempts == 1)
    #expect(state.scheduledRetryDelay == 0.1)

    let retry = try #require(state.scheduledRetry)
    retry()
    #expect(state.activationAttempts == 2)
}

@Test
func chromeWarmerMapsAndKeepsFrameworkResident() throws {
    let appURL = try makeFakeChromeApp()
    let frameworkURL = appURL.appending(
        path: "Contents/Frameworks/Google Chrome Framework.framework/Versions/Current/Google Chrome Framework",
        directoryHint: .notDirectory
    )
    try FileManager.default.createDirectory(
        at: frameworkURL.deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    // A few MB of data so the mapping spans many pages.
    let payload = Data(repeating: 0xAB, count: 4 * 1_048_576)
    try payload.write(to: frameworkURL)

    let warmer = ChromeWarmer(
        chromeAppLocator: { appURL },
        logger: nil,
        baseInterval: 999,
        maxInterval: 999,
        residencyThreshold: 0.9
    )

    let residentFraction = warmer.warmSynchronouslyForTesting()
    #expect(residentFraction != nil)
    #expect((residentFraction ?? 0) >= 0.9)
}

private func makeFakeChromeApp() throws -> URL {
    let rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let executableURL = rootURL.appending(path: "Contents/MacOS/Google Chrome", directoryHint: .notDirectory)

    try FileManager.default.createDirectory(at: executableURL.deletingLastPathComponent(), withIntermediateDirectories: true)
    FileManager.default.createFile(atPath: executableURL.path, contents: Data())
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executableURL.path)

    return rootURL
}

private final class LauncherTestState: @unchecked Sendable {
    var recordedCommand: LaunchCommand?
    var activationAttempts = 0
    var scheduledRetryDelay: TimeInterval?
    var scheduledRetry: (@Sendable () -> Void)?
}
