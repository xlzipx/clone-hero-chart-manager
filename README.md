<img width="2077" height="1448" alt="main page" src="https://github.com/user-attachments/assets/7efd22b1-6ac9-4196-88a0-f65ac4304398" />

https://chartmanager.pages.dev/

# Clone Hero Chart Manager (CHM)

A Windows desktop app for searching, downloading and automatically converting
Clone Hero charts from the [RhythmVerse](https://rhythmverse.co/songfiles/game)
and [Chorus Encore](https://www.enchor.us) databases — with drag‑and‑drop
manual installs, an in‑game hotkey reminder pill, and one‑click launch of the
game itself.

## Features

### Search & discovery
- 🔎 **Two databases, one UI** — RhythmVerse + Chorus Encore. Pick one or
  search both at once (merged & de‑duplicated by artist + title + charter,
  Encore preferred when duplicates appear because its hosting is direct).
- ⚡ **Type‑ahead suggestions** — debounced top‑results dropdown appears as
  you type, with album thumbnails and prefix highlighting.
- 🎚️ **Filter chips** — large round instrument buttons (guitar, bass, drums,
  keys, vocals) and a difficulty range picker (`MIN`–`MAX` or exact dots) to
  narrow results.
- 🔀 **Sort** by relevance, title, artist or length.

### Downloads
- ⬇️ **Multi‑host downloader** — Google Drive (files & folders, including the
  virus‑scan confirm bypass), Mediafire (HTML scrape), Dropbox (`dl=1`),
  shorteners (bit.ly, tinyurl, t.co, goo.gl, ow.ly, …) and direct links.
- 🪶 **Manual hosts get a different button** — MEGA, Mediafire and unresolved
  shorteners render as **Get on MEGA** / **Get on Mediafire** / **Download
  manually** instead of a Download button, because they need a real browser
  click (CAPTCHA, encryption, …). Shorteners are resolved in the background
  and re‑label themselves once the final host is known.
- 🔁 **Truncated download retry** — if the host closes the connection early
  (Content‑Length mismatch), the download is retried once before reporting
  the error.
- 🧰 **All archives unpack natively** — zip / 7z / RAR5 via bundled modern
  7‑Zip 24.09. CRC errors and not‑an‑archive cases get friendly, actionable
  error messages.

### Formats & conversion
- `ch` / `chart` / `ps` (Phase Shift) → **native**, just extract and copy.
- `.sng` (Chorus Encore container) → **unpacked** via `parse-sng` into a full
  folder of `song.ini` + chart + audio + album art. Works on every Clone Hero
  version, not just CH 1.0+ which reads `.sng` natively.
- `rb3xbox` Xbox‑360 CON / `.rb3con` → **converted** via the bundled
  [Onyx Music Game Toolkit](https://github.com/mtolly/onyx)
  (`import` → Phase Shift target → `build`).
- `rb3ps3` Rock Band 3 PS3 PKG → **detected and rejected** with a clear
  message (encrypted `.mid_edat` files can't be converted without Sony PS3
  EDAT keys).

### Manual installs (drag & drop)
- 📥 Drop a `.zip`, `.rar`, `.7z`, `.sng` or Rock Band CON file (with **or
  without** extension — magic‑byte detection) onto the drop zone. Or click
  to browse.
- 🤖 **Auto‑fill artist + title** — the app strips common tags (`_PS`, `_RB3`,
  `_v2`, …), splits CamelCase (`LinkinParkNumb` → `Linkin Park Numb`), reads
  metadata directly from `.sng` headers, and falls back to a quick database
  lookup so you don't have to type anything for most files.
- 🗂️ Pick a target subfolder inside `Songs` (or create a new one). Same
  pipeline as a normal download from there.

### Library manager
- 📁 Built‑in file manager for your `Songs` folder with multi‑select,
  cut/copy/paste/delete (uses the Windows recycle bin), rename, create
  folder, right‑click context menu and keyboard shortcuts.

### Clone Hero integration
- 🎮 **Launch / Switch to Clone Hero** button in the title bar — auto‑detects
  `Clone Hero.exe` from common install paths (Steam, Program Files, parent of
  Songs). Lights up green with a pulsing dot when the game is running, and
  brings it to the foreground if it's already open (via Win32
  `SetForegroundWindow` / `ShowWindowAsync` so it works even from a
  minimized state).
- 🔧 **Manual `Clone Hero.exe` path field** in Settings — appears **only** if
  auto‑detection fails (unusual install location).
- 🎯 **Focus restore** — when you hide CHM (hotkey / minimize button), the
  app brings Clone Hero back to the foreground so you don't have to click on
  the game window.

### Hotkey reminder pill (optional)
- 🫧 Tiny **glassmorphism pill** floating in a corner of the screen while
  Clone Hero is running, showing the show/hide hotkey (e.g.
  `🎸 Ctrl + I`).
- Click‑through, can't steal focus from the game, neutral frosted‑glass
  styling. 4 positions (top‑left / top‑right / bottom‑left / bottom‑right).
- Off by default; toggle in Settings.

### UI polish
- Modern frameless window with a center‑lit gradient title bar and plastic
  3D **CHART MANAGER** brand.
- Custom dark dropdowns, themed checkboxes, smooth row entry animations,
  shimmer effect on download buttons, breathing border on the drop zone, etc.
- Accessibility: respects `@prefers-reduced-motion`.

## Architecture

```
Clone Hero Song Downloader/
  app/                           Electron + React + TypeScript (electron-vite)
    src/main/                    main process
      index.ts                   lifecycle
      overlay.ts                 frameless main window + focus restore
      reminder.ts                in-game frosted-glass hotkey pill
      hotkeys.ts                 ASCII-validated global shortcut
      tray.ts                    system tray icon
      ipc.ts                     IPC handlers + game state polling
      core/
        rhythmverse.ts           RhythmVerse API client
        enchor.ts                Chorus Encore API client
        gameformats.ts           format / conversion-needed detection
        download.ts              downloading (GDrive, Mediafire, shorteners, direct)
                                 with Transform-based byte counter (fixes race-lost data)
                                 and Content-Length retry
        extractor.ts             archive extraction via 7z.exe
        sngextract.ts            .sng (Encore container) extraction
        filemeta.ts              peek artist/title from .sng header
        filetype.ts              CON / archive / .sng detection by magic bytes
        converter.ts             conversion via the Onyx CLI
        gamedetect.ts            detect + launch Clone Hero.exe
        library.ts               install into the Songs library + diagnostics
        librarymgr.ts            in-app file manager for Songs
        jobs.ts                  queue: download → extract → convert → install
        config.ts                persistent settings + path auto-detection
    src/preload/index.ts         contextBridge API (window.api)
    src/renderer/                React UI (search, list, difficulties, queue, settings)
  native/onyx/                   Onyx CLI (CON→CH converter)
  native/7zip/                   modern 7-Zip (zip / 7z / RAR5 extraction)
  Release/                       ready-to-share bundle (built locally, not committed)
```

## Install

### Installer (recommended)

Download **`CHM-Setup-<version>.exe`** and run it. The installer is around
120 MB because everything the app needs — the **Onyx** converter, **modern
7‑Zip 24.09** (with RAR5 support) and **parse‑sng** — is bundled inside,
so there are no extra downloads. The installer creates Start‑menu and
desktop shortcuts and registers an entry under *Apps & Features* named
**Clone Hero Chart Manager**.

### Portable

Alternatively, **`CHM-Portable-<version>.exe`** is a single‑file portable
build that runs without installing. Drop it anywhere (its own folder is
fine) and double‑click. Same features, no registry entries.

### First launch

On first launch the app tries to auto‑detect your Clone Hero installation:

1. From the parent of the `Songs` folder.
2. From known paths (`C:\Program Files\Clone Hero`, the Steam library
   path under `Program Files (x86)`, `G:\Clone Hero`, …).

If both fail, **Settings opens automatically** and you point it at your
`Songs` folder once. Everything else is configured from there.

### Build it yourself

```powershell
cd "app"
npm install
npm run dist            # → app\dist\CHM-Setup-<version>.exe (installer)
npm run dist:portable   # → app\dist\CHM-Portable-<version>.exe (portable)
```

Shipped artifacts live in **`release/installer/`** and **`release/portable/`**
in the project root — `app/dist/` is just the build output, the final files
get moved into `release/` for sharing.

Requirements to build: Windows, Node.js 20+ (tested on 24), plus the bundled
tools present locally:

- **Onyx CLI** at `native/onyx/onyx-command-line-*/onyx.exe` — download
  `onyx-command-line-*-windows-x64.zip` from the
  [releases](https://github.com/mtolly/onyx/releases) and unzip it there.
- **`7z.exe` / `7z.dll`** (modern 7‑Zip, LGPL — needed for RAR5) in
  `native\7zip\`. Extract them from the installer at
  https://www.7-zip.org if missing.

`scripts\make-release.ps1` packages the portable .exe with Onyx + 7‑Zip
sidecars and a README into a Release folder + ZIP if you want a "drop
anywhere" bundle for sharing.

## Using the app

- Pick a **database** (RhythmVerse / Chorus Encore / Both) and a **system
  tab** (Clone Hero / Phase Shift / Rock Band / All; hidden for Encore which
  is CH‑only).
- Type a song or artist. Type‑ahead suggestions appear after a short pause —
  click one to jump straight to that song, or hit **Search** for the full
  results page.
- Use the **instrument circles** and **difficulty range** to filter.
- Click **Download** on a row → pick a target subfolder inside `Songs` (or
  create a new one) → done. For hosts the app can't auto‑download from, the
  button is replaced with **Get on MEGA** / **Get on Mediafire** /
  **Download manually**; click that, save the file in your browser, and drop
  it on the drop zone.
- The **Download queue** sits at the bottom of the window during downloads.
  Finished items auto‑dismiss after 5 seconds; failures stick around with
  a friendly explanation. The whole panel collapses to nothing when idle.

### Top‑right controls (title bar)
- 🎮 **Launch / Switch to Clone Hero** — left side, center.
- 📁 **Library manager** — file manager for your `Songs` folder.
- ⚙ **Settings** — Songs folder, CH.exe override (only shown if needed),
  hotkey reminder pill toggle + position, quick‑toggle hotkey, results per
  page.
- ▁ **Hide to tray**.
- ✕ **Quit**.

> **Scanning into the game:** Clone Hero has no external rescan command —
> after a download finishes, switch to the game (the title‑bar button does
> this and then sits idle), open **Settings → General → Scan Songs**, and
> your new songs appear.
>
> **System tray:** when the window is hidden it stays in the system tray.
> Click the tray icon to bring it back, or right‑click it for Show / Quit.

## License

The app's own code (`app/`) is licensed under the **MIT** license — see
[LICENSE](LICENSE).

The app bundles and invokes separate programs with their own licenses
(**Onyx** — GPLv3, **7‑Zip** — LGPL, **parse‑sng** — MIT). See
[THIRD‑PARTY.txt](THIRD-PARTY.txt) for the full list.
