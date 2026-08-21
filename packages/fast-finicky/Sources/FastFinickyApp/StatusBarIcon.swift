import AppKit
import Foundation

enum StatusBarIconFactory {
    static func makeIcon() -> NSImage {
        if let resourceImage = loadBundleIcon() {
            resourceImage.isTemplate = true
            resourceImage.size = NSSize(width: 18, height: 18)
            return resourceImage
        }

        let canvasSize = NSSize(width: 18, height: 18)
        let image = NSImage(size: canvasSize, flipped: false) { bounds in
            drawBolt(in: bounds)
            return true
        }
        image.isTemplate = true
        image.size = canvasSize
        return image
    }

    private static func loadBundleIcon() -> NSImage? {
        guard let iconURL = Bundle.main.url(forResource: "app_icon", withExtension: "icns"),
              let image = NSImage(contentsOf: iconURL) else {
            return nil
        }
        return image
    }

    private static func drawBolt(in bounds: NSRect) {
        NSColor.black.setFill()

        let bolt = NSBezierPath()
        bolt.move(to: NSPoint(x: 10.8, y: 16.0))
        bolt.line(to: NSPoint(x: 6.7, y: 9.5))
        bolt.line(to: NSPoint(x: 9.4, y: 9.5))
        bolt.line(to: NSPoint(x: 7.4, y: 2.0))
        bolt.line(to: NSPoint(x: 12.5, y: 8.2))
        bolt.line(to: NSPoint(x: 9.9, y: 8.2))
        bolt.close()
        bolt.fill()
    }
}
