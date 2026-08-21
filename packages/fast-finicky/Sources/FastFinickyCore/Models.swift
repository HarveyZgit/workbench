import Foundation

public struct AppConfig: Codable, Equatable, Sendable {
    public let defaultProfile: String
    public let rules: [ConfigRule]

    public init(defaultProfile: String, rules: [ConfigRule]) {
        self.defaultProfile = defaultProfile
        self.rules = rules
    }
}

public struct ConfigRule: Codable, Equatable, Sendable {
    public let contains: [String]
    public let profile: String

    public init(contains: [String], profile: String) {
        self.contains = contains
        self.profile = profile
    }
}

public struct RouteDecision: Codable, Equatable, Sendable {
    public let originalURL: String
    public let matchText: String
    public let profile: String
    public let matchedRuleIndex: Int?
    public let matchedToken: String?

    public init(
        originalURL: String,
        matchText: String,
        profile: String,
        matchedRuleIndex: Int? = nil,
        matchedToken: String? = nil
    ) {
        self.originalURL = originalURL
        self.matchText = matchText
        self.profile = profile
        self.matchedRuleIndex = matchedRuleIndex
        self.matchedToken = matchedToken
    }
}

public enum FastFinickyError: LocalizedError, Equatable, Sendable {
    case invalidURL(String)
    case invalidConfig(String)
    case chromeNotFound
    case chromeExecutableMissing(String)

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
        }
    }
}
