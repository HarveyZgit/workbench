import AppKit
import Carbon
import FastFinickyCore
import Foundation

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let paths = AppPaths()
    private let logger: DailyLogger
    private let router = RoutingEngine()
    private let launcher = BrowserLauncher()
    private let warmer: ChromeWarmer

    private var configStore: ConfigStore?
    private var watcher: ConfigWatcher?
    private var statusItem: NSStatusItem?

    override init() {
        let logger = DailyLogger(paths: paths, retentionDays: 7)
        self.logger = logger
        let launcher = BrowserLauncher()
        self.warmer = ChromeWarmer(
            chromeAppLocator: { try launcher.locateChromeApplication() },
            logger: logger
        )
        super.init()
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
        do {
            let store = try ConfigStore(paths: paths)
            self.configStore = store
            self.watcher = ConfigWatcher(configURL: paths.configURL) { [weak self] in
                self?.reloadConfiguration(trigger: "watcher")
            }
            try watcher?.start()
            setupStatusItem()
            warmer.start()
            logger.log("app_started", fields: [
                "config": paths.configURL.path
            ])
        } catch {
            setupStatusItem()
            warmer.start()
            logger.log("startup_error", fields: [
                "error": error.localizedDescription
            ])
        }
    }

    func application(_ sender: NSApplication, openFile filename: String) -> Bool {
        let fileURL = URL(fileURLWithPath: filename)
        return openIncomingURLString(fileURL.absoluteString, launchURL: fileURL, source: "open_file")
    }

    func application(_ application: NSApplication, openFiles filenames: [String]) {
        let handledAll = filenames.allSatisfy { filename in
            let fileURL = URL(fileURLWithPath: filename)
            return openIncomingURLString(fileURL.absoluteString, launchURL: fileURL, source: "open_files")
        }

        application.reply(toOpenOrPrint: handledAll ? .success : .failure)
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
    func reloadConfig(_ sender: Any?) {
        reloadConfiguration(trigger: "menu")
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
    func quit(_ sender: Any?) {
        NSApp.terminate(nil)
    }

    private func reloadConfiguration(trigger: String) {
        guard let store = configStore else {
            do {
                configStore = try ConfigStore(paths: paths)
                logger.log("config_reloaded", fields: [
                    "trigger": trigger,
                    "result": "recreated_store"
                ])
            } catch {
                logger.log("config_reload_failed", fields: [
                    "trigger": trigger,
                    "error": error.localizedDescription
                ])
            }
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
        menu.addItem(withTitle: "Open Config", action: #selector(openConfig(_:)), keyEquivalent: ",")
        menu.addItem(withTitle: "Reload Config", action: #selector(reloadConfig(_:)), keyEquivalent: "r")
        menu.addItem(withTitle: "Open Log", action: #selector(openLog(_:)), keyEquivalent: "l")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(quit(_:)), keyEquivalent: "q")

        statusItem.menu = menu
        self.statusItem = statusItem
    }
}
