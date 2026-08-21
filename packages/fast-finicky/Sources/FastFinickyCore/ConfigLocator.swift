import Foundation

public struct ConfigLocator: Sendable {
    private let paths: AppPaths

    public init(paths: AppPaths = AppPaths()) {
        self.paths = paths
    }

    public func locate() -> URL {
        paths.configURL
    }
}
