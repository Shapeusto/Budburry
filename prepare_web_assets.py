import json
import shutil
from pathlib import Path

import server

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DATA = WEB / "data"
WEB_MP3 = WEB / "mp3"

STATIC_FILES = [
    "index.html",
    "styles.css",
    "app.js",
    "manifest.webmanifest",
    "sw.js",
    "logo.svg",
    "logo_black.svg",
    "logo_white.svg",
]


def ensure_clean_dir(path: Path):
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def main():
    ensure_clean_dir(WEB)
    DATA.mkdir(parents=True, exist_ok=True)

    for rel in STATIC_FILES:
        src = ROOT / rel
        if src.exists():
            shutil.copy2(src, WEB / rel)

    if (ROOT / "icons").exists():
        shutil.copytree(ROOT / "icons", WEB / "icons", dirs_exist_ok=True)

    if (ROOT / "mp3").exists():
        shutil.copytree(ROOT / "mp3", WEB_MP3, dirs_exist_ok=True)

    payload = server.build_song_list()
    for song in payload.get("songs", []):
        if song.get("audioUrl", "").startswith("/audio/"):
            song["audioUrl"] = "/mp3/" + song["id"]

    out_file = DATA / "songs.json"
    out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Prepared web assets in: {WEB}")


if __name__ == "__main__":
    main()
