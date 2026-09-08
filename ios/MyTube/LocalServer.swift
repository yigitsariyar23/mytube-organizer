import Foundation
import Network

// Serves bundled public assets only, on this device's loopback interface. No
// library data or credentials are exposed through HTTP, even to other local apps.
final class LocalServer {
    private var listener: NWListener?
    private let queue = DispatchQueue(label: "MyTube.assets")
    private let root: URL
    // Normalize both sides of the containment check: device bundle URLs can use
    // /private/var while standardized asset URLs use /var.
    init(root: URL) { self.root = root.standardizedFileURL }
    func start(_ completion: @escaping (Result<URL, Error>) -> Void) throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        var delivered = false
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                guard !delivered, let port = listener.port else { return }; delivered = true
                completion(.success(URL(string: "http://127.0.0.1:\(port.rawValue)/dashboard/dashboard.html")!))
            case .failed(let error):
                if !delivered { delivered = true; completion(.failure(error)) }
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            connection.start(queue: self?.queue ?? .main)
            self?.receive(connection, accumulated: Data())
        }
        listener.start(queue: queue)
    }
    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, complete, error in
            guard let self else { connection.cancel(); return }
            let all = accumulated + (data ?? Data())
            guard all.count <= 16384, error == nil else { connection.cancel(); return }
            if let request = String(data: all, encoding: .utf8), request.contains("\r\n\r\n") { self.respond(connection, request) }
            else if complete { connection.cancel() }
            else { self.receive(connection, accumulated: all) }
        }
        queue.asyncAfter(deadline: .now() + 10) { connection.cancel() }
    }
    private func respond(_ connection: NWConnection, _ request: String) {
        let parts = request.components(separatedBy: "\r\n")[0].split(separator: " ")
        guard parts.count == 3, ["GET", "HEAD"].contains(String(parts[0])),
              let path = String(parts[1].split(separator: "?", maxSplits: 1)[0]).removingPercentEncoding,
              path.hasPrefix("/"), !path.split(separator: "/").contains("..") else { send(connection, status: "400 Bad Request", body: Data()); return }
        let file = root.appendingPathComponent(path == "/" ? "dashboard/dashboard.html" : String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let body = try? Data(contentsOf: file) else { send(connection, status: "404 Not Found", body: Data()); return }
        let types = ["html":"text/html", "js":"text/javascript", "css":"text/css", "json":"application/json", "webmanifest":"application/manifest+json", "png":"image/png"]
        send(connection, status: "200 OK", body: parts[0] == "HEAD" ? Data() : body, type: types[file.pathExtension] ?? "application/octet-stream")
    }
    private func send(_ connection: NWConnection, status: String, body: Data, type: String = "text/plain") {
        let csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://www.googleapis.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        let headers = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nContent-Security-Policy: \(csp)\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(headers.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
    }
    deinit { listener?.cancel() }
}
