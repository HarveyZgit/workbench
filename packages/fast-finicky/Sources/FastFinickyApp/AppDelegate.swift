import AppKit
import Carbon
import FastFinickyCore
import Foundation
import UniformTypeIdentifiers

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let paths = AppPaths()
    private let logger: DailyLogger
    private let router = RoutingEngine()
    private let launcher: BrowserLauncher
    private let warmer: ChromeWarmer
    private let launchAtLogin = LaunchAtLogin()

    private var configStore: ConfigStore?
    private var watcher: ConfigWatcher?
    private var statusItem: NSStatusItem?
    private var updateInstallInFlight = false
    private let updater = AppUpdater()

    override init() {
        let logger = DailyLogger(paths: paths, retentionDays: 7)
        self.logger = logger
        let launcher = BrowserLauncher()
        self.launcher = launcher
        self.warmer = ChromeWarmer(
            chromeAppLocator: { try launcher.locateChromeApplication() },
            logger: logger
        )
        super.init()
        ensureStoreAndWatcher(trigger: "init")
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSAppleEventManager.shared().setEventHandler(
            self,
            andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
            forEventClass: AEEventClass(kInternetEventClass),
            andEventID: AEEventID(kAEGetURL)
        )
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupStatusItem()
        warmer.start()
        launchAtLogin.removeLegacyAgentsIfNeeded()
        ensureStoreAndWatcher(trigger: "launch")
        if configStore != nil {
            logger.log("app_started", fields: [
                "config": paths.configURL.path
            ])
        }
        removeStaleUpdateStaging()
    }

    func applicationWillTerminate(_ notification: Notification) {
        warmer.stop()
    }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        let fileURL = URL(fileURLWithPath: filename)
        return openIncomingURLString(fileURL.absoluteString, launchURL: fileURL, source: "open_file")
    }

    func application(_ application: NSApplication, openFiles filenames: [String]) {
        var handledAll = true
        for filename in filenames {
            let fileURL = URL(fileURLWithPath: filename)
            if !openIncomingURLString(fileURL.absoluteString, launchURL: fileURL, source: "open_files") {
                handledAll = false
            }
        }

        application.reply(toOpenOrPrint: handledAll ? .success : .failure)
    }

    func application(_ application: NSApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([NSUserActivityRestoring]) -> Void) -> Bool {
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
              let url = userActivity.webpageURL else {
            return false
        }

        return openIncomingURLString(url.absoluteString, launchURL: url, source: "user_activity")
    }

    @objc
    func handleGetURLEvent(_ event: NSAppleEventDescriptor, withReplyEvent replyEvent: NSAppleEventDescriptor?) {
        guard let urlString = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue else {
            logger.log("route_error", fields: [
                "error": "Missing URL in Apple event"
            ])
            return
        }

        guard let launchURL = URL(string: urlString) else {
            logger.log("route_error", fields: [
                "source": "get_url",
                "url": urlString,
                "error": FastFinickyError.invalidURL(urlString).localizedDescription
            ])
            return
        }

        _ = openIncomingURLString(urlString, launchURL: launchURL, source: "get_url")
    }

    @objc
    func openConfig(_ sender: Any?) {
        do {
            try configStore?.ensureConfigFileExists()
            NSWorkspace.shared.open(paths.configURL)
        } catch {
            logger.log("menu_error", fields: [
                "action": "open_config",
                "error": error.localizedDescription
            ])
        }
    }

    @objc
    func setupProfiles(_ sender: Any?) {
        do {
            ensureStoreAndWatcher(trigger: "setup")
            guard let store = configStore else {
                throw FastFinickyError.invalidConfig("Configuration is unavailable")
            }

            let result = try store.setupProfiles()
            logger.log("setup_profiles", fields: [
                "discovered": String(result.discoveredCount),
                "added": String(result.added.count),
                "labeled": String(result.labeled),
                "profiles": result.added.map(\.profile).joined(separator: ",")
            ])

            let alert = NSAlert()
            alert.alertStyle = .informational
            if !result.didChange {
                alert.messageText = "No new Chrome profiles"
                alert.informativeText = "Scanned \(result.discoveredCount) profile(s). Config rules already cover them."
            } else {
                var lines: [String] = []
                if !result.added.isEmpty {
                    alert.messageText = "Added \(result.added.count) rule(s)"
                    lines.append(contentsOf: result.added.map { entry in
                        if let name = entry.name, !name.isEmpty {
                            return "\(entry.profile) — \(name)"
                        }
                        return entry.profile
                    })
                    lines.append("Fill in each rule's contains with URL host/path tokens.")
                } else {
                    alert.messageText = "Updated profile labels"
                }
                if result.labeled > 0 {
                    lines.append("Filled name/email on \(result.labeled) existing rule(s).")
                }
                alert.informativeText = lines.joined(separator: "\n")
            }
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        } catch {
            logger.log("menu_error", fields: [
                "action": "setup_profiles",
                "error": error.localizedDescription
            ])
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Setup failed"
            alert.informativeText = error.localizedDescription
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
    }

    @objc
    func reloadConfig(_ sender: Any?) {
        reloadConfiguration(trigger: "menu")
    }

    @objc
    func installUpdate(_ sender: Any?) {
        let currentApp = Bundle.main.bundleURL
        guard currentApp.pathExtension == "app" else {
            presentUpdateError(AppUpdateError.notAnAppBundle)
            return
        }

        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.zip]
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        panel.message = "Choose a Fast Finicky release zip"
        panel.prompt = "Install"
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let zipURL = panel.url else {
            return
        }

        do {
            let workDirectory = FileManager.default.temporaryDirectory
                .appendingPathComponent("fast-finicky-update-\(UUID().uuidString)", isDirectory: true)
            let extracted = try updater.extract(zip: zipURL, to: workDirectory)
            defer { try? FileManager.default.removeItem(at: workDirectory) }

            let current = Self.currentAppVersion()
            if !confirmInstall(extractedVersion: extracted.version, currentVersion: current) {
                return
            }

            updateInstallInFlight = true
            let staging = try updater.stage(extracted, nextTo: currentApp)
            try launchReplacement(currentApp: currentApp, staging: staging)
            logger.log("update_install", fields: [
                "zip": zipURL.path,
                "from": current,
                "to": extracted.version
            ])
            NSApp.terminate(nil)
        } catch {
            updateInstallInFlight = false
            removeStaleUpdateStaging()
            presentUpdateError(error)
        }
    }

    @objc
    func openLog(_ sender: Any?) {
        do {
            let logURL = try logger.ensureTodayLogFile()
            NSWorkspace.shared.open(logURL)
        } catch {
            logger.log("menu_error", fields: [
                "action": "open_log",
                "error": error.localizedDescription
            ])
        }
    }

    @objc
    func toggleLaunchAtLogin(_ sender: Any?) {
        do {
            let enabled = !launchAtLogin.isEnabled
            try launchAtLogin.setEnabled(enabled)
            if let item = sender as? NSMenuItem {
                item.state = enabled ? .on : .off
            }
            logger.log("launch_at_login", fields: [
                "enabled": enabled ? "true" : "false"
            ])
        } catch {
            logger.log("menu_error", fields: [
                "action": "launch_at_login",
                "error": error.localizedDescription
            ])
            let alert = NSAlert()
            alert.alertStyle = .warning
            alert.messageText = "Could not update Launch at Login"
            alert.informativeText = error.localizedDescription
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
    }

    @objc
    func addCurrentPage(_ sender: Any?) {
        do {
            ensureStoreAndWatcher(trigger: "add_page")
            guard let store = configStore else {
                throw FastFinickyError.invalidConfig("Configuration is unavailable")
            }

            let urlString = try FrontChromePage.currentTabURL()
            let profiles = ProfileOption.list(from: store.currentConfig)
            guard !profiles.isEmpty else {
                throw FastFinickyError.invalidConfig("No Chrome profiles found. Run Setup first.")
            }
            let preferredProfile = ProfileOption.lastUsedDirectory()
            let anchor = statusItem?.button

            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                guard let draft = AddPageRulePanel.run(
                    urlString: urlString,
                    profiles: profiles,
                    preferredProfile: preferredProfile,
                    anchor: anchor
                ) else {
                    return
                }

                do {
                    let token = try RoutingEngine.containsToken(fromUserInput: draft.contains)
                    try store.addRule(
                        ConfigRule(
                            contains: [token],
                            profile: draft.profile.directory,
                            name: draft.profile.name,
                            email: draft.profile.email
                        )
                    )
                    self.logger.log("rule_added", fields: [
                        "contains": token,
                        "profile": draft.profile.directory,
                        "url": urlString
                    ])
                } catch {
                    self.presentAddPageError(error)
                }
            }
        } catch {
            presentAddPageError(error)
        }
    }

    private func presentAddPageError(_ error: Error) {
        logger.log("menu_error", fields: [
            "action": "add_current_page",
            "error": error.localizedDescription
        ])
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Could not add current page"
        alert.informativeText = error.localizedDescription
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private func confirmInstall(extractedVersion: String, currentVersion: String) -> Bool {
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = extractedVersion.isEmpty
            ? "Install this Fast Finicky zip?"
            : "Install Fast Finicky \(extractedVersion)?"
        if currentVersion.isEmpty {
            alert.informativeText = "This replaces the running app and clears quarantine. You do not need xattr."
        } else if extractedVersion.isEmpty {
            alert.informativeText = "This replaces \(currentVersion) and clears quarantine. You do not need xattr."
        } else if AppUpdater.isNewer(latest: extractedVersion, than: currentVersion) {
            alert.informativeText = "This replaces \(currentVersion) and clears quarantine. You do not need xattr."
        } else {
            alert.informativeText = "This zip is \(extractedVersion); you currently have \(currentVersion). Install anyway? Quarantine will be cleared."
        }
        alert.addButton(withTitle: "Install")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        return alert.runModal() == .alertFirstButtonReturn
    }

    private func launchReplacement(currentApp: URL, staging: URL) throws {
        let scriptURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("fast-finicky-replace-\(UUID().uuidString).sh")
        try AppUpdater.replacementScript().write(to: scriptURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: scriptURL.path)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/bash")
        process.arguments = [
            scriptURL.path,
            currentApp.path,
            staging.path,
            String(ProcessInfo.processInfo.processIdentifier)
        ]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
    }

    private func presentUpdateError(_ error: Error) {
        logger.log("menu_error", fields: [
            "action": "install_update",
            "error": error.localizedDescription
        ])
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "Could not install update"
        alert.informativeText = error.localizedDescription
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    private func removeStaleUpdateStaging() {
        let app = Bundle.main.bundleURL
        guard app.pathExtension == "app" else { return }
        try? FileManager.default.removeItem(at: AppUpdater.stagingURL(nextTo: app))
        try? FileManager.default.removeItem(at: AppUpdater.backupURL(nextTo: app))
    }

    private static func currentAppVersion() -> String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        if let loginItem = menu.item(withTitle: "Launch at Login") {
            loginItem.state = launchAtLogin.isEnabled ? .on : .off
        }
    }

    @objc
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(addCurrentPage(_:)) {
            return FrontChromePage.isChromeFrontmost()
        }
        if menuItem.action == #selector(installUpdate(_:)) {
            return Bundle.main.bundleURL.pathExtension == "app" && !updateInstallInFlight
        }
        return true
    }

    @objc
    func quit(_ sender: Any?) {
        NSApp.terminate(nil)
    }

    private func ensureStoreAndWatcher(trigger: String) {
        if configStore == nil {
            do {
                configStore = try ConfigStore(paths: paths)
            } catch {
                logger.log("startup_error", fields: [
                    "trigger": trigger,
                    "stage": "store",
                    "error": error.localizedDescription
                ])
            }
        }

        if watcher == nil {
            watcher = ConfigWatcher(configURL: paths.configURL) { [weak self] in
                self?.reloadConfiguration(trigger: "watcher")
            }
        }

        do {
            try watcher?.start()
        } catch {
            logger.log("startup_error", fields: [
                "trigger": trigger,
                "stage": "watcher",
                "error": error.localizedDescription
            ])
        }

    }

    private func reloadConfiguration(trigger: String) {
        guard let store = configStore else {
            ensureStoreAndWatcher(trigger: trigger)
            return
        }

        do {
            _ = try store.reload()
            logger.log("config_reloaded", fields: [
                "trigger": trigger,
                "rules": String(store.currentConfig.rules.count)
            ])
        } catch {
            logger.log("config_reload_failed", fields: [
                "trigger": trigger,
                "error": error.localizedDescription
            ])
        }
    }

    @discardableResult
    private func openIncomingURLString(_ urlString: String, launchURL: URL, source: String) -> Bool {
        let startedAt = Date()

        if configStore == nil {
            ensureStoreAndWatcher(trigger: "route")
        }

        guard let store = configStore else {
            logger.log("route_error", fields: [
                "source": source,
                "url": urlString,
                "error": "Configuration is unavailable",
                "elapsed_ms": Self.elapsedMilliseconds(since: startedAt)
            ])
            return false
        }

        do {
            let decision = try router.decide(urlString: urlString, config: store.currentConfig)
            let launchResult = try launcher.launch(targetURL: launchURL, profile: decision.profile)
            warmer.warmNow()

            var fields: [String: String] = [
                "source": source,
                "url": urlString,
                "match_text": decision.matchText,
                "profile": decision.profile,
                "result": "launched",
                "launch_strategy": launchResult.strategy.rawValue,
                "target_kind": launchResult.targetKind.rawValue,
                "elapsed_ms": Self.elapsedMilliseconds(since: startedAt)
            ]
            if let matchedRuleIndex = decision.matchedRuleIndex {
                fields["rule_index"] = String(matchedRuleIndex)
            }
            if let matchedToken = decision.matchedToken {
                fields["matched_token"] = matchedToken
            }

            logger.log("route", fields: fields)
            return true
        } catch {
            logger.log("route_error", fields: [
                "source": source,
                "url": urlString,
                "error": error.localizedDescription,
                "elapsed_ms": Self.elapsedMilliseconds(since: startedAt)
            ])
            return false
        }
    }

    private static func elapsedMilliseconds(since startedAt: Date) -> String {
        String(Int(Date().timeIntervalSince(startedAt) * 1_000))
    }

    private func setupStatusItem() {
        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.toolTip = "Fast Finicky"
        statusItem.button?.image = StatusBarIconFactory.makeIcon()
        statusItem.button?.imagePosition = .imageOnly

        let menu = NSMenu()
        menu.addItem(withTitle: "Add Current Page…", action: #selector(addCurrentPage(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Open Config", action: #selector(openConfig(_:)), keyEquivalent: ",")
        menu.addItem(withTitle: "Reload Config", action: #selector(reloadConfig(_:)), keyEquivalent: "r")
        menu.addItem(withTitle: "Setup", action: #selector(setupProfiles(_:)), keyEquivalent: "s")
        menu.addItem(withTitle: "Open Log", action: #selector(openLog(_:)), keyEquivalent: "l")
        menu.addItem(withTitle: "Install Update…", action: #selector(installUpdate(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Launch at Login", action: #selector(toggleLaunchAtLogin(_:)), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(quit(_:)), keyEquivalent: "q")

        menu.delegate = self
        statusItem.menu = menu
        self.statusItem = statusItem
    }
}
