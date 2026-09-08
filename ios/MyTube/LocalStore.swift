import Foundation

// Only the main app writes the library. The Share extension owns inbox files only.
@MainActor final class LocalStore {
    private let url: URL
    private var values: [String: Any]
    init(url: URL) throws {
        self.url = url
        if FileManager.default.fileExists(atPath: url.path) {
            guard let data = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] else { throw CocoaError(.fileReadCorruptFile) }
            values = data
        } else { values = [:] }
    }
    func get(_ keys: Any?) -> [String: Any] {
        if let key = keys as? String { return values.filter { $0.key == key } }
        if let keys = keys as? [String] { return values.filter { keys.contains($0.key) } }
        return values
    }
    func write(_ updates: [String: Any], removing: [String] = []) throws -> [String: Any] {
        var next = values
        var changes: [String: Any] = [:]
        for (key, value) in updates {
            if let old = values[key], NSDictionary(dictionary: ["v": old]).isEqual(to: ["v": value]) { continue }
            var change: [String: Any] = ["newValue": value]
            if let old = values[key] { change["oldValue"] = old }
            changes[key] = change
            next[key] = value
        }
        for key in removing {
            if let old = next.removeValue(forKey: key) { changes[key] = ["oldValue": old] }
        }
        if changes.isEmpty { return changes }
        let data = try JSONSerialization.data(withJSONObject: next, options: [.sortedKeys])
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        values = next
        return changes
    }
}
