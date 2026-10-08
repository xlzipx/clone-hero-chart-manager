# Building Chart Manager

## Windows (PowerShell)

```powershell
cd "app"
npm install
npm run dist            # app\dist\CHM-Setup-<version>.exe (installer)
npm run dist:portable   # app\dist\CHM-Portable-<version>.exe (portable)
```

## macOS

Must be built on a Mac, since electron-builder can't make a `.dmg` from Windows.

```bash
cd app
npm install
npm run dist:mac        # app/dist/CHM-<version>-mac-<arch>.dmg (+ .zip)
```

The full walkthrough is in [mac-build.md](mac-build.md).

## Linux

Must be built on Linux, since AppImage packaging can't be done from Windows or macOS.
CI does it on `ubuntu-latest` (`.github/workflows/build-linux.yml`): push a `v*` tag or
run the workflow manually.

```bash
cd app
npm install
npm run dist:linux      # app/dist/CHM-<version>-linux-x86_64.AppImage
```

## Notes

All three platforms write into `app/dist/`; those files are published to
[GitHub Releases](https://github.com/xlzipx/clone-hero-chart-manager/releases)
(the Windows installer also emits `latest.yml` and `.blockmap` for auto-update).

The `dist` scripts first build the bundled catalog snapshot
(`app/build/catalog-seed.db.gz`) by crawling both databases once. That needs network
access and takes a few minutes; the result is cached for a week, so back-to-back builds
skip it. Run it on its own with `npm run seed`.

Requirements: Node.js 20+ (tested on 24), plus the bundled tools under `native/`:

- **Onyx CLI.** Windows: `native/onyx/onyx-command-line-*/onyx.exe`
  (`onyx-command-line-*-windows-x64.zip`). macOS: `native/onyx-mac/`
  (`onyx-*-macos-x64.zip`). Linux: `native/onyx-linux/`; Onyx has no separate Linux CLI
  zip, so extract its AppImage (`./onyx-*-linux-x64.AppImage --appimage-extract`) and move
  `squashfs-root/*` into `native/onyx-linux/`. Get them from the
  [Onyx releases](https://github.com/mtolly/onyx/releases).
- **7-Zip** (LGPL, needed for RAR5). Windows: `7z.exe` and `7z.dll` in `native/7zip/`
  from https://www.7-zip.org. macOS: the `7zz` binary in `native/7zip-mac/`. Linux: the
  `7zz` binary in `native/7zip-linux/` (`7z*-linux-x64.tar.xz` from
  https://github.com/ip7z/7zip/releases).

`scripts\make-release.ps1` packages the portable .exe with Onyx and 7-Zip sidecars and a
README into a Release folder and ZIP, if you want a drop-anywhere bundle.

## Project layout

```
app/                     Electron + React + TypeScript (electron-vite)
  src/main/              main process (window, IPC, tray, hotkeys, reminder pill)
    core/                catalog (SQLite), RhythmVerse / Encore clients, downloads,
                         extraction, Onyx conversion, library manager, game detection
    tools/seedgen.ts     builds the bundled catalog snapshot
  src/preload/           contextBridge API (window.api)
  src/renderer/          React UI
native/                  Onyx CLI and 7-Zip binaries per platform
worker/                  Cloudflare Worker that reads full Spotify playlists
pages/                   landing page (chartmanager.pages.dev)
```
