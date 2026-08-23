import Foundation

public struct ProfileSetupResult: Equatable, Sendable {
    public let discoveredCount: Int
    public let added: [ChromeProfileEntry]
    public let labeled: Int

    public var didChange: Bool {
        !added.isEmpty || labeled > 0
    }

    public init(discoveredCount: Int, added: [ChromeProfileEntry], labeled: Int = 0) {
        self.discoveredCount = discoveredCount
        self.added = added
        self.labeled = labeled
    }
}

enum ChromeProfileSetup {
    static func merge(
        discovered: [ChromeProfileEntry],
        into config: AppConfig
    ) -> (AppConfig, added: [ChromeProfileEntry], labeled: Int) {
        var discoveredByKey: [String: ChromeProfileEntry] = [:]
        for entry in discovered {
            let key = entry.profile.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard !key.isEmpty else { continue }
            discoveredByKey[key] = entry
        }

        var present = Set<String>()
        var keptRules: [ConfigRule] = []
        var labeled = 0
        for rule in config.rules {
            remember(rule.profile, into: &present)
            let ruleKey = rule.profile.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            guard let extra = discoveredByKey[ruleKey] else {
                keptRules.append(rule)
                continue
            }

            let name = emptyToNil(rule.name) ?? extra.name
            let email = emptyToNil(rule.email) ?? extra.email
            if name != emptyToNil(rule.name) || email != emptyToNil(rule.email) {
                labeled += 1
                keptRules.append(
                    ConfigRule(
                        contains: rule.contains,
                        profile: rule.profile,
                        name: name,
                        email: email
                    )
                )
            } else {
                keptRules.append(rule)
            }
        }

        var incoming = discovered
        var seen = Set(discoveredByKey.keys)
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
            rules: keptRules + newRules,
            profiles: []
        )
        return (merged, added, labeled)
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
