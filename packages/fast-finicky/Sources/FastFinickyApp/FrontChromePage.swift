import AppKit
import Foundation

enum FrontChromePage {
    static let chromeBundleID = "com.google.Chrome"

    static func isChromeRunning() -> Bool {
        NSRunningApplication.runningApplications(withBundleIdentifier: chromeBundleID)
            .contains { !$0.isTerminated }
    }

    static func isChromeFrontmost() -> Bool {
        NSWorkspace.shared.frontmostApplication?.bundleIdentifier == chromeBundleID
    }

    static func currentTabURL() throws -> String {
        guard isChromeRunning() else {
            throw FrontChromePageError.chromeNotRunning
        }
        guard isChromeFrontmost() else {
            throw FrontChromePageError.chromeNotFrontmost
        }

        let source = """
        tell application id "com.google.Chrome"
            if (count of windows) is 0 then return ""
            return URL of active tab of front window
        end tell
        """

        guard let script = NSAppleScript(source: source) else {
            throw FrontChromePageError.scriptUnavailable
        }

        var errorInfo: NSDictionary?
        let result = script.executeAndReturnError(&errorInfo)
        if let errorInfo {
            let message = errorInfo["NSAppleScriptErrorMessage"] as? String
            throw FrontChromePageError.appleScriptFailed(message ?? "AppleScript failed")
        }

        let url = result.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !url.isEmpty else {
            throw FrontChromePageError.noTabURL
        }
        return url
    }
}

enum FrontChromePageError: LocalizedError {
    case chromeNotRunning
    case chromeNotFrontmost
    case scriptUnavailable
    case appleScriptFailed(String)
    case noTabURL

    var errorDescription: String? {
        switch self {
        case .chromeNotRunning:
            return "Google Chrome is not running."
        case .chromeNotFrontmost:
            return "Google Chrome is not the frontmost app."
        case .scriptUnavailable:
            return "Could not build the Chrome AppleScript."
        case .appleScriptFailed(let message):
            return message
        case .noTabURL:
            return "Chrome has no front window tab URL."
        }
    }
}
