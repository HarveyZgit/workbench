import Foundation

public final class ConfigStore {
    public let paths: AppPaths
    public private(set) var currentConfig: AppConfig

    public init(paths: AppPaths = AppPaths()) throws {
        self.paths = paths
        try paths.ensureBaseDirectories()
        try Self.bootstrapIfNeeded(at: paths.configURL)
        self.currentConfig = try Self.loadConfig(from: paths.configURL)
    }

    @discardableResult
    public func reload() throws -> AppConfig {
        let next = try Self.loadConfig(from: paths.configURL)
        currentConfig = next
        return next
    }

    public func ensureConfigFileExists() throws {
        try Self.bootstrapIfNeeded(at: paths.configURL)
    }

    private static func bootstrapIfNeeded(at url: URL, fileManager: FileManager = .default) throws {
        guard !fileManager.fileExists(atPath: url.path) else {
            return
        }

        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(DefaultConfigFactory.translatedCurrentRules())
        try data.write(to: url, options: .atomic)
    }

    private static func loadConfig(from url: URL) throws -> AppConfig {
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        let decoded = try decoder.decode(AppConfig.self, from: data)
        return try normalize(decoded)
    }

    private static func normalize(_ config: AppConfig) throws -> AppConfig {
        let defaultProfile = config.defaultProfile.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !defaultProfile.isEmpty else {
            throw FastFinickyError.invalidConfig("defaultProfile must not be empty")
        }

        let rules = try config.rules.enumerated().map { index, rule in
            let profile = rule.profile.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !profile.isEmpty else {
                throw FastFinickyError.invalidConfig("rules[\(index)].profile must not be empty")
            }

            let contains = rule.contains
                .map { RoutingEngine.normalizeToken($0) }
                .filter { !$0.isEmpty }

            let name = emptyToNil(rule.name)
            let email = emptyToNil(rule.email)
            return ConfigRule(contains: contains, profile: profile, name: name, email: email)
        }

        let profiles = uniqueProfiles(config.profiles)
        return AppConfig(defaultProfile: defaultProfile, rules: rules, profiles: profiles)
    }

    private static func uniqueProfiles(_ entries: [ChromeProfileEntry]) -> [ChromeProfileEntry] {
        var seen = Set<String>()
        var result: [ChromeProfileEntry] = []

        for entry in entries {
            let profile = entry.profile.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !profile.isEmpty else {
                continue
            }

            let key = profile.lowercased()
            guard !seen.contains(key) else {
                continue
            }
            seen.insert(key)

            let name = entry.name?.trimmingCharacters(in: .whitespacesAndNewlines)
            let email = entry.email?.trimmingCharacters(in: .whitespacesAndNewlines)
            result.append(
                ChromeProfileEntry(
                    profile: profile,
                    name: (name?.isEmpty == false) ? name : nil,
                    email: (email?.isEmpty == false) ? email : nil
                )
            )
        }

        return result
    }

    private static func emptyToNil(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    @discardableResult
    public func setupProfiles() throws -> ProfileSetupResult {
        try setupProfiles(
            userDataDirectory: ChromeLocalState.defaultUserDataDirectory,
            fileManager: .default
        )
    }

    @discardableResult
    func setupProfiles(
        userDataDirectory: URL,
        fileManager: FileManager = .default
    ) throws -> ProfileSetupResult {
        try ensureConfigFileExists()
        let loaded = try reload()
        let discovered = ChromeLocalState.discoverProfiles(
            userDataDirectory: userDataDirectory,
            fileManager: fileManager
        )
        let (merged, added) = ChromeProfileSetup.merge(
            discovered: discovered,
            into: loaded
        )
        let result = ProfileSetupResult(
            discoveredCount: discovered.count,
            added: added
        )
        if result.didChange {
            try save(merged)
        }
        return result
    }

    public func addRule(_ rule: ConfigRule) throws {
        try ensureConfigFileExists()
        let loaded = try reload()
        let next = AppConfig(
            defaultProfile: loaded.defaultProfile,
            rules: [rule] + loaded.rules,
            profiles: loaded.profiles
        )
        try save(next)
    }

    private func save(_ config: AppConfig) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        try data.write(to: paths.configURL, options: .atomic)
        currentConfig = try Self.normalize(config)
    }
}

enum DefaultConfigFactory {
    static func translatedCurrentRules() -> AppConfig {
        AppConfig(
            defaultProfile: "Profile 1",
            rules: [
                ConfigRule(contains: ["antigravity.google"], profile: "Profile 43"),
                ConfigRule(contains: ["harveyzx"], profile: "Profile 4"),
                ConfigRule(contains: ["corehr680uat"], profile: "Profile 8"),
                ConfigRule(contains: ["people-byte-my.byteintl.com", "samebyte"], profile: "Profile 9"),
                ConfigRule(contains: ["corehr804uat"], profile: "Profile 30"),
                ConfigRule(contains: ["tsc57kd0hg"], profile: "Profile 31"),
                ConfigRule(contains: ["corehr-org155"], profile: "Profile 3"),
                ConfigRule(contains: ["c61h843yo5"], profile: "Profile 5"),
                ConfigRule(contains: ["xnn4p49f25"], profile: "Profile 7"),
                ConfigRule(contains: ["jo6j3f4n8l"], profile: "Profile 11"),
                ConfigRule(contains: ["ejt9lgzgu9"], profile: "Profile 17"),
                ConfigRule(contains: ["fkci4tp9z9"], profile: "Profile 32"),
                ConfigRule(contains: ["eiiwghczis"], profile: "Profile 27")
            ]
        )
    }
}
