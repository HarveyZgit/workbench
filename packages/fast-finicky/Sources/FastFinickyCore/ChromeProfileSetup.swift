import Foundation

public struct ProfileSetupResult: Equatable, Sendable {
    public let discoveredCount: Int
    public let added: [ChromeProfileEntry]

    public var didChange: Bool {
        !added.isEmpty
    }

    public init(discoveredCount: Int, added: [ChromeProfileEntry]) {
        self.discoveredCount = discoveredCount
        self.added = added
    }
}

enum ChromeProfileSetup {
    static func merge(
        discovered: [ChromeProfileEntry],
        into config: AppConfig
    ) -> (AppConfig, added: [ChromeProfileEntry]) {
        var present = Set<String>()
        for rule in config.rules {
            remember(rule.profile, into: &present)
        }

        var incoming = discovered
        var seen = Set(discovered.map { $0.profile.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        for entry in config.profiles {
            let key = entry.profile.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !key.isEmpty, !seen.contains(key) else { continue }
            seen.insert(key)
            incoming.append(entry)
        }

        var added: [ChromeProfileEntry] = []
        var newRules: [ConfigRule] = []
        for entry in incoming {
            let profile = entry.profile.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !profile.isEmpty else { continue }
            let key = profile.lowercased()
            guard !present.contains(key) else { continue }
            present.insert(key)

            let name = emptyToNil(entry.name)
            let email = emptyToNil(entry.email)
            added.append(ChromeProfileEntry(profile: profile, name: name, email: email))
            newRules.append(
                ConfigRule(
                    contains: [],
                    profile: profile,
                    name: name,
                    email: email
                )
            )
        }

        let merged = AppConfig(
            defaultProfile: config.defaultProfile,
            rules: config.rules + newRules,
            profiles: []
        )
        return (merged, added)
    }

    private static func remember(_ value: String, into present: inout Set<String>) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        present.insert(trimmed.lowercased())
    }

    private static func emptyToNil(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
