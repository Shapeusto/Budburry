# Budburry's Playlist

A personal music playlist web app with category filtering, tagging, ratings, drag-and-drop, album art, and a visualizer. Runs locally via a Python HTTP server. Optional Electron wrapper for a desktop app experience.

## Running (browser)

```
python server.py
```

Open `http://127.0.0.1:8000`

If `python` doesn't work, try `py server.py`.

### Optional: custom host and port

```powershell
$env:PLAYLIST_HOST="0.0.0.0"
$env:PLAYLIST_PORT="8080"
python server.py
```

## MP3 setup

Put your MP3 files in `mp3/<CategoryName>/`. Categories are inferred from subdirectory names. Supported formats: mp3, m4a, webm, opus, flac, wav, aac.

Alternatively, set a custom path via ⚙ Settings in the app (persisted in `settings.json`).

## Electron (Windows desktop app)

### First-time setup
```
cd electron
npm install
```

### Run in dev mode
```
cd electron
npm start
```

### Build .exe
```
cd electron
npm run build
```

Output: `dist\win-unpacked\Budburry's.exe`

> Before each build, `prebuild` script runs `sync-data.js` which copies current data from the previous build.

### Returning to dev mode after using the .exe

If you've been using the `.exe` (adding emotes, tags, moving mp3s) and want to edit code again:

**Step 1 — Sync JSON data (emotes, tags, ratings):**
```
cd electron
node sync-data.js
```
Copies `emotes.json`, `song_tags.json`, `song_ratings.json` from `dist\win-unpacked\` back to the project root.

**Step 2 — Sync mp3 folders manually:**

Copy all contents of `dist\win-unpacked\mp3\` and replace your local `mp3\` with it.

---

## Android App

The Android version uses Capacitor (offline, no Python server). MP3s are **not** bundled in the APK — they live on the device and the app reads them from a configurable path.

### Setup

1. Install [Node.js](https://nodejs.org) and [Android Studio](https://developer.android.com/studio) with an emulator (Pixel 6, API 33 recommended)
2. In the project root, install Capacitor dependencies and generate the `web/` assets:

```cmd
npm install
python prepare_web_assets.py
npx cap sync android
npx cap run android
```

> `prepare_web_assets.py` reads MP3 metadata from the local `mp3/` folder to generate `web/data/songs.json`, then copies web assets into `web/`.

3. Push your MP3s to the device (replace `adb` with the full path to your Android SDK if needed):

```cmd
adb push mp3/. /sdcard/BudburryPlaylist/
```

4. In the app: ⚙ Settings → enter `/sdcard/BudburryPlaylist` → Save

5. Grant audio permission: `Settings → Apps → Budburry's → Permissions → Music and audio → Allow`

### Everyday workflow (after code changes)

```cmd
python prepare_web_assets.py
npx cap sync android
npx cap run android
```

### Key differences from desktop

| | Desktop | Android |
|---|---|---|
| MP3 location | `mp3/` (local) | `/sdcard/BudburryPlaylist/` (on device) |
| Server | Python HTTP server | Offline (`localMode = true`) |
| Download (yt-dlp) | ✅ | ❌ |
| Audio permission | not required | `READ_MEDIA_AUDIO` required |
