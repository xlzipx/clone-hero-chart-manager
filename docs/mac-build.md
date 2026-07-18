# Building Chart Manager for macOS

The macOS build is **unsigned** for now: Gatekeeper will block the first launch, so
users open it with **right-click → Open** once. Auto-update is disabled on macOS
(the app falls back to a "View release" banner that opens the download page).

You must build on a **Mac** — electron-builder cannot produce a `.dmg` from Windows.
Apple Silicon and Intel both work; the build targets your Mac's own architecture.

## 1. Get the code and install deps

```bash
git clone https://github.com/xlzipx/clone-hero-chart-manager
cd clone-hero-chart-manager/app
npm install
```

## 2. Drop in the native binaries

`native/` is git-ignored, so these do not travel with the repo — place them by hand:

### Onyx (RB CON converter) — required for conversion
1. Download `onyx-<date>-macos-x64.zip` from
   <https://github.com/mtolly/onyx/releases/latest>.
2. Unzip it and move the result (typically `Onyx.app`) into
   `native/onyx-mac/`.
   The app locates the `onyx` binary automatically (it searches for a file named
   `onyx`), so the exact folder layout inside `native/onyx-mac/` doesn't matter.
3. **Apple Silicon note:** the Onyx macOS build is Intel (x64). It runs through
   **Rosetta 2** on M-series Macs — install it once with
   `softwareupdate --install-rosetta --agree-to-license` if you don't have it.

### 7-Zip (`7zz`) — required for extracting `.7z` / `.rar` downloads
1. Download the macOS build from <https://www.7-zip.org/download.html>
   (pick the version matching your Mac's architecture — there's a native arm64
   `7zz` for Apple Silicon).
2. Put the `7zz` binary directly in `native/7zip-mac/7zz`.

## 3. Build

```bash
npm run dist:mac
```

Output lands in `app/dist/`:
- `CHM-<version>-mac-<arch>.dmg` — the installer disk image
- a `.zip` — used by electron-updater (harmless even though auto-update is off on mac)

## 4. First launch on a clean Mac

Because the build is unsigned:
1. Open the `.dmg`, drag **Clone Hero Chart Manager** to Applications.
2. In Applications, **right-click the app → Open**, then confirm in the dialog.
   (A normal double-click shows "cannot be opened because the developer cannot be
   verified" and only offers *Cancel* — right-click → Open adds the *Open* button.)

## What's different on macOS vs Windows

- **Clone Hero** is fully supported: detection, launch (`open -a`), and focus-back
  (AppleScript `activate`) all work. Songs auto-detects from `~/Clone Hero/Songs`
  and other common locations.
- **YARG** is supported too — it has an official macOS universal build (via the
  YARC Launcher). CHM detects `YARG.app` (in /Applications or under the YARC
  Launcher folder), launches it and brings it back to the foreground, same as
  Clone Hero. Set the path manually in Settings if it isn't found.
- **Auto-update** is off (unsigned) — manual "View release" banner instead.
- The window uses the same custom title bar; there are also standard macOS menu
  shortcuts (⌘Q, ⌘C/V/A, ⌘W).
