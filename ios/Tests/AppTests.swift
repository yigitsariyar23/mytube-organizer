import XCTest

final class AppTests: XCTestCase {
    func testReadOnlyNavigation() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.webViews.buttons["+ Save"].waitForExistence(timeout: 20))
        for label in ["Channels", "New", "Watch Later"] {
            let tab = app.webViews.buttons.matching(NSPredicate(format: "label == %@ OR label == %@", label, label.replacingOccurrences(of: " ", with: "\u{00a0}"))).firstMatch
            XCTAssertTrue(tab.exists)
            tab.tap()
            XCTAssertTrue(app.webViews.buttons["+ Save"].isHittable)
        }
        app.webViews.buttons["Settings"].firstMatch.tap()
        for label in ["Controls", "Backups", "General"] {
            let tab = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
            XCTAssertTrue(tab.waitForExistence(timeout: 3))
            tab.tap()
        }
        app.webViews.buttons["Cancel"].tap()
        app.webViews.buttons["+ Save"].tap()
        XCTAssertTrue(app.webViews.textFields["YouTube link"].waitForExistence(timeout: 3))
        app.webViews.buttons["Cancel"].tap()
        XCTAssertTrue(app.webViews.buttons["+ Save"].isHittable)
    }
    func testLaunchPerformance() {
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: options) {
            XCUIApplication().launch()
        }
    }
    func testBundledLibrarySavesAndSurvivesRelaunch() {
        let app = XCUIApplication()
        app.launch()
        let add = app.webViews.buttons["+ Save"]
        continueAfterFailure = false
        XCTAssertTrue(add.waitForExistence(timeout: 30), "Bundled dashboard must start without a hosted site")
        add.tap()
        let input = app.webViews.textFields["YouTube link"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
        input.typeText("https://www.youtube.com/watch?v=abcdefghijk\n")
        app.webViews.buttons["Save video"].tap()
        XCTAssertTrue(app.webViews.buttons["+ Save"].waitForExistence(timeout: 25))
        // Native file is the durable source even though each launch uses a new port.
        let saved = app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", "abcdefghijk")).firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 25))
        app.terminate(); app.launch()
        XCTAssertTrue(app.webViews.links.matching(NSPredicate(format: "label CONTAINS %@", "abcdefghijk")).firstMatch.waitForExistence(timeout: 30))
    }
}

final class LocalDataTests: XCTestCase {
    func testShareFormatsAndDurableInbox() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let inbox = SharedInbox(directory: directory)
        let video = try XCTUnwrap(SharedLink.parse("Watch this https://youtu.be/abcdefghijk?si=test"))
        XCTAssertEqual(video.videoId, "abcdefghijk")
        XCTAssertNil(SharedLink.parse("https://youtube.com.evil.test/watch?v=abcdefghijk"))
        XCTAssertNil(SharedLink.parse("https://youtube.com/watch?v=bad"))
        let playlist = try XCTUnwrap(SharedLink.parse("https://www.youtube.com/playlist?list=PLexample"))
        XCTAssertNil(playlist.videoId)
        XCTAssertEqual(playlist.playlistId, "PLexample")
        try inbox.enqueue(video); try inbox.enqueue(playlist)
        XCTAssertEqual(try SharedInbox(directory: directory).items().count, 2)
        try inbox.acknowledge(video.id)
        XCTAssertEqual(try inbox.items().map(\.id), [playlist.id])
        XCTAssertThrowsError(try inbox.acknowledge("../library"))
        XCTAssertEqual(try inbox.items().count, 1)
    }
    @MainActor func testNativeStorePersistsAndRefusesCorruptLibrary() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("library.json")
        let store = try LocalStore(url: file)
        _ = try store.write(["videos": ["test": ["saved": true, "watched": false]], "languages": ["Turkish"]])
        let reopened = try LocalStore(url: file)
        XCTAssertEqual((reopened.get("languages")["languages"] as? [String]), ["Turkish"])
        let changes = try reopened.write([:], removing: ["languages"])
        XCTAssertNotNil(changes["languages"])
        XCTAssertNil(try LocalStore(url: file).get(nil)["languages"])
        try Data("broken".utf8).write(to: file)
        XCTAssertThrowsError(try LocalStore(url: file))
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "broken")
    }
}
