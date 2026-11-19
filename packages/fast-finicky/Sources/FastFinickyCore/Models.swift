import Foundation

public struct AppConfig: Equatable, Sendable {
    public let defaultProfile: String
    public let rules: [ConfigRule]
    public let profiles: [ChromeProfileEntry]

    public init(defaultProfile: String, rules: [ConfigRule], profiles: [ChromeProfileEntry] = []) {
        self.defaultProfile = defaultProfile
        self.rules = rules
        self.profiles = profiles
    }
}

extension AppConfig: Codable {
    enum CodingKeys: String, CodingKey {
        case defaultProfile
        case rules
        case profiles
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        defaultProfile = try container.decode(String.self, forKey: .defaultProfile)
        rules = try container.decode([ConfigRule].self, forKey: .rules)
        profiles = try container.decodeIfPresent([ChromeProfileEntry].self, forKey: .profiles) ?? []
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(defaultProfile, forKey: .defaultProfile)
        try container.encode(rules, forKey: .rules)
        if !profiles.isEmpty {
            try container.encode(profiles, forKey: .profiles)
        }
    }
}

public struct ChromeProfileEntry: Codable, Equatable, Sendable {
    public let profile: String
    public let name: String?
    public let email: String?

    public init(profile: String, name: String? = nil, email: String? = nil) {
        self.profile = profile
        self.name = name
        self.email = email
    }
}

public struct ConfigRule: Equatable, Sendable {
    public let contains: [String]
    public let profile: String
    public let browser: Browser
    public let name: String?
    public let email: String?

    public init(contains: [String], profile: String, browser: Browser = .chrome, name: String? = nil, email: String? = nil) {
        self.contains = contains
        self.profile = profile
        self.browser = browser
        self.name = name
        self.email = email
    }
}

extension ConfigRule: Codable {
    enum CodingKeys: String, CodingKey {
        case contains
        case profile
        case browser
        case name
        case email
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        contains = try container.decode([String].self, forKey: .contains)
        profile = try container.decode(String.self, forKey: .profile)
        browser = try container.decodeIfPresent(Browser.self, forKey: .browser) ?? .chrome
        name = try container.decodeIfPresent(String.self, forKey: .name)
        email = try container.decodeIfPresent(String.self, forKey: .email)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(contains, forKey: .contains)
        try container.encode(profile, forKey: .profile)
        try container.encode(browser, forKey: .browser)
        try container.encodeIfPresent(name, forKey: .name)
        try container.encodeIfPresent(email, forKey: .email)
    }
}

public struct RouteDecision: Codable, Equatable, Sendable {
    public let originalURL: String
    public let matchText: String
    public let profile: String
    public let browser: Browser
    public let matchedRuleIndex: Int?
    public let matchedToken: String?

    public init(
        originalURL: String,
        matchText: String,
        profile: String,
        browser: Browser = .chrome,
        matchedRuleIndex: Int? = nil,
        matchedToken: String? = nil
    ) {
        self.originalURL = originalURL
        self.matchText = matchText
        self.profile = profile
        self.browser = browser
        self.matchedRuleIndex = matchedRuleIndex
        self.matchedToken = matchedToken
    }

    enum CodingKeys: String, CodingKey {
        case originalURL
        case matchText
        case profile
        case browser
        case matchedRuleIndex
        case matchedToken
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        originalURL = try container.decode(String.self, forKey: .originalURL)
        matchText = try container.decode(String.self, forKey: .matchText)
        profile = try container.decode(String.self, forKey: .profile)
        browser = try container.decodeIfPresent(Browser.self, forKey: .browser) ?? .chrome
        matchedRuleIndex = try container.decodeIfPresent(Int.self, forKey: .matchedRuleIndex)
        matchedToken = try container.decodeIfPresent(String.self, forKey: .matchedToken)
    }
}

public enum FastFinickyError: LocalizedError, Equatable, Sendable {
    case invalidURL(String)
    case invalidConfig(String)
    case chromeNotFound
    case chromeExecutableMissing(String)
    case launchAtLoginRequiresApp
    case launchctlFailed(String)
    case workspaceOpenFailed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL(let value):
            return "Invalid URL: \(value)"
        case .invalidConfig(let reason):
            return "Invalid config: \(reason)"
        case .chromeNotFound:
            return "Google Chrome.app was not found."
        case .chromeExecutableMissing(let path):
            return "Google Chrome executable missing at \(path)"
        case .launchAtLoginRequiresApp:
            return "Launch at Login requires Fast Finicky.app."
        case .launchctlFailed(let message):
            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty {
                return "launchctl failed."
            }
            return "launchctl failed: \(trimmed)"
        case .workspaceOpenFailed(let message):
            return "Failed to open URL in Chrome: \(message)"
        }
    }
}

