@testable import FastFinickyCore
import Foundation
import XCTest

final class FastFinickyCoreTests: XCTestCase {
    func testConfigStoreBootstrapsDefaultConfig() throws {
        let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)

        let store = try ConfigStore(paths: AppPaths(homeDirectory: tempHome))
        XCTAssertEqual(store.currentConfig.defaultProfile, "Profile 1")
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.paths.configURL.path))
    }

    func testRoutingMatchesFirstRuleAndIgnoresQuery() throws {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [
                ConfigRule(contains: ["github.com/openai"], profile: "Profile 9"),
                ConfigRule(contains: ["github.com"], profile: "Profile 4")
            ]
        )
        let engine = RoutingEngine()
        let decision = try engine.decide(urlString: "https://github.com/openai/openai?tab=readme", config: config)

        XCTAssertEqual(decision.profile, "Profile 9")
        XCTAssertEqual(decision.matchedRuleIndex, Optional(0))
        XCTAssertEqual(decision.matchText, "github.com/openai/openai")
    }

    func testContainsTokenFromFullURLUsesHostAndPath() throws {
        XCTAssertEqual(
            try RoutingEngine.containsToken(fromUserInput: "https://github.com/openai/openai?tab=readme#setup"),
            "github.com/openai/openai"
        )
        XCTAssertEqual(
            try RoutingEngine.containsToken(fromUserInput: "  Example.COM/Docs  "),
            "example.com/docs"
        )
        XCTAssertEqual(
            try RoutingEngine.containsToken(fromUserInput: "chrome://settings/"),
            "chrome://settings/"
        )
    }

    func testProfileOptionListPrefersRuleLabelsThenDiscovered() {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [ConfigRule(contains: ["github.com"], profile: "Profile 4", name: "Haevy")]
        )
        let options = ProfileOption.list(
            from: config,
            discovered: [
                ChromeProfileEntry(profile: "Profile 4", name: "Ignored"),
                ChromeProfileEntry(profile: "Default", name: "Harvey", email: "a@example.com")
            ]
        )
        XCTAssertEqual(options.map(\.directory), ["Profile 4", "Profile 1", "Default"])
        XCTAssertEqual(options[0].title, "Haevy — Profile 4")
        XCTAssertEqual(options[2].title, "Harvey — Default — a@example.com")

        let unlabeled = AppConfig(defaultProfile: "Default", rules: [])
        let labeledDefault = ProfileOption.list(
            from: unlabeled,
            discovered: [ChromeProfileEntry(profile: "Default", name: "Harvey")]
        )
        XCTAssertEqual(labeledDefault[0].title, "Harvey — Default")
    }

    func testConfigStoreAddRulePrependsWithoutDroppingExisting() throws {
        let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)
        let paths = AppPaths(homeDirectory: tempHome)
        try paths.ensureBaseDirectories()
        try Data(#"{ "defaultProfile": "Profile 1", "rules": [{ "contains": ["github.com"], "profile": "Profile 4" }] }"#.utf8)
            .write(to: paths.configURL)

        let store = try ConfigStore(paths: paths)
        try store.addRule(ConfigRule(contains: ["github.com/openai"], profile: "Profile 9", name: "Work"))

        XCTAssertEqual(store.currentConfig.rules.map(\.profile), ["Profile 9", "Profile 4"])
        XCTAssertEqual(store.currentConfig.rules[0].contains, ["github.com/openai"])
        XCTAssertEqual(store.currentConfig.rules[1].contains, ["github.com"])
    }

    func testRoutingFallsBackToDefaultProfile() throws {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [ConfigRule(contains: ["internal-only"], profile: "Profile 9")]
        )
        let engine = RoutingEngine()
        let decision = try engine.decide(urlString: "https://example.com/docs", config: config)

        XCTAssertEqual(decision.profile, "Profile 1")
        XCTAssertNil(decision.matchedRuleIndex)
    }

    func testLogRetentionDeletesOldFiles() throws {
        let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let paths = AppPaths(homeDirectory: tempHome)
        try paths.ensureBaseDirectories()

        let calendar = Calendar(identifier: .gregorian)
        let referenceDate = try XCTUnwrap(LogFileTools.parseDay("2026-03-20"))

        let keepDates = ["2026-03-20", "2026-03-19", "2026-03-18", "2026-03-17", "2026-03-16", "2026-03-15", "2026-03-14"]
        let dropDates = ["2026-03-13", "2026-03-01"]

        for name in keepDates + dropDates {
            let url = paths.logsDirectoryURL.appendingPathComponent("\(name).log")
            try Data().write(to: url)
        }

        try LogFileTools.pruneLogs(in: paths.logsDirectoryURL, keepingLast: 7, referenceDate: referenceDate, calendar: calendar)

        for name in keepDates {
            XCTAssertTrue(FileManager.default.fileExists(atPath: paths.logsDirectoryURL.appendingPathComponent("\(name).log").path))
        }

        for name in dropDates {
            XCTAssertFalse(FileManager.default.fileExists(atPath: paths.logsDirectoryURL.appendingPathComponent("\(name).log").path))
        }
    }

    func testBrowserLauncherUsesDirectBinaryForWebURLs() throws {
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

        let targetURL = try XCTUnwrap(URL(string: "https://example.com/docs?q=1"))
        let result = try launcher.launch(targetURL: targetURL, profile: "Profile 7")

        XCTAssertEqual(result.appURL, chromeAppURL)
        XCTAssertEqual(result.strategy, .directBinary)
        XCTAssertEqual(result.targetKind, .webURL)

        let command = try XCTUnwrap(state.recordedCommand)
        XCTAssertEqual(
            command.executableURL,
            chromeAppURL
                .appendingPathComponent("Contents", isDirectory: true)
                .appendingPathComponent("MacOS", isDirectory: true)
                .appendingPathComponent("Google Chrome", isDirectory: false)
        )
        XCTAssertEqual(command.arguments, [
            "--profile-directory=Profile 7",
            "https://example.com/docs?q=1"
        ])
        XCTAssertEqual(state.activationAttempts, 1)
        XCTAssertNil(state.scheduledRetryDelay)
    }

    func testBrowserLauncherUsesOpenFallbackForFileURLsAndSchedulesOneRetry() throws {
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

        XCTAssertEqual(result.appURL, chromeAppURL)
        XCTAssertEqual(result.strategy, .openCommandFallback)
        XCTAssertEqual(result.targetKind, .fileURL)

        let command = try XCTUnwrap(state.recordedCommand)
        XCTAssertEqual(command.executableURL, URL(fileURLWithPath: "/usr/bin/open"))
        XCTAssertEqual(command.arguments, [
            "-n",
            "-a",
            chromeAppURL.path,
            "--args",
            "--profile-directory=Profile 3",
            "/tmp/fixtures/index.html"
        ])
        XCTAssertEqual(state.activationAttempts, 1)
        XCTAssertEqual(state.scheduledRetryDelay, Optional(0.1))

        let retry = try XCTUnwrap(state.scheduledRetry)
        retry()
        XCTAssertEqual(state.activationAttempts, 2)
    }

    func testConfigStoreReloadKeepsLastGoodConfigOnInvalidJSON() throws {
        let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)

        let store = try ConfigStore(paths: AppPaths(homeDirectory: tempHome))
        let original = store.currentConfig

        try Data("{not json".utf8).write(to: store.paths.configURL)
        XCTAssertThrowsError(try store.reload())
        XCTAssertEqual(store.currentConfig, original)
    }

    func testConfigStoreRejectsEmptyDefaultProfile() throws {
        let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)
        let paths = AppPaths(homeDirectory: tempHome)
        try paths.ensureBaseDirectories()
        try Data(#"{ "defaultProfile": "  ", "rules": [] }"#.utf8).write(to: paths.configURL)

        XCTAssertThrowsError(try ConfigStore(paths: paths)) { error in
            XCTAssertEqual(
                error as? FastFinickyError,
                .invalidConfig("defaultProfile must not be empty")
            )
        }
    }

    func testEmptyContainsNeverMatchesAndFallsBackToDefault() throws {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [
                ConfigRule(contains: [], profile: "Default", name: "Harvey", email: "a@example.com"),
                ConfigRule(contains: ["github.com"], profile: "Profile 4")
            ]
        )
        let engine = RoutingEngine()
        let unmatched = try engine.decide(urlString: "https://example.com/docs", config: config)
        XCTAssertEqual(unmatched.profile, "Profile 1")
        XCTAssertNil(unmatched.matchedRuleIndex)

        let matched = try engine.decide(urlString: "https://github.com/openai", config: config)
        XCTAssertEqual(matched.profile, "Profile 4")
    }

    func testRoutingMatchesFileURLPath() throws {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [ConfigRule(contains: ["tmp/docs/index.html"], profile: "Profile 4")]
        )
        let engine = RoutingEngine()
        let decision = try engine.decide(urlString: "file:///tmp/docs/index.html", config: config)

        XCTAssertEqual(decision.profile, "Profile 4")
        XCTAssertTrue(decision.matchText.contains("tmp/docs/index.html"))
    }

    func testChromeLocalStateReadsProfileSnapshot() {
        let json = Data(#"{ "profile": { "last_used": "/Users/me/Library/Application Support/Google/Chrome/Profile 9", "last_active_profiles": ["Profile 9"] } }"#.utf8)
        let snapshot = ChromeLocalState.snapshot(fromLocalStateJSON: json)
        XCTAssertEqual(snapshot.lastUsedDirectory, "Profile 9")
        XCTAssertEqual(snapshot.lastActiveDirectories, ["Profile 9"])
        XCTAssertTrue(snapshot.canReuseRunningInstance(for: "Profile 9"))
        XCTAssertFalse(snapshot.canReuseRunningInstance(for: "Profile 1"))

        let multi = Data(#"{ "profile": { "last_used": "Profile 9", "last_active_profiles": ["Profile 9", "Profile 1"] } }"#.utf8)
        XCTAssertFalse(ChromeLocalState.snapshot(fromLocalStateJSON: multi).canReuseRunningInstance(for: "Profile 9"))

        let lastUsedOnly = Data(#"{ "profile": { "last_used": "Profile 9" } }"#.utf8)
        XCTAssertFalse(ChromeLocalState.snapshot(fromLocalStateJSON: lastUsedOnly).canReuseRunningInstance(for: "Profile 9"))

        let lastUsedEmptyActive = Data(#"{ "profile": { "last_used": "Profile 9", "last_active_profiles": [] } }"#.utf8)
        XCTAssertTrue(ChromeLocalState.snapshot(fromLocalStateJSON: lastUsedEmptyActive).canReuseRunningInstance(for: "Profile 9"))

        let empty = Data(#"{ "profile": { "last_used": "  " } }"#.utf8)
        XCTAssertNil(ChromeLocalState.snapshot(fromLocalStateJSON: empty).lastUsedDirectory)
    }

    func testBrowserLauncherReusesRunningChromeWhenProfileMatches() throws {
        let chromeAppURL = try makeFakeChromeApp()
        let state = LauncherTestState()
        let targetURL = try XCTUnwrap(URL(string: "https://example.com/docs"))

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
            },
            isChromeRunning: { true },
            chromeProfileSnapshot: {
                ChromeProfileSnapshot(
                    lastUsedDirectory: "Profile 7",
                    lastActiveDirectories: ["Profile 7"],
                    lastActiveProfilesPresent: true
                )
            },
            reuseRunningChrome: { url, appURL, profile in
                state.reusedURL = url
                state.reusedAppURL = appURL
                state.reusedProfile = profile
            }
        )

        let result = try launcher.launch(targetURL: targetURL, profile: "Profile 7")

        XCTAssertEqual(result.strategy, .reuseRunningInstance)
        XCTAssertEqual(result.targetKind, .webURL)
        XCTAssertNil(state.recordedCommand)
        XCTAssertEqual(state.activationAttempts, 0)
        XCTAssertEqual(state.reusedURL, targetURL)
        XCTAssertEqual(state.reusedAppURL, chromeAppURL)
        XCTAssertEqual(state.reusedProfile, "Profile 7")
    }

    func testBrowserLauncherSpawnsWithoutActivatingWhenRunningProfileDiffers() throws {
        let chromeAppURL = try makeFakeChromeApp()
        let state = LauncherTestState()
        let targetURL = try XCTUnwrap(URL(string: "https://example.com/docs"))

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
            },
            isChromeRunning: { true },
            chromeProfileSnapshot: {
                ChromeProfileSnapshot(
                    lastUsedDirectory: "Profile 1",
                    lastActiveDirectories: ["Profile 1"],
                    lastActiveProfilesPresent: true
                )
            },
            reuseRunningChrome: { _, _, _ in
                state.reuseCalled = true
            }
        )

        let result = try launcher.launch(targetURL: targetURL, profile: "Profile 7")

        XCTAssertEqual(result.strategy, .directBinary)
        XCTAssertFalse(state.reuseCalled)
        XCTAssertEqual(state.activationAttempts, 0)
        XCTAssertNil(state.scheduledRetryDelay)
        let command = try XCTUnwrap(state.recordedCommand)
        XCTAssertEqual(command.arguments, [
            "--profile-directory=Profile 7",
            "https://example.com/docs"
        ])
    }

    func testBrowserLauncherSpawnsWhenMultipleProfilesAreActive() throws {
        let chromeAppURL = try makeFakeChromeApp()
        let state = LauncherTestState()
        let targetURL = try XCTUnwrap(URL(string: "https://example.com/docs"))

        let launcher = BrowserLauncher(
            commandRunner: { command in
                state.recordedCommand = command
            },
            chromeAppLocator: { chromeAppURL },
            activateChrome: {
                state.activationAttempts += 1
                return true
            },
            activationRetryScheduler: { _, _ in },
            isChromeRunning: { true },
            chromeProfileSnapshot: {
                ChromeProfileSnapshot(
                    lastUsedDirectory: "Profile 7",
                    lastActiveDirectories: ["Profile 7", "Profile 1"],
                    lastActiveProfilesPresent: true
                )
            },
            reuseRunningChrome: { _, _, _ in
                state.reuseCalled = true
            }
        )

        let result = try launcher.launch(targetURL: targetURL, profile: "Profile 7")

        XCTAssertEqual(result.strategy, .directBinary)
        XCTAssertFalse(state.reuseCalled)
        XCTAssertEqual(state.activationAttempts, 0)
        XCTAssertNotNil(state.recordedCommand)
    }

    func testBrowserLauncherUsesOpenFallbackWithoutForegroundWhenChromeIsRunning() throws {
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
            },
            isChromeRunning: { true },
            chromeProfileSnapshot: {
                ChromeProfileSnapshot(
                    lastUsedDirectory: "Profile 1",
                    lastActiveDirectories: ["Profile 1"],
                    lastActiveProfilesPresent: true
                )
            }
        )

        let fileURL = URL(fileURLWithPath: "/tmp/fixtures/index.html")
        let result = try launcher.launch(targetURL: fileURL, profile: "Profile 3")

        XCTAssertEqual(result.strategy, .openCommandFallback)
        XCTAssertEqual(state.activationAttempts, 0)
        let command = try XCTUnwrap(state.recordedCommand)
        XCTAssertEqual(command.arguments, [
            "-g",
            "-n",
            "-a",
            chromeAppURL.path,
            "--args",
            "--profile-directory=Profile 3",
            "/tmp/fixtures/index.html"
        ])
    }

    func testChromeWarmerMapsAndKeepsFrameworkResident() throws {
        let appURL = try makeFakeChromeApp()
        let frameworkURL = appURL
            .appendingPathComponent("Contents", isDirectory: true)
            .appendingPathComponent("Frameworks", isDirectory: true)
            .appendingPathComponent("Google Chrome Framework.framework", isDirectory: true)
            .appendingPathComponent("Versions", isDirectory: true)
            .appendingPathComponent("Current", isDirectory: true)
            .appendingPathComponent("Google Chrome Framework", isDirectory: false)
        try FileManager.default.createDirectory(
            at: frameworkURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
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
        XCTAssertNotNil(residentFraction)
        XCTAssertGreaterThanOrEqual(residentFraction ?? 0, 0.9)

        let firstIdentity = try XCTUnwrap(warmer.mappedIdentityForTesting())

        let replacement = Data(repeating: 0xCD, count: 5 * 1_048_576)
        try FileManager.default.removeItem(at: frameworkURL)
        try replacement.write(to: frameworkURL)

        let remappedFraction = warmer.warmSynchronouslyForTesting()
        XCTAssertNotNil(remappedFraction)
        let secondIdentity = try XCTUnwrap(warmer.mappedIdentityForTesting())
        XCTAssertNotEqual(secondIdentity.inode, firstIdentity.inode)
        XCTAssertEqual(secondIdentity.size, replacement.count)
    }

    func testAppConfigDecodesMissingProfilesAsEmpty() throws {
        let json = Data(#"{ "defaultProfile": "Profile 1", "rules": [] }"#.utf8)
        let config = try JSONDecoder().decode(AppConfig.self, from: json)
        XCTAssertEqual(config.profiles, [])
    }

    func testChromeLocalStateDiscoversProfilesAndSkipsGuestSystemEphemeral() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        let localState = Data("""
        {
          "profile": {
            "info_cache": {
              "Default": { "name": "Person 1", "user_name": "a@example.com", "is_ephemeral": false },
              "Profile 2": { "name": "Work", "user_name": "work@example.com" },
              "Guest Profile": { "name": "Guest" },
              "System Profile": { "name": "System" },
              "Profile 3": { "name": "Temp", "is_ephemeral": true }
            }
          }
        }
        """.utf8)
        try localState.write(to: root.appendingPathComponent("Local State"))

        for name in ["Default", "Profile 2", "Profile 3", "Profile 4", "Guest Profile", "System Profile"] {
            try makeChromeProfileDirectory(at: root, name: name)
        }

        let discovered = ChromeLocalState.discoverProfiles(userDataDirectory: root)
        XCTAssertEqual(discovered.map(\.profile), ["Default", "Profile 2", "Profile 4"])
        XCTAssertEqual(discovered[0].email, "a@example.com")
        XCTAssertEqual(discovered[1].name, "Work")
        XCTAssertNil(discovered[2].name)
        XCTAssertNil(discovered[2].email)
    }

    func testDiscoverReadsEmailFromPreferencesWhenLocalStateUserNameIsEmpty() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data(#"{ "profile": { "info_cache": { "Profile 9": { "name": "Cloudvxz", "user_name": "" } } } }"#.utf8)
            .write(to: root.appendingPathComponent("Local State"))
        try makeChromeProfileDirectory(at: root, name: "Profile 9")
        let preferences = root
            .appendingPathComponent("Profile 9", isDirectory: true)
            .appendingPathComponent("Preferences")
        try Data(#"{ "account_info": [{ "email": "work@bytedance.com", "full_name": "Cloud" }] }"#.utf8)
            .write(to: preferences)

        let discovered = ChromeLocalState.discoverProfiles(userDataDirectory: root)
        XCTAssertEqual(discovered.count, 1)
        XCTAssertEqual(discovered[0].profile, "Profile 9")
        XCTAssertEqual(discovered[0].name, "Cloudvxz")
        XCTAssertEqual(discovered[0].email, "work@bytedance.com")
    }

    func testDiscoverDoesNotUseStaleGoogleServicesUsername() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data(#"{ "profile": { "info_cache": { "Profile 9": { "name": "Cloudvxz", "user_name": "" } } } }"#.utf8)
            .write(to: root.appendingPathComponent("Local State"))
        try makeChromeProfileDirectory(at: root, name: "Profile 9")
        try Data(#"{ "google": { "services": { "last_username": "old@example.com" } } }"#.utf8)
            .write(
                to: root
                    .appendingPathComponent("Profile 9", isDirectory: true)
                    .appendingPathComponent("Preferences")
            )

        let discovered = ChromeLocalState.discoverProfiles(userDataDirectory: root)
        XCTAssertEqual(discovered.count, 1)
        XCTAssertEqual(discovered[0].name, "Cloudvxz")
        XCTAssertNil(discovered[0].email)
    }

    func testProfileSetupAddsMissingProfilesAsRulesAndNeverDeletes() throws {
        let existing = ConfigRule(contains: ["example.com"], profile: "Profile 2")
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [existing],
            profiles: [ChromeProfileEntry(profile: "Profile 99", name: "Kept")]
        )
        let discovered = [
            ChromeProfileEntry(profile: "Default", name: "Person 1", email: "a@example.com"),
            ChromeProfileEntry(profile: "Profile 2", name: "Work"),
            ChromeProfileEntry(profile: "Profile 4")
        ]

        let (merged, added, labeled) = ChromeProfileSetup.merge(discovered: discovered, into: config)
        XCTAssertEqual(added.map(\.profile), ["Default", "Profile 4", "Profile 99"])
        XCTAssertEqual(labeled, 1)
        XCTAssertEqual(merged.defaultProfile, "Profile 1")
        XCTAssertEqual(merged.profiles, [])
        XCTAssertEqual(merged.rules.count, 4)
        XCTAssertEqual(merged.rules[0].contains, existing.contains)
        XCTAssertEqual(merged.rules[0].profile, existing.profile)
        XCTAssertEqual(merged.rules[0].name, "Work")
        XCTAssertEqual(merged.rules[1].profile, "Default")
        XCTAssertEqual(merged.rules[1].contains, [])
        XCTAssertEqual(merged.rules[1].name, "Person 1")
        XCTAssertEqual(merged.rules[1].email, "a@example.com")
        XCTAssertEqual(merged.rules[2].profile, "Profile 4")
        XCTAssertEqual(merged.rules[2].contains, [])
        XCTAssertEqual(merged.rules[3].profile, "Profile 99")
        XCTAssertEqual(merged.rules[3].contains, [])
        XCTAssertEqual(merged.rules[3].name, "Kept")

        let (again, addedAgain, labeledAgain) = ChromeProfileSetup.merge(discovered: discovered, into: merged)
        XCTAssertTrue(addedAgain.isEmpty)
        XCTAssertEqual(labeledAgain, 0)
        XCTAssertEqual(again.rules, merged.rules)

        let (withoutDisk, removedOnDisk, labeledOnDisk) = ChromeProfileSetup.merge(
            discovered: [ChromeProfileEntry(profile: "Default", email: "a@example.com")],
            into: merged
        )
        XCTAssertTrue(removedOnDisk.isEmpty)
        XCTAssertEqual(labeledOnDisk, 0)
        XCTAssertEqual(withoutDisk.rules.map(\.profile), ["Profile 2", "Default", "Profile 4", "Profile 99"])
    }

    func testProfileSetupDoesNotRewriteExistingContains() throws {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [
                ConfigRule(
                    contains: ["work"],
                    profile: "Default",
                    name: "Work",
                    email: "a@example.com"
                )
            ]
        )
        let discovered = [
            ChromeProfileEntry(profile: "Default", name: "Work", email: "a@example.com")
        ]

        let (merged, added, labeled) = ChromeProfileSetup.merge(discovered: discovered, into: config)
        XCTAssertTrue(added.isEmpty)
        XCTAssertEqual(labeled, 0)
        XCTAssertEqual(merged.rules[0].contains, ["work"])
        XCTAssertEqual(merged.rules[0].email, "a@example.com")
    }

    func testSetupFillsMissingEmailWithoutChangingContains() throws {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [ConfigRule(contains: ["github.com"], profile: "Profile 4")]
        )
        let discovered = [
            ChromeProfileEntry(profile: "Profile 4", name: "Haevy", email: "haevy@example.com")
        ]

        let (merged, added, labeled) = ChromeProfileSetup.merge(discovered: discovered, into: config)
        XCTAssertTrue(added.isEmpty)
        XCTAssertEqual(labeled, 1)
        XCTAssertEqual(merged.rules[0].contains, ["github.com"])
        XCTAssertEqual(merged.rules[0].profile, "Profile 4")
        XCTAssertEqual(merged.rules[0].name, "Haevy")
        XCTAssertEqual(merged.rules[0].email, "haevy@example.com")
    }

    func testSetupDoesNotOverwriteExistingNameOrEmail() throws {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [
                ConfigRule(
                    contains: ["github.com"],
                    profile: "Profile 4",
                    name: "Mine",
                    email: "mine@example.com"
                ),
                ConfigRule(
                    contains: ["work"],
                    profile: "Profile 9",
                    name: "Keep Name"
                )
            ]
        )
        let discovered = [
            ChromeProfileEntry(profile: "Profile 4", name: "Chrome", email: "chrome@example.com"),
            ChromeProfileEntry(profile: "Profile 9", name: "Cloud", email: "work@bytedance.com")
        ]

        let (merged, added, labeled) = ChromeProfileSetup.merge(discovered: discovered, into: config)
        XCTAssertTrue(added.isEmpty)
        XCTAssertEqual(labeled, 1)
        XCTAssertEqual(merged.rules[0].contains, ["github.com"])
        XCTAssertEqual(merged.rules[0].profile, "Profile 4")
        XCTAssertEqual(merged.rules[0].name, "Mine")
        XCTAssertEqual(merged.rules[0].email, "mine@example.com")
        XCTAssertEqual(merged.rules[1].contains, ["work"])
        XCTAssertEqual(merged.rules[1].profile, "Profile 9")
        XCTAssertEqual(merged.rules[1].name, "Keep Name")
        XCTAssertEqual(merged.rules[1].email, "work@bytedance.com")
    }

    func testConfigStoreSetupFillsEmailFromPreferencesOnExistingRule() throws {
        let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let chromeRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: chromeRoot, withIntermediateDirectories: true)

        let paths = AppPaths(homeDirectory: tempHome)
        try paths.ensureBaseDirectories()
        try Data(#"{ "defaultProfile": "Profile 1", "rules": [{ "contains": ["github.com"], "profile": "Profile 9" }] }"#.utf8)
            .write(to: paths.configURL)

        try Data(#"{ "profile": { "info_cache": { "Profile 9": { "name": "Cloudvxz", "user_name": "" } } } }"#.utf8)
            .write(to: chromeRoot.appendingPathComponent("Local State"))
        try makeChromeProfileDirectory(at: chromeRoot, name: "Profile 9")
        try Data(#"{ "account_info": [{ "email": "work@bytedance.com" }] }"#.utf8)
            .write(
                to: chromeRoot
                    .appendingPathComponent("Profile 9", isDirectory: true)
                    .appendingPathComponent("Preferences")
            )

        let store = try ConfigStore(paths: paths)
        let result = try store.setupProfiles(userDataDirectory: chromeRoot)
        XCTAssertTrue(result.added.isEmpty)
        XCTAssertEqual(result.labeled, 1)
        XCTAssertTrue(result.didChange)
        XCTAssertEqual(store.currentConfig.rules.count, 1)
        XCTAssertEqual(store.currentConfig.rules[0].contains, ["github.com"])
        XCTAssertEqual(store.currentConfig.rules[0].profile, "Profile 9")
        XCTAssertEqual(store.currentConfig.rules[0].name, "Cloudvxz")
        XCTAssertEqual(store.currentConfig.rules[0].email, "work@bytedance.com")
    }

    func testConfigStoreSetupProfilesWritesOnlyWhenAdding() throws {
        let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let chromeRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: chromeRoot, withIntermediateDirectories: true)

        let paths = AppPaths(homeDirectory: tempHome)
        try paths.ensureBaseDirectories()
        try Data(#"{ "defaultProfile": "Profile 1", "rules": [{ "contains": ["example.com"], "profile": "Profile 2" }] }"#.utf8)
            .write(to: paths.configURL)

        try Data(#"{ "profile": { "info_cache": { "Profile 2": { "name": "Work" }, "Profile 4": { "name": "New" } } } }"#.utf8)
            .write(to: chromeRoot.appendingPathComponent("Local State"))
        try makeChromeProfileDirectory(at: chromeRoot, name: "Profile 2")
        try makeChromeProfileDirectory(at: chromeRoot, name: "Profile 4")

        let store = try ConfigStore(paths: paths)
        let first = try store.setupProfiles(userDataDirectory: chromeRoot)
        XCTAssertEqual(first.discoveredCount, 2)
        XCTAssertEqual(first.added.map(\.profile), ["Profile 4"])
        XCTAssertEqual(store.currentConfig.profiles, [])
        XCTAssertEqual(store.currentConfig.rules.map(\.profile), ["Profile 2", "Profile 4"])
        XCTAssertEqual(store.currentConfig.rules[0].contains, ["example.com"])
        XCTAssertEqual(store.currentConfig.rules[0].name, "Work")
        XCTAssertEqual(store.currentConfig.rules[1].name, "New")

        let before = try Data(contentsOf: paths.configURL)
        let second = try store.setupProfiles(userDataDirectory: chromeRoot)
        XCTAssertTrue(second.added.isEmpty)
        XCTAssertEqual(try Data(contentsOf: paths.configURL), before)
    }

    func testSetupPreservesOriginalTranslatedRulesOnDisk() throws {
        let tempHome = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let chromeRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempHome, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: chromeRoot, withIntermediateDirectories: true)

        let original = DefaultConfigFactory.translatedCurrentRules()
        let originalPairs = original.rules.map { ($0.contains, $0.profile) }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

        let paths = AppPaths(homeDirectory: tempHome)
        try paths.ensureBaseDirectories()
        try encoder.encode(original).write(to: paths.configURL)

        let overlapping = ["Profile 4", "Profile 9", "Profile 1", "Default"]
        var infoCache: [String: [String: String]] = [:]
        for name in overlapping {
            infoCache[name] = ["name": name]
            try makeChromeProfileDirectory(at: chromeRoot, name: name)
        }
        let localState = try JSONSerialization.data(
            withJSONObject: ["profile": ["info_cache": infoCache]],
            options: []
        )
        try localState.write(to: chromeRoot.appendingPathComponent("Local State"))

        let store = try ConfigStore(paths: paths)
        let result = try store.setupProfiles(userDataDirectory: chromeRoot)
        XCTAssertEqual(Set(result.added.map(\.profile)), Set(["Default", "Profile 1"]))

        let disk = try JSONSerialization.jsonObject(with: Data(contentsOf: paths.configURL)) as? [String: Any]
        let diskRules = try XCTUnwrap(disk?["rules"] as? [[String: Any]])
        XCTAssertEqual(diskRules.count, original.rules.count + 2)

        for (index, pair) in originalPairs.enumerated() {
            let contains = diskRules[index]["contains"] as? [String]
            let profile = diskRules[index]["profile"] as? String
            XCTAssertEqual(contains, pair.0, "contains changed at rules[\(index)]")
            XCTAssertEqual(profile, pair.1, "profile changed at rules[\(index)]")
        }

        XCTAssertEqual(store.currentConfig.defaultProfile, "Profile 1")
        XCTAssertEqual(
            Array(store.currentConfig.rules.prefix(original.rules.count)).map(\.contains),
            original.rules.map(\.contains)
        )
        XCTAssertEqual(
            Array(store.currentConfig.rules.prefix(original.rules.count)).map(\.profile),
            original.rules.map(\.profile)
        )
    }

    func testLaunchAtLoginWritesAndRemovesAgentPlist() throws {
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let agents = temp.appendingPathComponent("LaunchAgents", isDirectory: true)
        let appURL = temp.appendingPathComponent("Fast Finicky.app", isDirectory: true)
        try FileManager.default.createDirectory(at: appURL, withIntermediateDirectories: true)

        var commands: [[String]] = []
        let login = LaunchAtLogin(
            agentDirectory: agents,
            appURL: appURL,
            uid: 501,
            commandRunner: { arguments in
                commands.append(arguments)
            }
        )

        XCTAssertFalse(login.isEnabled)
        try login.setEnabled(true)
        XCTAssertTrue(login.isEnabled)

        let plist = try String(contentsOf: login.plistURL, encoding: .utf8)
        XCTAssertTrue(plist.contains("<string>com.harvey.fastfinicky</string>"))
        XCTAssertTrue(plist.contains("<string>-ga</string>"))
        XCTAssertTrue(plist.contains("<string>\(appURL.path)</string>"))
        XCTAssertTrue(commands.contains(["bootout", "gui/501/dev.fastfinicky.app"]))
        XCTAssertTrue(commands.contains(["bootout", "gui/501/com.harvey.fastfinicky"]))
        XCTAssertTrue(commands.contains(["bootstrap", "gui/501", login.plistURL.path]))

        commands.removeAll()
        try login.setEnabled(false)
        XCTAssertFalse(login.isEnabled)
        XCTAssertFalse(FileManager.default.fileExists(atPath: login.plistURL.path))
        XCTAssertTrue(commands.contains(["bootout", "gui/501/com.harvey.fastfinicky"]))
    }

    func testLaunchAtLoginRemovesLegacyAgentPlist() throws {
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let agents = temp.appendingPathComponent("LaunchAgents", isDirectory: true)
        let appURL = temp.appendingPathComponent("Fast Finicky.app", isDirectory: true)
        try FileManager.default.createDirectory(at: appURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
        let legacyPlist = agents.appendingPathComponent("dev.fastfinicky.app.plist")
        try Data("<plist/>".utf8).write(to: legacyPlist)

        let login = LaunchAtLogin(
            agentDirectory: agents,
            appURL: appURL,
            uid: 501,
            commandRunner: { _ in }
        )
        try login.setEnabled(true)
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacyPlist.path))
        XCTAssertTrue(login.isEnabled)
    }

    func testLaunchAtLoginRequiresAppBundle() {
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let login = LaunchAtLogin(
            agentDirectory: temp,
            appURL: temp.appendingPathComponent("FastFinicky"),
            commandRunner: { _ in }
        )
        XCTAssertThrowsError(try login.setEnabled(true)) { error in
            XCTAssertEqual(error as? FastFinickyError, .launchAtLoginRequiresApp)
        }
    }

    func testLaunchAtLoginRollsBackPlistIfLaunchctlFails() throws {
        let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let agents = temp.appendingPathComponent("LaunchAgents", isDirectory: true)
        let appURL = temp.appendingPathComponent("Fast Finicky.app", isDirectory: true)
        try FileManager.default.createDirectory(at: appURL, withIntermediateDirectories: true)

        let login = LaunchAtLogin(
            agentDirectory: agents,
            appURL: appURL,
            commandRunner: { _ in
                throw FastFinickyError.launchctlFailed("denied")
            }
        )

        XCTAssertThrowsError(try login.setEnabled(true))
        XCTAssertFalse(login.isEnabled)
    }
}

private func makeChromeProfileDirectory(at root: URL, name: String) throws {
    let directory = root.appendingPathComponent(name, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data("{}".utf8).write(to: directory.appendingPathComponent("Preferences"))
}

private func makeFakeChromeApp() throws -> URL {
    let rootURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    let executableURL = rootURL
        .appendingPathComponent("Contents", isDirectory: true)
        .appendingPathComponent("MacOS", isDirectory: true)
        .appendingPathComponent("Google Chrome", isDirectory: false)

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
    var reusedURL: URL?
    var reusedAppURL: URL?
    var reusedProfile: String?
    var reuseCalled = false
}
