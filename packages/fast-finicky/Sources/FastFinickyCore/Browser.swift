public enum Browser: String, Codable, Sendable {
    case chrome
    case ego

    public var displayName: String {
        switch self {
        case .chrome:
            return "Google Chrome"
        case .ego:
            return "Ego Lite"
        }
    }
}
