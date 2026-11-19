@testable import FastFinickyCore
import Foundation
import XCTest

final class BrowserRoutingTests: XCTestCase {
    func testLegacyConfigAndInitializersDefaultToChrome() throws {
        let data = Data(#"{"defaultProfile":"Default","rules":[{"contains":["example.com"],"profile":"Profile 1"}]}"#.utf8)
        let config = try JSONDecoder().decode(AppConfig.self, from: data)

        XCTAssertEqual(config.rules[0].browser, .chrome)
        XCTAssertEqual(ConfigRule(contains: [], profile: "Default").browser, .chrome)
        XCTAssertEqual(ProfileOption(directory: "Default").browser, .chrome)
        XCTAssertEqual(
            RouteDecision(originalURL: "https://example.com", matchText: "example.com", profile: "Default").browser,
            .chrome
        )
    }

    func testLegacyRouteDecisionDecodesAsChrome() throws {
        let data = Data(#"{"originalURL":"https://example.com","matchText":"example.com","profile":"Default"}"#.utf8)
        let decision = try JSONDecoder().decode(RouteDecision.self, from: data)

        XCTAssertEqual(decision.browser, .chrome)
        XCTAssertNil(decision.matchedRuleIndex)
        XCTAssertNil(decision.matchedToken)
    }

    func testRoutingKeepsFirstMatchBrowserAndChromeFallback() throws {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [
                ConfigRule(contains: ["example.com/work"], profile: "Default", browser: .ego),
                ConfigRule(contains: ["example.com"], profile: "Profile 4")
            ]
        )
        let engine = RoutingEngine()
        let ego = try engine.decide(urlString: "https://EXAMPLE.com/work/task?view=1#details", config: config)
        XCTAssertEqual(ego.browser, .ego)
        XCTAssertEqual(ego.profile, "Default")
        XCTAssertEqual(ego.matchedRuleIndex, 0)
        XCTAssertEqual(ego.matchedToken, "example.com/work")

        let chrome = try engine.decide(urlString: "https://example.com/personal", config: config)
        XCTAssertEqual(chrome.browser, .chrome)
        XCTAssertEqual(chrome.profile, "Profile 4")

        let fallback = try engine.decide(urlString: "https://other.example/?next=example.com/work", config: config)
        XCTAssertEqual(fallback.browser, .chrome)
        XCTAssertEqual(fallback.profile, "Profile 1")
        XCTAssertNil(fallback.matchedRuleIndex)
    }

    func testFileRoutingCarriesEgoBrowser() throws {
        let config = AppConfig(
            defaultProfile: "Profile 1",
            rules: [ConfigRule(contains: ["/projects/docs"], profile: "Default", browser: .ego)]
        )
        let decision = try RoutingEngine().decide(urlString: "file:///projects/docs/index.html", config: config)

        XCTAssertEqual(decision.browser, .ego)
        XCTAssertEqual(decision.profile, "Default")
    }

    func testConfigAndRouteDecisionRoundTripKeepBrowser() throws {
        let config = AppConfig(
            defaultProfile: "Default",
            rules: [
                ConfigRule(contains: ["work.example"], profile: "Default", browser: .ego, name: "Work"),
                ConfigRule(contains: ["personal.example"], profile: "Default")
            ]
        )
        let data = try JSONEncoder().encode(config)
        XCTAssertEqual(try JSONDecoder().decode(AppConfig.self, from: data), config)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let rules = try XCTUnwrap(json["rules"] as? [[String: Any]])
        XCTAssertEqual(rules[0]["browser"] as? String, "ego")
        XCTAssertEqual(rules[1]["browser"] as? String, "chrome")

        let decision = try RoutingEngine().decide(urlString: "https://work.example", config: config)
        let encodedDecision = try JSONEncoder().encode(decision)
        XCTAssertEqual(try JSONDecoder().decode(RouteDecision.self, from: encodedDecision), decision)
    }

    func testConfigStoreNormalizationAndAddRulePreserveBrowser() throws {
        let home = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: home) }
        let paths = AppPaths(homeDirectory: home)
        try paths.ensureBaseDirectories()
        let data = Data(#"{"defaultProfile":" Default ","rules":[{"contains":[" EXISTING.EXAMPLE "],"profile":" Default ","browser":"ego","name":" Work "}]}"#.utf8)
        try data.write(to: paths.configURL)

        let store = try ConfigStore(paths: paths)
        XCTAssertEqual(store.currentConfig.rules[0].browser, .ego)
        XCTAssertEqual(store.currentConfig.rules[0].profile, "Default")
        XCTAssertEqual(store.currentConfig.rules[0].contains, ["existing.example"])
        XCTAssertEqual(store.currentConfig.rules[0].name, "Work")

        let rule = ConfigRule(contains: ["new.example"], profile: "Profile 2", browser: .ego)
        try store.addRule(rule)
        XCTAssertEqual(store.currentConfig.rules[0], rule)
        XCTAssertEqual(store.currentConfig.rules.map(\.browser), [.ego, .ego])
        let expected = store.currentConfig
        XCTAssertEqual(try store.reload(), expected)
        let saved = try JSONDecoder().decode(AppConfig.self, from: Data(contentsOf: paths.configURL))
        XCTAssertEqual(saved.rules.map(\.browser), [.ego, .ego])
    }

