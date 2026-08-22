import AppKit
import FastFinickyCore
import Foundation

enum AddPageRulePanel {
    static func run(
        urlString: String,
        profiles: [ProfileOption],
        preferredProfile: String?,
        anchor: NSView?
    ) -> (profile: ProfileOption, contains: String)? {
        let controller = AddPageRuleViewController(
            urlString: urlString,
            profiles: profiles,
            preferredProfile: preferredProfile
        )
        let panel = controller.makePanel()
        position(panel, under: anchor)

        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)

        let response = NSApp.runModal(for: panel)
        panel.orderOut(nil)

        guard response == .OK else {
            return nil
        }
        return controller.submittedDraft()
    }

    private static func position(_ panel: NSWindow, under anchor: NSView?) {
        guard let anchor, let anchorWindow = anchor.window else {
            panel.center()
            return
        }

        panel.layoutIfNeeded()
        var frame = panel.frame
        let buttonInWindow = anchor.convert(anchor.bounds, to: nil)
        let buttonOnScreen = anchorWindow.convertToScreen(buttonInWindow)
        frame.origin.x = buttonOnScreen.midX - frame.width / 2
        frame.origin.y = buttonOnScreen.minY - frame.height - 6

        if let screen = anchorWindow.screen ?? NSScreen.main {
            let visible = screen.visibleFrame
            frame.origin.x = min(max(frame.origin.x, visible.minX + 8), visible.maxX - frame.width - 8)
            if frame.minY < visible.minY {
                frame.origin.y = min(buttonOnScreen.maxY + 6, visible.maxY - frame.height - 8)
            }
        }

        panel.setFrame(frame, display: false)
    }
}

private final class AddPageRuleViewController: NSObject, NSTextFieldDelegate, NSWindowDelegate {
    private let urlString: String
    private let profiles: [ProfileOption]
    private let preferredProfile: String?
    private let popup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let containsField = NSTextField(string: "")
    private let addButton = NSButton(title: "Add", target: nil, action: nil)

    init(urlString: String, profiles: [ProfileOption], preferredProfile: String?) {
        self.urlString = urlString
        self.profiles = profiles
        self.preferredProfile = preferredProfile
        super.init()
    }

    func makePanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 220),
            styleMask: [.titled, .closable, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        panel.title = "Add Current Page"
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        panel.tabbingMode = .disallowed

        let content = buildContent()
        content.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView = NSView()
        guard let contentView = panel.contentView else {
            return panel
        }
        contentView.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
            content.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -20),
            content.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 16),
            content.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -16),
            content.widthAnchor.constraint(equalToConstant: 380)
        ])
        contentView.layoutSubtreeIfNeeded()
        let fitting = content.fittingSize
        panel.setContentSize(NSSize(width: 420, height: max(fitting.height + 32, 200)))

        panel.defaultButtonCell = addButton.cell as? NSButtonCell
        panel.initialFirstResponder = containsField
        return panel
    }

    func submittedDraft() -> (profile: ProfileOption, contains: String)? {
        let directory = (popup.selectedItem?.representedObject as? String) ?? profiles.first?.directory
        guard let directory,
              let profile = profiles.first(where: { $0.directory.caseInsensitiveCompare(directory) == .orderedSame }) else {
            return nil
        }
        return (profile, containsField.stringValue)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.stopModal(withCode: .cancel)
        return true
    }

    func controlTextDidChange(_ obj: Notification) {
        updateAddEnabled()
    }

    @objc
    private func cancel(_ sender: Any?) {
        NSApp.stopModal(withCode: .cancel)
    }

    @objc
    private func add(_ sender: Any?) {
        guard addButton.isEnabled else { return }
        NSApp.stopModal(withCode: .OK)
    }

    private func buildContent() -> NSView {
        let currentLabel = makeLabel("Current Page")
        currentLabel.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize, weight: .medium)
        currentLabel.textColor = .secondaryLabelColor

        let urlField = NSTextField(wrappingLabelWithString: urlString)
        urlField.isSelectable = true
        urlField.textColor = .labelColor
        urlField.maximumNumberOfLines = 3
        urlField.preferredMaxLayoutWidth = 380
        urlField.lineBreakMode = .byCharWrapping
        urlField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let separator = NSBox()
        separator.boxType = .separator

        for profile in profiles {
            popup.addItem(withTitle: profile.title)
            popup.lastItem?.representedObject = profile.directory
        }
        if let preferredProfile,
           let index = profiles.firstIndex(where: { $0.directory.caseInsensitiveCompare(preferredProfile) == .orderedSame }) {
            popup.selectItem(at: index)
        }
        popup.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        (popup.cell as? NSPopUpButtonCell)?.lineBreakMode = .byTruncatingTail

        containsField.stringValue = prefilledContains()
        containsField.placeholderString = "github.com/example/path"
        containsField.delegate = self
        containsField.usesSingleLineMode = true
        containsField.cell?.isScrollable = true
        containsField.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let profileLabel = makeLabel("Profile")
        let containsLabel = makeLabel("Contains")
        let grid = NSGridView(views: [
            [profileLabel, popup],
            [containsLabel, containsField]
        ])
        grid.rowSpacing = 8
        grid.columnSpacing = 8
        grid.column(at: 0).xPlacement = .trailing
        grid.column(at: 1).xPlacement = .fill
        grid.column(at: 0).width = 72
        grid.yPlacement = .center

        let hint = makeLabel("Matching uses host + path. Query and hash are ignored.")
        hint.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
        hint.textColor = .secondaryLabelColor

        let cancelButton = NSButton(title: "Cancel", target: self, action: #selector(cancel(_:)))
        cancelButton.keyEquivalent = "\u{1b}"
        cancelButton.bezelStyle = .rounded

        addButton.target = self
        addButton.action = #selector(add(_:))
        addButton.keyEquivalent = "\r"
        addButton.bezelStyle = .rounded
        updateAddEnabled()

        let buttons = NSStackView(views: [cancelButton, addButton])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.spacing = 8
        buttons.setHuggingPriority(.required, for: .vertical)

        let buttonRow = NSStackView(views: [NSView(), buttons])
        buttonRow.orientation = .horizontal
        buttonRow.alignment = .centerY
        buttonRow.spacing = 0

        let stack = NSStackView(views: [
            currentLabel,
            urlField,
            separator,
            grid,
            hint,
            buttonRow
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.setCustomSpacing(6, after: currentLabel)
        stack.setCustomSpacing(14, after: urlField)
        stack.setCustomSpacing(12, after: separator)
        stack.setCustomSpacing(6, after: grid)
        stack.setCustomSpacing(16, after: hint)

        grid.translatesAutoresizingMaskIntoConstraints = false
        popup.translatesAutoresizingMaskIntoConstraints = false
        containsField.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            grid.widthAnchor.constraint(equalTo: stack.widthAnchor),
            buttonRow.widthAnchor.constraint(equalTo: stack.widthAnchor),
            separator.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])

        return stack
    }

    private func prefilledContains() -> String {
        (try? RoutingEngine.containsToken(fromUserInput: urlString)) ?? urlString
    }

    private func updateAddEnabled() {
        let trimmed = containsField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        addButton.isEnabled = !trimmed.isEmpty && popup.indexOfSelectedItem >= 0
    }

    private func makeLabel(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.lineBreakMode = .byTruncatingTail
        return label
    }
}
