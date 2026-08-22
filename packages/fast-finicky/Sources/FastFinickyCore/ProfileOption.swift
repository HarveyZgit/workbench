import Foundation

public struct ProfileOption: Equatable, Sendable {
    public let directory: String
    public let name: String?
    public let email: String?

    public init(directory: String, name: String? = nil, email: String? = nil) {
        self.directory = directory
        self.name = name
        self.email = email
    }

    public var title: String {
        var parts: [String] = []
        if let name, !name.isEmpty {
            parts.append(name)
        }
        parts.append(directory)
        if let email, !email.isEmpty {
            parts.append(email)
        }
        return parts.joined(separator: " — ")
    }

    public static func list(from config: AppConfig) -> [ProfileOption] {
        list(from: config, discovered: ChromeLocalState.discoverProfiles())
    }

    public static func lastUsedDirectory() -> String? {
        ChromeLocalState.snapshot().lastUsedDirectory
    }

    static func list(
        from config: AppConfig,
        discovered: [ChromeProfileEntry]
    ) -> [ProfileOption] {
        var seen = Set<String>()
        var result: [ProfileOption] = []

        func add(directory: String, name: String?, email: String?) {
            let trimmed = directory.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            let key = trimmed.lowercased()
            if let index = result.firstIndex(where: { $0.directory.lowercased() == key }) {
                let existing = result[index]
                result[index] = ProfileOption(
                    directory: existing.directory,
                    name: existing.name ?? name,
                    email: existing.email ?? email
                )
                return
            }
            seen.insert(key)
            result.append(ProfileOption(directory: trimmed, name: name, email: email))
        }

        for rule in config.rules {
            add(directory: rule.profile, name: rule.name, email: rule.email)
        }
        add(directory: config.defaultProfile, name: nil, email: nil)
        for entry in discovered {
            add(directory: entry.profile, name: entry.name, email: entry.email)
        }
        return result
    }
}
