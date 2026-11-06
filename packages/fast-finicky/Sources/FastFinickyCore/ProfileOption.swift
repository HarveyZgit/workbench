import Foundation

public struct ProfileOption: Equatable, Sendable {
    public let directory: String
    public let browser: Browser
    public let name: String?
    public let email: String?

    public init(directory: String, browser: Browser = .chrome, name: String? = nil, email: String? = nil) {
        self.directory = directory
        self.browser = browser
        self.name = name
        self.email = email
    }

    public var title: String {
        var parts: [String] = []
        if browser != .chrome {
            parts.append(browser.displayName)
        }
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
        var result: [ProfileOption] = []

        func add(directory: String, browser: Browser = .chrome, name: String?, email: String?) {
            let trimmed = directory.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            let key = browser == .chrome ? trimmed.lowercased() : trimmed
            if let index = result.firstIndex(where: {
                $0.browser == browser && (browser == .chrome ? $0.directory.lowercased() : $0.directory) == key
            }) {
                let existing = result[index]
                result[index] = ProfileOption(
                    directory: existing.directory,
                    browser: existing.browser,
                    name: existing.name ?? name,
                    email: existing.email ?? email
                )
                return
            }
            result.append(ProfileOption(directory: trimmed, browser: browser, name: name, email: email))
        }

        for rule in config.rules {
            add(directory: rule.profile, browser: rule.browser, name: rule.name, email: rule.email)
        }
        add(directory: config.defaultProfile, name: nil, email: nil)
        for entry in discovered {
            add(directory: entry.profile, name: entry.name, email: entry.email)
        }
        for entry in config.profiles {
            add(directory: entry.profile, name: entry.name, email: entry.email)
        }
        return result
    }
}

