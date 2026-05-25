# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development (browser)
```
python server.py
# Open http://127.0.0.1:8000
```

### Development (Electron desktop app)
```
cd electron
npm start
```

### Build Windows .exe
```
cd electron
npm run build
# Output: dist/win-unpacked/Budburry's.exe
```

### Sync data from packaged app back to dev
```
cd electron
node sync-data.js
```
Run this before working in dev mode if you've been using the packaged version — it copies `emotes.json`, `song_tags.json`, `categories.json` from `dist/win-unpacked/` back to the project root.

## Architecture

**Stack**: Python HTTP server + vanilla JS frontend + optional Electron wrapper. No build step for the web app — `app.js` and `styles.css` are served directly.

### server.py
Single-file Python HTTP server. Key responsibilities:
- Serves static files from `ROOT` (defaults to script directory, overridden by `PLAYLIST_ROOT` env var for Electron packaging)
- Reads MP3 files from `ROOT/mp3/`, organized into subdirectories by category
- Parses ID3 tags inline (no library) to extract album art as base64
- Persists song tags in `song_tags.json`, emotes list in `emotes.json`, categories inferred from `mp3/` subdirectories
- Streams audio with HTTP range request support (`GET /audio/<path>`)

Key API endpoints: `GET /api/songs`, `POST /api/tags`, `POST /api/move-song`, `POST /api/emotes`, `POST /api/emotes/rename`, `POST /api/emotes/delete`, `POST /api/categories`, `POST /api/categories/rename`, `POST /api/categories/delete`

### app.js
Single-file vanilla JS, no framework. State is a plain object:
```js
state = { songs, categories, tagSet, selectedCategories, selectedTags, search, currentSongId }
```

**Two modes**: Server mode (default, uses `/api/*`) and local mode (fallback, reads `/data/songs.json`, persists edits to `localStorage` key `playlist-local-state-v1`).

**Data flow**: `loadData()` fetches everything → `renderSidebar()` + `renderFilters()` + `renderSongs()`. Any mutation (tag, rename, move) calls the relevant API then re-calls `loadData()`.

**Audio**: HTML5 `<audio>` element. Web Audio API (`AnalyserNode`) drives a 24-bar FFT visualizer drawn on `<canvas>` with `requestAnimationFrame`. AudioContext is created lazily on first play to avoid autoplay restrictions.

**Context menus**: Right-click a song → tag menu (checkboxes per emote + category header). Right-click a category or emote in the sidebar → rename/delete actions menu. Both reuse `#tag-menu` element.

**Drag-and-drop**: Songs are draggable; category `<li>` elements are drop targets. Drop calls `POST /api/move-song`.

**Theme**: `body.dark` class toggled; preference saved to `localStorage`. Logo switches between `logo_black.svg` / `logo_white.svg`.

**Sidebar collapse**: Both panels (Category, Emote) start collapsed. Clicking the `<h2>` heading toggles `.collapsed` class; clicking `+ ADD` auto-expands the panel.

### CSS architecture
All styles in `styles.css`. Theming via CSS custom properties: light values in `:root`, dark overrides in `body.dark`. Key variables: `--accent` (#FF896C), `--bg`, `--sidebar-bg`, `--player-bg`, `--track-bg`, `--player-btn-bg`. Dark-mode-specific gradient styles for seek/volume bars and player buttons use `padding-box / border-box` background trick (not `border-image`, which breaks `border-radius`).

### Electron (electron/)
`main.js` spawns `server.py` as a child process (`shell: true` for reliable PATH resolution on Windows), polls port 8000 until ready, then creates a `BrowserWindow` loading `http://127.0.0.1:8000`. Window close hides to system tray (and pauses audio via `executeJavaScript`); tray double-click restores. Quit kills the Python process.

`electron/package.json` `extraResources` copies `server.py` into `resources/` and all static/data files into the directory next to the `.exe` (using `"to": "../<file>"` paths). `prebuild` script runs `sync-data.js` before every build.

**Path handling**: `PLAYLIST_ROOT` env var is set to `path.dirname(app.getPath('exe'))` in packaged mode so the server finds mp3s and json files next to the exe rather than inside the asar bundle.
