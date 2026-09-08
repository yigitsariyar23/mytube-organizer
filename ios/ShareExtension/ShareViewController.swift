import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let status = UILabel()
    private let save = UIButton(type: .system)
    private var link: SharedLink?
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let title = UILabel(); title.text = "Save to MyTube"; title.font = .preferredFont(forTextStyle: .title2)
        status.text = "Reading YouTube link…"; status.numberOfLines = 0
        save.setTitle("Save video to Watch Later", for: .normal); save.isEnabled = false
        save.addTarget(self, action: #selector(saveLink), for: .touchUpInside)
        let cancel = UIButton(type: .system); cancel.setTitle("Cancel", for: .normal)
        cancel.addTarget(self, action: #selector(close), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, status, save, cancel]); stack.axis = .vertical; stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(stack)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 28), stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24), save.heightAnchor.constraint(greaterThanOrEqualToConstant: 48), cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)])
        preferredContentSize = CGSize(width: 400, height: 320)
        Task { await readLink() }
    }
    private func readLink() async {
        for item in extensionContext?.inputItems as? [NSExtensionItem] ?? [] {
            for provider in item.attachments ?? [] {
                for type in [UTType.url.identifier, UTType.plainText.identifier] where provider.hasItemConformingToTypeIdentifier(type) {
                    let text: String? = await withCheckedContinuation { continuation in
                        provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                            if let url = value as? URL { continuation.resume(returning: url.absoluteString) }
                            else if let text = value as? String { continuation.resume(returning: text) }
                            else if let data = value as? Data { continuation.resume(returning: String(data: data, encoding: .utf8)) }
                            else { continuation.resume(returning: nil) }
                        }
                    }
                    if let text, let parsed = SharedLink.parse(text) {
                        link = parsed
                        status.text = parsed.videoId != nil ? "Save on this device now. The video appears in Watch Later the next time you open MyTube." : "Queue this playlist on this device. Open MyTube to import and review it with your YouTube API key."
                        save.setTitle(parsed.videoId != nil ? "Save video to Watch Later" : "Queue playlist for import", for: .normal)
                        save.isEnabled = true
                        return
                    }
                }
            }
        }
        status.text = "No supported YouTube link was found. Share a video or playlist link from YouTube or your browser."
    }
    @objc private func saveLink() {
        guard let link else { return }
        do { try SharedInbox.configured().enqueue(link); extensionContext?.completeRequest(returningItems: nil) }
        catch { status.text = error.localizedDescription }
    }
    @objc private func close() { extensionContext?.completeRequest(returningItems: nil) }
}
