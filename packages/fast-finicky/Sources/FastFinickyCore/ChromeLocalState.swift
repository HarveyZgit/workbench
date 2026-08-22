import Foundation

struct ChromeProfileSnapshot: Equatable, Sendable {
    var lastUsedDirectory: String?
    var lastActiveDirectories: [String]
    var lastActiveProfilesPresent: Bool = false

    func canReuseRunningInstance(for profile: String) -> Bool {
        guard lastActiveProfilesPresent else {
            return false
        }
        guard ChromeProfileSnapshot.profileNamesMatch(lastUsedDirectory, profile) else {
            return false
        }

        if lastActiveDirectories.count > 1 {
            return false
        }

        if let onlyActive = lastActiveDirectories.first,
           !ChromeProfileSnapshot.profileNamesMatch(onlyActive, profile) {
            return false
        }

        return true
    }

    static func profileNamesMatch(_ lhs: String?, _ rhs: String) -> Bool {
        guard let lhs else { return false }
        return lhs.caseInsensitiveCompare(rhs) == .orderedSame
    }
}

enum ChromeLocalState {
    static let defaultUserDataDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library", isDirectory: true)
        .appendingPathComponent("Application Support", isDirectory: true)
        .appendingPathComponent("Google", isDirectory: true)
        .appendingPathComponent("Chrome", isDirectory: true)

    static func snapshot(
        userDataDirectory: URL = defaultUserDataDirectory
    ) -> ChromeProfileSnapshot {
        let localStateURL = userDataDirectory.appendingPathComponent("Local State", isDirectory: false)
        guard let data = try? Data(contentsOf: localStateURL, options: [.mappedIfSafe]) else {
            return ChromeProfileSnapshot(
                lastUsedDirectory: nil,
                lastActiveDirectories: [],
                lastActiveProfilesPresent: false
            )
        }
        return snapshot(fromLocalStateJSON: data)
    }

    static func snapshot(fromLocalStateJSON data: Data) -> ChromeProfileSnapshot {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let profile = root["profile"] as? [String: Any] else {
            return ChromeProfileSnapshot(
                lastUsedDirectory: nil,
                lastActiveDirectories: [],
                lastActiveProfilesPresent: false
            )
        }

        let lastUsed = normalizeProfileDirectory(profile["last_used"] as? String)
        let lastActivePresent = profile["last_active_profiles"] != nil
        let lastActive = (profile["last_active_profiles"] as? [Any] ?? []).compactMap { value in
            normalizeProfileDirectory(value as? String)
        }

        return ChromeProfileSnapshot(
            lastUsedDirectory: lastUsed,
            lastActiveDirectories: lastActive,
            lastActiveProfilesPresent: lastActivePresent
        )
    }

    static func normalizeProfileDirectory(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return URL(fileURLWithPath: trimmed).lastPathComponent
    }

    static func discoverProfiles(
        userDataDirectory: URL = defaultUserDataDirectory,
        fileManager: FileManager = .default
    ) -> [ChromeProfileEntry] {
        let localStateURL = userDataDirectory.appendingPathComponent("Local State", isDirectory: false)
        var merged: [String: ChromeProfileEntry] = [:]
        var excludedKeys = Set<String>()
        if let data = try? Data(contentsOf: localStateURL, options: [.mappedIfSafe]) {
            let discovered = discoverProfiles(fromLocalStateJSON: data)
            merged = discovered.entries
            excludedKeys = discovered.excludedKeys
        }

        let dirNames = (try? fileManager.contentsOfDirectory(atPath: userDataDirectory.path)) ?? []
        for name in dirNames {
            guard let directory = normalizeProfileDirectory(name),
                  !shouldSkipProfileDirectory(directory) else {
                continue
            }
            let key = directory.lowercased()
            if merged[key] != nil || excludedKeys.contains(key) {
                continue
            }

            let preferences = userDataDirectory
                .appendingPathComponent(directory, isDirectory: true)
                .appendingPathComponent("Preferences", isDirectory: false)
            guard fileManager.fileExists(atPath: preferences.path) else {
                continue
            }

            merged[directory.lowercased()] = ChromeProfileEntry(profile: directory)
        }

        for (key, entry) in merged {
            guard entry.email == nil else { continue }
            let profileDirectory = userDataDirectory.appendingPathComponent(entry.profile, isDirectory: true)
            if let email = emailFromPreferences(at: profileDirectory) {
                merged[key] = ChromeProfileEntry(profile: entry.profile, name: entry.name, email: email)
            }
        }

        return merged.values.sorted { compareProfileDirectories($0.profile, $1.profile) }
    }

    static func discoverProfiles(fromLocalStateJSON data: Data) -> (entries: [String: ChromeProfileEntry], excludedKeys: Set<String>) {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let profile = root["profile"] as? [String: Any],
              let infoCache = profile["info_cache"] as? [String: Any] else {
            return ([:], [])
        }

        var result: [String: ChromeProfileEntry] = [:]
        var excludedKeys = Set<String>()
        for (rawKey, rawValue) in infoCache {
            guard let directory = normalizeProfileDirectory(rawKey) else {
                continue
            }
            let key = directory.lowercased()
            if shouldSkipProfileDirectory(directory) {
                excludedKeys.insert(key)
                continue
            }
            let fields = rawValue as? [String: Any] ?? [:]
            if fields["is_ephemeral"] as? Bool == true {
                excludedKeys.insert(key)
                continue
            }

            let name = nonemptyString(fields["name"])
            let email = emailIfValid(fields["user_name"])
            result[key] = ChromeProfileEntry(
                profile: directory,
                name: name,
                email: email
            )
        }
        return (result, excludedKeys)
    }

    static func shouldSkipProfileDirectory(_ directory: String) -> Bool {
        let skipped = ["Guest Profile", "System Profile"]
        return skipped.contains { $0.caseInsensitiveCompare(directory) == .orderedSame }
    }

    static func compareProfileDirectories(_ lhs: String, _ rhs: String) -> Bool {
        if lhs.caseInsensitiveCompare("Default") == .orderedSame { return true }
        if rhs.caseInsensitiveCompare("Default") == .orderedSame { return false }

        if let leftNumber = profileNumber(lhs), let rightNumber = profileNumber(rhs), leftNumber != rightNumber {
            return leftNumber < rightNumber
        }

        return lhs.localizedStandardCompare(rhs) == .orderedAscending
    }

    private static func profileNumber(_ directory: String) -> Int? {
        let prefix = "Profile "
        guard directory.lowercased().hasPrefix(prefix.lowercased()) else {
            return nil
        }
        let suffix = directory.dropFirst(prefix.count).trimmingCharacters(in: .whitespaces)
        return Int(suffix)
    }

    static func emailFromPreferences(at profileDirectory: URL) -> String? {
        let preferencesURL = profileDirectory.appendingPathComponent("Preferences", isDirectory: false)
        guard let data = try? Data(contentsOf: preferencesURL, options: [.mappedIfSafe]),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }

        if let accounts = root["account_info"] as? [Any] {
            for account in accounts {
                guard let fields = account as? [String: Any],
                      let email = emailIfValid(fields["email"]) else {
                    continue
                }
                return email
            }
        }

        return nil
    }

    private static func emailIfValid(_ value: Any?) -> String? {
        nonemptyString(value).flatMap { $0.contains("@") ? $0 : nil }
    }

    private static func nonemptyString(_ value: Any?) -> String? {
        guard let value = value as? String else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
