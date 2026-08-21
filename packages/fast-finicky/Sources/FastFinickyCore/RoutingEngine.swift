import Foundation

public struct RoutingEngine: Sendable {
    public init() {}

    public func decide(urlString: String, config: AppConfig) throws -> RouteDecision {
        guard let url = URL(string: urlString) else {
            throw FastFinickyError.invalidURL(urlString)
        }

        let matchText = Self.matchText(for: url)

        for (index, rule) in config.rules.enumerated() {
            for token in rule.contains.map(Self.normalizeToken(_:)) where !token.isEmpty {
                if matchText.contains(token) {
                    return RouteDecision(
                        originalURL: urlString,
                        matchText: matchText,
                        profile: rule.profile,
                        matchedRuleIndex: index,
                        matchedToken: token
                    )
                }
            }
        }

        return RouteDecision(
            originalURL: urlString,
            matchText: matchText,
            profile: config.defaultProfile
        )
    }

    public static func matchText(for url: URL) -> String {
        let host = url.host(percentEncoded: false) ?? url.host ?? ""
        let path = url.path(percentEncoded: false)
        return (host + path).lowercased()
    }

    public static func normalizeToken(_ token: String) -> String {
        token.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}
