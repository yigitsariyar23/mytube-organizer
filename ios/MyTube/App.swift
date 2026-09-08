import UIKit
import WebKit

// Startup milestones contain no library content or credentials.
@MainActor func startupLog(_ event: String) {
#if DEBUG
    guard let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return }
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let file = directory.appendingPathComponent("startup-diagnostics.txt")
    let old = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
    let text = String(old.suffix(16000)) + "\(Date()) \(event)\n"
    try? text.write(to: file, atomically: true, encoding: .utf8)
#endif
}

@main final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        startupLog("application launch")
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = LibraryController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
    func applicationDidBecomeActive(_ application: UIApplication) {
        (window?.rootViewController as? LibraryController)?.foreground()
    }
}

final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

final class LibraryController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    private var web: WKWebView!
    private var server: LocalServer?
    private var origin: URL?
    private var store: LocalStore?
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private var startupTimer: Timer?
    private var interfaceReady = false
    private lazy var metadataSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 15
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }()
    override func viewDidLoad() {
        super.viewDidLoad()
        startupLog("viewDidLoad")
        view.backgroundColor = UIColor(red: 0.094, green: 0.098, blue: 0.11, alpha: 1)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent() // Library lives in a native protected file.
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "mytube")
        web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.scrollView.backgroundColor = view.backgroundColor
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor)
        ])
        status.text = "Opening your local library…"
        status.textColor = .white; status.numberOfLines = 0; status.textAlignment = .center
        status.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(status)
        NSLayoutConstraint.activate([status.centerYAnchor.constraint(equalTo: view.centerYAnchor), status.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24), status.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)])
        retry.setTitle("Reload MyTube", for: .normal)
        retry.isHidden = true
        retry.translatesAutoresizingMaskIntoConstraints = false
        retry.addTarget(self, action: #selector(reloadInterface), for: .touchUpInside)
        view.addSubview(retry)
        NSLayoutConstraint.activate([retry.topAnchor.constraint(equalTo: status.bottomAnchor, constant: 16), retry.centerXAnchor.constraint(equalTo: view.centerXAnchor), retry.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)])
        do {
            let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            store = try LocalStore(url: directory.appendingPathComponent("library.json"))
            guard let assets = Bundle.main.url(forResource: "Web", withExtension: nil) else { throw CocoaError(.fileNoSuchFile) }
            let server = LocalServer(root: assets); self.server = server
            try server.start { [weak self] result in
                DispatchQueue.main.async {
                    guard let self else { return }
                    switch result {
                    case .success(let url): startupLog("listener ready"); self.origin = url; self.reloadInterface()
                    case .failure(let error): startupLog("listener failed: \(error.localizedDescription)"); self.status.text = "Could not open MyTube: \(error.localizedDescription)"
                    }
                }
            }
        } catch { status.text = "Your library was not changed. Could not open MyTube: \(error.localizedDescription)" }
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        startupLog("view appeared bounds=\(view.bounds) web=\(web.frame) window=\(String(describing: view.window?.bounds))")
    }
    @objc private func reloadInterface() {
        guard let origin else { return }
        interfaceReady = false
        startupLog("loading interface")
        status.isHidden = false
        status.text = "Opening your local library…"
        retry.isHidden = true
        startupTimer?.invalidate()
        startupTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: false) { [weak self] _ in
            guard let self, !self.interfaceReady else { return }
            startupLog("interface timeout web=\(self.web.frame)")
            self.status.text = "MyTube's interface did not finish loading. Your local library has not been cleared."
            self.retry.isHidden = false
        }
        web.load(URLRequest(url: origin))
    }
    func foreground() { web?.evaluateJavaScript("window.dispatchEvent(new Event('mytube-foreground'))", completionHandler: nil) }
    private func isLocal(_ url: URL?) -> Bool { url?.scheme == origin?.scheme && url?.host == "127.0.0.1" && url?.port == origin?.port && origin != nil }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { startupLog("navigation finished")
        webView.evaluateJavaScript("JSON.stringify({state:document.readyState,elements:document.querySelectorAll('*').length,scripts:Array.from(document.scripts).map(s=>s.getAttribute('src')),body:document.body?.getBoundingClientRect().toJSON()})") { result, error in
            startupLog("page inspection: \(String(describing: result)) error=\(String(describing: error))")
        }
        foreground() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { status.isHidden = false; status.text = "Could not open MyTube: \(error.localizedDescription)"; retry.isHidden = false; startupTimer?.invalidate() }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reloadInterface() }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if isLocal(action.request.url) { decisionHandler(.allow); return }
        if let url = action.request.url, ["https", "http"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url, ["https", "http"].contains(url.scheme ?? ""), !isLocal(url) { UIApplication.shared.open(url) }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "MyTube", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() }); present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "MyTube", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Continue", style: .default) { _ in completionHandler(true) }); present(alert, animated: true)
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, isLocal(message.frameInfo.request.url),
              let body = message.body as? [String: Any], let type = body["type"] as? String, let store else { replyHandler(nil, "Untrusted request"); return }
        do {
            switch type {
            case "ready":
                startupLog("interface ready web=\(web.frame)")
                interfaceReady = true; startupTimer?.invalidate(); status.isHidden = true; retry.isHidden = true
                replyHandler(true, nil)
            case "startupError":
                startupLog("interface startup error")
                startupTimer?.invalidate(); status.isHidden = false; retry.isHidden = false
                status.text = "MyTube could not initialize its interface. Your local library has not been cleared. Tap Reload to try again."
                replyHandler(true, nil)
            case "get": replyHandler(store.get(body["keys"]), nil)
            case "set":
                guard let values = body["values"] as? [String: Any] else { throw CocoaError(.propertyListReadCorrupt) }
                replyHandler(try store.write(values), nil)
            case "remove": replyHandler(try store.write([:], removing: body["keys"] as? [String] ?? []), nil)
            case "inbox": replyHandler(try JSONSerialization.jsonObject(with: JSONEncoder().encode(SharedInbox.configured().items())), nil)
            case "acknowledge": try SharedInbox.configured().acknowledge(body["id"] as? String ?? ""); replyHandler(true, nil)
            case "metadata":
                let video = body["video"] as? String, channel = body["channel"] as? String
                let target: String; let contentType: String
                if let video, video.range(of: "^[A-Za-z0-9_-]{11}$", options: .regularExpression) != nil, channel == nil {
                    target = "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D" + video; contentType = "application/json"
                } else if let channel, channel.range(of: "^UC[A-Za-z0-9_-]{22}$", options: .regularExpression) != nil, video == nil {
                    target = "https://www.youtube.com/feeds/videos.xml?channel_id=" + channel; contentType = "application/xml"
                } else { throw CocoaError(.propertyListReadCorrupt) }
                metadataSession.dataTask(with: URL(string: target)!) { data, response, error in
                    DispatchQueue.main.async {
                        guard error == nil, let data, data.count <= 2_000_000 else { replyHandler(nil, "YouTube could not be reached"); return }
                        replyHandler(["status": (response as? HTTPURLResponse)?.statusCode ?? 502, "body": String(data: data, encoding: .utf8) ?? "", "contentType": contentType], nil)
                    }
                }.resume()
            case "exportBackup":
                guard let backup = body["backup"] as? [String: Any] else { throw CocoaError(.propertyListReadCorrupt) }
                let file = FileManager.default.temporaryDirectory.appendingPathComponent("mytube-backup-\(UUID().uuidString).json")
                try JSONSerialization.data(withJSONObject: backup, options: [.prettyPrinted, .sortedKeys]).write(to: file, options: .atomic)
                let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
                sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: file) }
                present(sheet, animated: true); replyHandler(true, nil)
            default: replyHandler(nil, "Unknown native action")
            }
        } catch { replyHandler(nil, error.localizedDescription) }
    }
}