    func testConfigStoreSetupPersistsSeparateChromeAndEgoProfiles() throws {
        let home = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: home) }
        let chromeRoot = home.appendingPathComponent("Chrome", isDirectory: true)
        try FileManager.default.createDirectory(at: chromeRoot, withIntermediateDirectories: true)
        try Data(#"{"profile":{"info_cache":{"Default":{"name":"Chrome User","user_name":"chrome@example.com"}}}}"#.utf8)
            .write(to: chromeRoot.appendingPathComponent("Local State"))
        let paths = AppPaths(homeDirectory: home)
        try paths.ensureBaseDirectories()
        let ego = ConfigRule(contains: ["work.example"], profile: "Default", browser: .ego)
        try JSONEncoder().encode(AppConfig(defaultProfile: "Default", rules: [ego])).write(to: paths.configURL)

        let store = try ConfigStore(paths: paths)
        let result = try store.setupProfiles(userDataDirectory: chromeRoot)
        XCTAssertEqual(result.added.map(\.profile), ["Default"])
        XCTAssertEqual(result.labeled, 0)
        let reloaded = try store.reload()
        XCTAssertEqual(reloaded.rules.map(\.browser), [.ego, .chrome])
        XCTAssertEqual(reloaded.rules[0], ego)
        XCTAssertEqual(reloaded.rules[1].name, "Chrome User")
        XCTAssertEqual(reloaded.rules[1].email, "chrome@example.com")
    }

    func testUnknownBrowserReloadKeepsLastGoodConfig() throws {
        let home = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: home) }
        let store = try ConfigStore(paths: AppPaths(homeDirectory: home))
        let original = store.currentConfig
        let invalid = Data(#"{"defaultProfile":"Default","rules":[{"contains":["example.com"],"profile":"Default","browser":"unknown"}]}"#.utf8)
        try invalid.write(to: store.paths.configURL)

        XCTAssertThrowsError(try store.reload())
        XCTAssertEqual(store.currentConfig, original)
    }

    func testChromeSetupDoesNotLabelOrDeduplicateEgoRules() {
        let ego = ConfigRule(contains: ["work.example"], profile: "Default", browser: .ego)
        let config = AppConfig(defaultProfile: "Default", rules: [ego])
        let discovered = [ChromeProfileEntry(profile: "Default", name: "Chrome User", email: "chrome@example.com")]

        let (merged, added, labeled) = ChromeProfileSetup.merge(discovered: discovered, into: config)
        XCTAssertEqual(merged.rules.count, 2)
        XCTAssertEqual(merged.rules[0], ego)
        XCTAssertEqual(merged.rules[1].browser, .chrome)
        XCTAssertEqual(merged.rules[1].profile, "Default")
        XCTAssertEqual(merged.rules[1].name, "Chrome User")
        XCTAssertEqual(merged.rules[1].email, "chrome@example.com")
        XCTAssertEqual(merged.rules[1].contains, [])
        XCTAssertEqual(added, discovered)
        XCTAssertEqual(labeled, 0)

        let (again, addedAgain, labeledAgain) = ChromeProfileSetup.merge(discovered: discovered, into: merged)
        XCTAssertEqual(again, merged)
        XCTAssertTrue(addedAgain.isEmpty)
        XCTAssertEqual(labeledAgain, 0)
    }

    func testChromeSetupLabelsChromeOnlyWhenBrowserProfilesOverlap() {
        let ego = ConfigRule(contains: ["work.example"], profile: "Default", browser: .ego, name: "Ego User")
        let config = AppConfig(
            defaultProfile: "Default",
            rules: [ego, ConfigRule(contains: ["personal.example"], profile: "Default")]
        )
        let (merged, added, labeled) = ChromeProfileSetup.merge(
            discovered: [ChromeProfileEntry(profile: "Default", name: "Chrome User", email: "chrome@example.com")],
            into: config
        )

        XCTAssertTrue(added.isEmpty)
        XCTAssertEqual(labeled, 1)
        XCTAssertEqual(merged.rules[0], ego)
        XCTAssertEqual(merged.rules[1].browser, .chrome)
        XCTAssertEqual(merged.rules[1].contains, ["personal.example"])
        XCTAssertEqual(merged.rules[1].name, "Chrome User")
        XCTAssertEqual(merged.rules[1].email, "chrome@example.com")
    }

    func testLegacyProfilesStayChromeDuringSetupAndOptionListing() {
        let config = AppConfig(
            defaultProfile: "Default",
            rules: [ConfigRule(contains: [], profile: "Profile 2", browser: .ego)],
            profiles: [ChromeProfileEntry(profile: "Profile 2", name: "Legacy Chrome")]
        )
        let (merged, added, labeled) = ChromeProfileSetup.merge(discovered: [], into: config)
        XCTAssertEqual(merged.rules.map(\.browser), [.ego, .chrome])
        XCTAssertEqual(added.map(\.profile), ["Profile 2"])
        XCTAssertEqual(labeled, 0)
        XCTAssertTrue(merged.profiles.isEmpty)

        let options = ProfileOption.list(from: config, discovered: [])
        XCTAssertEqual(options.map(\.browser), [.ego, .chrome, .chrome])
        XCTAssertEqual(options.last?.directory, "Profile 2")
        XCTAssertEqual(options.last?.name, "Legacy Chrome")
    }

    func testProfileOptionsUseBrowserAndDirectoryIdentity() {
        let config = AppConfig(
            defaultProfile: "Default",
            rules: [
                ConfigRule(contains: [], profile: "Default", browser: .ego, name: "Ego User"),
                ConfigRule(contains: [], profile: "Default", browser: .ego, email: "ego@example.com")
            ]
        )
        let options = ProfileOption.list(
            from: config,
            discovered: [ChromeProfileEntry(profile: "Default", name: "Chrome User", email: "chrome@example.com")]
        )

        XCTAssertEqual(options.count, 2)
        XCTAssertEqual(options[0].browser, .ego)
        XCTAssertEqual(options[0].name, "Ego User")
        XCTAssertEqual(options[0].email, "ego@example.com")
        XCTAssertEqual(options[0].title, "Ego Lite — Ego User — Default — ego@example.com")
        XCTAssertEqual(options[1].browser, .chrome)
        XCTAssertEqual(options[1].name, "Chrome User")
        XCTAssertEqual(options[1].email, "chrome@example.com")
    }

    func testEgoProfileOptionIdentityIsCaseSensitive() {
        let config = AppConfig(
            defaultProfile: "Default",
            rules: [
                ConfigRule(contains: [], profile: "Foo", browser: .ego),
                ConfigRule(contains: [], profile: "foo", browser: .ego),
                ConfigRule(contains: [], profile: "Default", browser: .ego),
                ConfigRule(contains: [], profile: "default", browser: .ego),
                ConfigRule(contains: [], profile: "default")
            ]
        )
        let options = ProfileOption.list(from: config, discovered: [])

        XCTAssertEqual(options.map(\.directory), ["Foo", "foo", "Default", "default", "default"])
        XCTAssertEqual(options.map(\.browser), [.ego, .ego, .ego, .ego, .chrome])
    }

    private func makeTemporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}
