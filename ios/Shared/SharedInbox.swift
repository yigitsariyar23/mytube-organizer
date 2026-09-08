import Foundation

struct SharedLink: Codable {
    let id: String
    let url: String
    let videoId: String?
    let playlistId: String?
    let createdAt: Double

    static func parse(_ text: String) -> SharedLink? {
        guard let range = text.range(of: "https?://[^\\s<>]+", options: .regularExpression),
              let url = URL(string: String(text[range])), let host = url.host?.lowercased(),
              ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].contains(host),
              url.user == nil, url.password == nil,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let query = parts.queryItems ?? []
        let segments = url.path.split(separator: "/").map(String.init)
        let candidate: String?
        if host == "youtu.be" { candidate = segments.first }
        else if segments.first == "watch" { candidate = query.first { $0.name == "v" }?.value }
        else if ["shorts", "live", "embed"].contains(segments.first ?? ""), segments.count > 1 { candidate = segments[1] }
        else { candidate = nil }
        let video = candidate.flatMap { $0.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) == nil ? nil : $0 }
        let list = query.first { $0.name == "list" }?.value.flatMap { $0.range(of: "^[A-Za-z0-9_-]{2,150}$", options: .regularExpression) == nil ? nil : $0 }
        guard video != nil || list != nil else { return nil }
        return SharedLink(id: UUID().uuidString, url: url.absoluteString, videoId: video, playlistId: list, createdAt: Date().timeIntervalSince1970)
    }
}

struct SharedInbox {
    let directory: URL
    static func configured() throws -> SharedInbox {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "MyTubeAppGroup") as? String,
              let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw NSError(domain: "MyTube", code: 1, userInfo: [NSLocalizedDescriptionKey: "App Group is unavailable. Configure the same App Group for MyTube and its Share extension in Xcode."])
        }
        return SharedInbox(directory: container.appendingPathComponent("Inbox", isDirectory: true))
    }
    func enqueue(_ item: SharedLink) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        // Each share has its own atomic file: the app and extension never rewrite a shared array.
        try JSONEncoder().encode(item).write(to: directory.appendingPathComponent(item.id + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func items() throws -> [SharedLink] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .map { try JSONDecoder().decode(SharedLink.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt < $1.createdAt }
    }
    func acknowledge(_ id: String) throws {
        guard UUID(uuidString: id) != nil else { throw CocoaError(.fileReadInvalidFileName) }
        let url = directory.appendingPathComponent(id + ".json")
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
}
