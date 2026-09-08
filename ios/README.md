# MyTube for iPhone and iPad

A universal iOS 16+ app with all interface files bundled locally. It uses no hosted
MyTube site, Mac server, or account to run. The tiny HTTP listener binds only to
127.0.0.1 on the phone/tablet to load bundled web modules; it serves no library data.
Native, atomically written storage owns the library and settings across launches.
YouTube metadata/imports and optional, manually reviewed Gist sync require internet.
Each device has its own library; there is no automatic cross-device sync.

## Build and test locally

1. Run `npm run prepare:ios` from the repository root after changing web code.
2. Open `ios/MyTube.xcodeproj` in Xcode. Select the **MyTube** scheme.
3. Choose an iPhone or iPad simulator, then Run. The app embeds **MyTubeShare**.
4. Product → Test runs navigation, save/relaunch, startup timing, and local-storage regression tests. Run data-writing tests in a simulator. For a physical device, select only `AppTests/testReadOnlyNavigation` to avoid sample saves.

No Node, hosted service, or running Mac is required by the installed app.
`ios/Web` is generated and ignored. The Xcode project has no third-party packages.
If target source files change, regenerate it with `python3 scripts/generate-ios-project.py`.

## Install on your devices

In Xcode, add your Apple account and select your development team in Signing &
Capabilities for both MyTube and MyTubeShare. Adjust `MYTUBE_BUNDLE_ID` and
`MYTUBE_APP_GROUP` in `Config.xcconfig` to identifiers owned by that team. Both targets
must use the same App Group. Device signing/capability availability depends on your
Apple account; a free Personal Team may not provision the App Group capability.

Connect an unlocked iPhone or iPad, trust the Mac, enable Developer Mode if prompted,
select the device in Xcode, and Run. Repeat for the other device. Development installs
remain subject to Apple's provisioning expiry; this is not an App Store release.

## Use

- In YouTube or Vivaldi: Share → More → MyTube → Save video to Watch Later.
- A share is saved immediately to a protected, local App Group inbox. Open MyTube
  to incorporate it into Watch Later and fetch its metadata. It survives the main
  app being closed and does not require a network connection to queue.
- Playlist shares queue for review on opening MyTube. Public/unlisted playlist
  import needs a YouTube API key. Private and built-in WL/LL lists are unsupported.
  A link with both a video and playlist ID saves the video; share the playlist's
  own link to queue a playlist.
- Copy/paste with **+ Save** works too. Tap **Actions** for folder/video menus.
- Export backup opens the native Share sheet: use Save to Files for a local copy.
  The existing Import backup control opens the system file picker.
- To move an existing library without cloud sync, export JSON on desktop, transfer
  it to Files on the device (for example using AirDrop), then import and review it.
- Gist sync is optional. It contacts GitHub directly only after you configure it;
  library writes across devices retain the existing explicit review flow.

The app never loads the earlier chatgpt.site deployment. No future cloud deployment
is authorized. Deleting the app removes its local library; keep separate JSON backups.

The app icon is in `MyTube/Assets.xcassets/AppIcon.appiconset`. It reuses `icons/icon128.png`, the extension artwork. `scripts/prepare-ios-icon.swift`
packages it as an opaque 1024px master, and Xcode generates the device sizes. The project generator
preserves the configured development team when recreating target definitions.
