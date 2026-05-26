import base64
import json
import mimetypes
import os
import shutil
import threading
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote
from urllib.parse import quote

try:
    from mutagen.id3 import ID3, POPM, ID3NoHeaderError
    MUTAGEN_AVAILABLE = True
except ImportError:
    MUTAGEN_AVAILABLE = False

try:
    import yt_dlp
    YTDLP_AVAILABLE = True
except ImportError:
    YTDLP_AVAILABLE = False

def _ffmpeg_available():
    try:
        import subprocess
        ffmpeg_cmd = os.environ.get('FFMPEG_PATH', 'ffmpeg')
        result = subprocess.run([ffmpeg_cmd, '-version'], capture_output=True, timeout=5)
        return result.returncode == 0
    except Exception:
        return False

def _get_ffmpeg_path():
    import subprocess
    try:
        result = subprocess.run(['where', 'ffmpeg'] if os.name == 'nt' else ['which', 'ffmpeg'],
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip().split('\n')[0]
    except Exception:
        pass
    return 'ffmpeg'

_download_tasks = {}

mimetypes.add_type("application/manifest+json", ".webmanifest")

ROOT = Path(os.environ["PLAYLIST_ROOT"]).resolve() if os.environ.get("PLAYLIST_ROOT") else Path(__file__).resolve().parent
TAGS_FILE = ROOT / "song_tags.json"
EMOTES_FILE = ROOT / "emotes.json"
RATINGS_FILE = ROOT / "song_ratings.json"
SETTINGS_FILE = ROOT / "settings.json"
DEFAULT_TAGS = ["Fast", "Slow", "Funky", "Sad", "Angry"]

def _load_settings():
    if SETTINGS_FILE.exists():
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            if "mp3_path" in data:
                return {"mp3_path": Path(data["mp3_path"]).resolve()}
        except Exception:
            pass
    return {"mp3_path": ROOT / "mp3"}

_settings = _load_settings()
MP3_ROOT = _settings["mp3_path"]


def load_tags_db():
    if TAGS_FILE.exists():
        try:
            return json.loads(TAGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_tags_db(data):
    TAGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_ratings_db():
    if RATINGS_FILE.exists():
        try:
            return json.loads(RATINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_ratings_db(data):
    RATINGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# Maps 1-5 stars to POPM byte (0=unrated, 1=1★, 64=2★, 128=3★, 196=4★, 255=5★)
_STAR_TO_POPM = {0: 0, 1: 1, 2: 64, 3: 128, 4: 196, 5: 255}


def write_rating_to_mp3(song_id: str, rating: int):
    if not MUTAGEN_AVAILABLE:
        return
    mp3_path = (MP3_ROOT / song_id).resolve()
    if not mp3_path.is_file():
        return
    try:
        try:
            tags = ID3(str(mp3_path))
        except ID3NoHeaderError:
            tags = ID3()
        popm_byte = _STAR_TO_POPM.get(rating, 0)
        if popm_byte == 0:
            tags.delall("POPM")
        else:
            tags.add(POPM(email="no@email", rating=popm_byte, count=0))
        tags.save(str(mp3_path))
    except Exception:
        pass


def load_emotes_db():
    if EMOTES_FILE.exists():
        try:
            data = json.loads(EMOTES_FILE.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [str(x).strip() for x in data if str(x).strip()]
        except Exception:
            return []
    return []


def save_emotes_db(emotes):
    dedup = []
    seen = set()
    for e in emotes:
        v = str(e).strip()
        k = v.lower()
        if v and k not in seen:
            seen.add(k)
            dedup.append(v)
    EMOTES_FILE.write_text(json.dumps(dedup, ensure_ascii=False, indent=2), encoding="utf-8")


def rename_emote_everywhere(old_name: str, new_name: str):
    old = old_name.strip().lower()
    new = new_name.strip()
    if not old or not new:
        return

    emotes = load_emotes_db()
    if not emotes:
        emotes = DEFAULT_TAGS[:]
    emotes = [new if e.lower() == old else e for e in emotes]
    save_emotes_db(emotes)

    tags_db = load_tags_db()
    changed = False
    for sid, tags in list(tags_db.items()):
        updated = [new if str(t).strip().lower() == old else t for t in tags]
        if updated != tags:
            tags_db[sid] = updated
            changed = True
    if changed:
        save_tags_db(tags_db)


def remove_emote_everywhere(name: str):
    target = name.strip().lower()
    if not target:
        return

    emotes = load_emotes_db()
    if not emotes:
        emotes = DEFAULT_TAGS[:]
    emotes = [e for e in emotes if e.lower() != target]
    save_emotes_db(emotes)

    tags_db = load_tags_db()
    changed = False
    for sid, tags in list(tags_db.items()):
        filtered = [t for t in tags if str(t).strip().lower() != target]
        if filtered != tags:
            tags_db[sid] = filtered
            changed = True
    if changed:
        save_tags_db(tags_db)


def synchsafe_to_int(b):
    return (b[0] << 21) | (b[1] << 14) | (b[2] << 7) | b[3]


def deunsync(data: bytes) -> bytes:
    # ID3 unsynchronization can inject 0x00 after 0xFF.
    return data.replace(b"\xff\x00", b"\xff")


def parse_apic_payload(frame_data: bytes):
    if len(frame_data) < 4:
        return None
    enc = frame_data[0]
    rest = frame_data[1:]

    mime_end = rest.find(b"\x00")
    if mime_end == -1:
        return None
    mime = rest[:mime_end].decode("latin-1", errors="ignore") or "image/jpeg"
    rest = rest[mime_end + 1:]
    if not rest:
        return None

    # picture type byte
    rest = rest[1:]
    if enc in (0, 3):
        desc_end = rest.find(b"\x00")
        image_data = rest if desc_end == -1 else rest[desc_end + 1:]
    else:
        desc_end = rest.find(b"\x00\x00")
        image_data = rest if desc_end == -1 else rest[desc_end + 2:]

    if image_data:
        return mime, base64.b64encode(image_data).decode("ascii")
    return None


def parse_pic_payload(frame_data: bytes):
    # ID3v2.2 PIC frame: [enc][fmt(3)][type][desc][0][image...]
    if len(frame_data) < 6:
        return None
    enc = frame_data[0]
    fmt = frame_data[1:4].decode("latin-1", errors="ignore").upper()
    mime = {
        "PNG": "image/png",
        "JPG": "image/jpeg",
        "JPEG": "image/jpeg",
        "GIF": "image/gif",
    }.get(fmt, "image/jpeg")
    rest = frame_data[5:]
    if enc in (0, 3):
        desc_end = rest.find(b"\x00")
        image_data = rest if desc_end == -1 else rest[desc_end + 1:]
    else:
        desc_end = rest.find(b"\x00\x00")
        image_data = rest if desc_end == -1 else rest[desc_end + 2:]
    if image_data:
        return mime, base64.b64encode(image_data).decode("ascii")
    return None


def extract_apic_data(mp3_path: Path):
    try:
        with mp3_path.open("rb") as f:
            header = f.read(10)
            if len(header) < 10 or header[0:3] != b"ID3":
                return None

            version = header[3]
            flags = header[5]
            size = synchsafe_to_int(header[6:10])
            tag_data = f.read(size)
            if flags & 0x80:
                tag_data = deunsync(tag_data)

            pos = 0
            if version == 2:
                while pos + 6 <= len(tag_data):
                    frame_id = tag_data[pos:pos + 3].decode("latin-1", errors="ignore")
                    if not frame_id.strip("\x00"):
                        break
                    frame_size = int.from_bytes(tag_data[pos + 3:pos + 6], "big")
                    frame_data_start = pos + 6
                    frame_data_end = frame_data_start + frame_size
                    frame_data = tag_data[frame_data_start:frame_data_end]
                    if frame_id == "PIC":
                        parsed = parse_pic_payload(frame_data)
                        if parsed:
                            return parsed
                    pos = frame_data_end
            else:
                # Skip extended header when present.
                if flags & 0x40 and len(tag_data) >= 4:
                    if version == 4:
                        ext_size = synchsafe_to_int(tag_data[:4])
                    else:
                        ext_size = int.from_bytes(tag_data[:4], "big")
                    pos = ext_size

                while pos + 10 <= len(tag_data):
                    frame_id = tag_data[pos:pos + 4].decode("latin-1", errors="ignore")
                    if not frame_id.strip("\x00"):
                        break

                    if version == 4:
                        frame_size = synchsafe_to_int(tag_data[pos + 4:pos + 8])
                    else:
                        frame_size = int.from_bytes(tag_data[pos + 4:pos + 8], "big")

                    frame_data_start = pos + 10
                    frame_data_end = frame_data_start + frame_size
                    frame_data = tag_data[frame_data_start:frame_data_end]

                    if frame_id == "APIC":
                        parsed = parse_apic_payload(frame_data)
                        if parsed:
                            return parsed

                    pos = frame_data_end
    except Exception:
        return None
    return None


def song_id_from_path(path: Path):
    rel = path.relative_to(MP3_ROOT)
    return str(rel).replace("\\", "/")


def audio_url_from_song_id(song_id: str):
    # Encode each path segment so characters like '#', spaces, unicode etc. are safe in URL.
    return "/audio/" + "/".join(quote(part, safe="") for part in song_id.split("/"))


def normalize_category_name(name: str) -> str:
    return str(name or "").strip()


def validate_category_name(name: str):
    if not name:
        raise ValueError("empty category name")
    if any(ch in name for ch in ("/", "\\", ":", "*", "?", "\"", "<", ">", "|")):
        raise ValueError("invalid category name")
    if name in (".", ".."):
        raise ValueError("invalid category name")


def create_category(name: str):
    category = normalize_category_name(name)
    validate_category_name(category)
    target = (MP3_ROOT / category).resolve()
    if MP3_ROOT.resolve() not in target.parents:
        raise ValueError("invalid target")
    if target.exists():
        raise ValueError("category already exists")
    target.mkdir(parents=False, exist_ok=False)


def rename_category(old_name: str, new_name: str):
    old_cat = normalize_category_name(old_name)
    new_cat = normalize_category_name(new_name)
    validate_category_name(old_cat)
    validate_category_name(new_cat)
    if old_cat.lower() == new_cat.lower():
        return

    src = (MP3_ROOT / old_cat).resolve()
    dst = (MP3_ROOT / new_cat).resolve()
    if MP3_ROOT.resolve() not in src.parents or MP3_ROOT.resolve() not in dst.parents:
        raise ValueError("invalid category path")
    if not src.exists() or not src.is_dir():
        raise ValueError("source category not found")
    if dst.exists():
        raise ValueError("target category already exists")

    src.rename(dst)

    db = load_tags_db()
    updated = {}
    changed = False
    old_prefix = f"{old_cat}/"
    for sid, tags in db.items():
        if sid.startswith(old_prefix):
            changed = True
            updated[f"{new_cat}/{sid[len(old_prefix):]}"] = tags
        else:
            updated[sid] = tags
    if changed:
        save_tags_db(updated)


def delete_category(name: str):
    cat = normalize_category_name(name)
    validate_category_name(cat)
    target = (MP3_ROOT / cat).resolve()
    if MP3_ROOT.resolve() not in target.parents:
        raise ValueError("invalid category path")
    if not target.exists() or not target.is_dir():
        raise ValueError("category not found")
    if any(target.iterdir()):
        raise ValueError("category is not empty")
    target.rmdir()


def safe_move_song(song_id: str, target_category: str):
    src = (MP3_ROOT / song_id).resolve()
    if MP3_ROOT.resolve() not in src.parents or not src.exists() or not src.is_file():
        raise ValueError("invalid source")
    if src.suffix.lower() not in [".mp3", ".m4a", ".webm", ".opus", ".flac", ".wav", ".aac"]:
        raise ValueError("only audio files allowed")

    dst_dir = (MP3_ROOT / target_category).resolve()
    if MP3_ROOT.resolve() not in dst_dir.parents:
        raise ValueError("invalid target")
    if not dst_dir.exists() or not dst_dir.is_dir():
        raise ValueError("target category not found")

    dst = dst_dir / src.name
    if dst.exists():
        base = src.stem
        ext = src.suffix
        i = 2
        while True:
            candidate = dst_dir / f"{base} ({i}){ext}"
            if not candidate.exists():
                dst = candidate
                break
            i += 1

    shutil.move(str(src), str(dst))

    old_id = song_id_from_path(src)
    new_id = song_id_from_path(dst)
    if old_id != new_id:
        db = load_tags_db()
        if old_id in db:
            db[new_id] = db.pop(old_id)
            save_tags_db(db)
    return new_id


def build_song_list():
    tag_db = load_tags_db()
    ratings_db = load_ratings_db()
    categories = []
    songs = []

    if not MP3_ROOT.exists():
        return {"categories": [], "songs": [], "tags": []}

    for category_dir in sorted([d for d in MP3_ROOT.iterdir() if d.is_dir()], key=lambda d: d.name.lower()):
        categories.append(category_dir.name)
        audio_files = []
        for ext in ["*.mp3", "*.m4a", "*.webm", "*.opus", "*.flac", "*.wav", "*.aac"]:
            audio_files.extend(category_dir.glob(ext))
        for mp3_file in sorted(audio_files, key=lambda p: p.name.lower()):
            sid = song_id_from_path(mp3_file)
            title = mp3_file.stem
            tags = tag_db.get(sid, [])

            cover = extract_apic_data(mp3_file)
            cover_url = None
            if cover:
                mime, b64 = cover
                cover_url = f"data:{mime};base64,{b64}"

            songs.append({
                "id": sid,
                "title": title,
                "category": category_dir.name,
                "tags": tags,
                "rating": ratings_db.get(sid, 0),
                "audioUrl": audio_url_from_song_id(sid),
                "coverUrl": cover_url,
            })

    saved_emotes = load_emotes_db()
    if not saved_emotes:
        saved_emotes = DEFAULT_TAGS[:]
    all_tags = sorted(
        set(saved_emotes) | {tag for tags in tag_db.values() for tag in tags},
        key=lambda s: s.lower(),
    )
    return {"categories": categories, "songs": songs, "tags": all_tags}


def _run_download(task_id, url, out_dir):
    import subprocess
    import urllib.request

    def progress_hook(d):
        t = _download_tasks[task_id]
        if d['status'] == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate', 0)
            downloaded = d.get('downloaded_bytes', 0)
            t['title'] = d.get('info_dict', {}).get('title', '')
            if total:
                t['progress'] = downloaded / total
        elif d['status'] == 'finished':
            t['progress'] = 0.95
            t['status'] = 'converting'

    try:
        out_dir.mkdir(exist_ok=True)

        has_ffmpeg = _ffmpeg_available()

        ydl_opts = {
            'format': 'bestaudio',
            'outtmpl': str(out_dir / '%(title)s.%(ext)s'),
            'progress_hooks': [progress_hook],
            'quiet': True,
            'noplaylist': True,
            'writethumbnail': True,
            'keep_video': False,
        }

        if has_ffmpeg:
            ydl_opts['postprocessors'] = [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}]

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            entries = info.get('entries')
            if entries:
                entry_files = [(e, ydl.prepare_filename(e)) for e in entries if e]
            else:
                entry_files = [(info, ydl.prepare_filename(info))]

        # yt-dlp context closed — all file handles released
        def _embed_thumbnail(entry_info, entry_filename):
            if not MUTAGEN_AVAILABLE:
                return
            try:
                from mutagen.id3 import ID3, APIC
                base = entry_filename.rsplit('.', 1)[0]
                mp3 = base + '.mp3'
                if not Path(mp3).exists():
                    mp3 = entry_filename
                if not Path(mp3).exists():
                    return
                thumbnail_url = entry_info.get('thumbnail')
                if not thumbnail_url:
                    return
                thumb_ext = thumbnail_url.split('.')[-1].split('?')[0].lower()
                if thumb_ext not in ('jpg', 'jpeg', 'png', 'webp'):
                    thumb_ext = 'jpg'
                thumb_path = base + '.' + thumb_ext
                urllib.request.urlretrieve(thumbnail_url, thumb_path)
                if not Path(thumb_path).exists():
                    return
                try:
                    audio = ID3(mp3)
                except ID3NoHeaderError:
                    audio = ID3()
                mime_type = 'image/webp' if thumb_ext == 'webp' else 'image/jpeg'
                with open(thumb_path, 'rb') as f:
                    audio['APIC'] = APIC(encoding=3, mime=mime_type, type=3, desc=u'Cover', data=f.read())
                audio.save(mp3, v2_version=4)
                del audio
                Path(thumb_path).unlink()
            except Exception:
                pass

        for entry_info, entry_filename in entry_files:
            _embed_thumbnail(entry_info, entry_filename)

        for ext in ['webp', 'jpg', 'jpeg', 'png']:
            for p in out_dir.glob(f'*.{ext}'):
                try:
                    p.unlink()
                except Exception:
                    pass

        _download_tasks[task_id]['status'] = 'done'
        _download_tasks[task_id]['progress'] = 1.0
    except Exception as e:
        _download_tasks[task_id]['status'] = 'error'
        _download_tasks[task_id]['error'] = str(e)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_file(self, path: Path):
        if not path.exists() or not path.is_file():
            self.send_error(404, "Not found")
            return
        ctype, _ = mimetypes.guess_type(str(path))
        file_size = path.stat().st_size
        range_header = self.headers.get("Range")

        if range_header and range_header.startswith("bytes="):
            try:
                range_spec = range_header.split("=", 1)[1].strip()
                start_s, end_s = range_spec.split("-", 1)
                if start_s == "":
                    length = int(end_s)
                    start = max(0, file_size - length)
                    end = file_size - 1
                else:
                    start = int(start_s)
                    end = int(end_s) if end_s else file_size - 1
                if start < 0 or end >= file_size or start > end:
                    raise ValueError("invalid range")
            except Exception:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.end_headers()
                return

            chunk_size = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Content-Length", str(chunk_size))
            self.end_headers()
            with path.open("rb") as f:
                f.seek(start)
                self.wfile.write(f.read(chunk_size))
            return

        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(file_size))
        self.end_headers()
        with path.open("rb") as f:
            self.wfile.write(f.read())

    def do_GET(self):
        if self.path == "/api/songs":
            self._send_json(build_song_list())
            return

        if self.path == "/api/settings":
            self._send_json({"mp3_path": str(MP3_ROOT)})
            return

        if self.path.startswith("/audio/"):
            rel = unquote(self.path[len("/audio/"):])
            target = (MP3_ROOT / rel).resolve()
            if MP3_ROOT.resolve() not in target.parents:
                self.send_error(403, "Forbidden")
                return
            self._send_file(target)
            return

        if self.path.startswith("/api/download/status"):
            from urllib.parse import parse_qs
            qs = parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            task_id = (qs.get("id") or [""])[0]
            task = _download_tasks.get(task_id)
            if not task:
                self._send_json({"error": "not found"}, 404)
            else:
                self._send_json(task)
            return

        static_map = {
            "/": ROOT / "index.html",
            "/index.html": ROOT / "index.html",
            "/styles.css": ROOT / "styles.css",
            "/app.js": ROOT / "app.js",
            "/logo.svg": ROOT / "logo.svg",
        }
        if self.path in static_map:
            self._send_file(static_map[self.path])
            return

        # Fallback static file serving from project root (e.g. /logo.svg).
        req_path = unquote(self.path.lstrip("/"))
        candidate = (ROOT / req_path).resolve()
        if ROOT.resolve() in candidate.parents and candidate.is_file():
            self._send_file(candidate)
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        if self.path == "/api/ratings":
            self._handle_ratings()
            return
        if self.path != "/api/tags":
            if self.path == "/api/emotes":
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body.decode("utf-8"))
                    name = str(payload.get("name", "")).strip()
                    if not name:
                        raise ValueError("empty")
                except Exception:
                    self._send_json({"ok": False, "error": "invalid payload"}, 400)
                    return

                emotes = load_emotes_db()
                exists = any(e.lower() == name.lower() for e in emotes)
                if not exists:
                    emotes.append(name)
                    save_emotes_db(emotes)
                self._send_json({"ok": True})
                return

            if self.path == "/api/categories":
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body.decode("utf-8"))
                    name = str(payload.get("name", "")).strip()
                    if not name:
                        raise ValueError("empty")
                    create_category(name)
                except Exception as e:
                    self._send_json({"ok": False, "error": str(e) or "invalid payload"}, 400)
                    return
                self._send_json({"ok": True})
                return

            if self.path == "/api/categories/rename":
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body.decode("utf-8"))
                    old_name = str(payload.get("oldName", "")).strip()
                    new_name = str(payload.get("newName", "")).strip()
                    if not old_name or not new_name:
                        raise ValueError("missing fields")
                    rename_category(old_name, new_name)
                except Exception as e:
                    self._send_json({"ok": False, "error": str(e) or "invalid payload"}, 400)
                    return
                self._send_json({"ok": True})
                return

            if self.path == "/api/categories/delete":
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body.decode("utf-8"))
                    name = str(payload.get("name", "")).strip()
                    if not name:
                        raise ValueError("empty")
                    delete_category(name)
                except Exception as e:
                    self._send_json({"ok": False, "error": str(e) or "invalid payload"}, 400)
                    return
                self._send_json({"ok": True})
                return

            if self.path == "/api/move-song":
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body.decode("utf-8"))
                    sid = str(payload.get("id", "")).strip()
                    target_category = str(payload.get("targetCategory", "")).strip()
                    if not sid or not target_category:
                        raise ValueError("missing fields")
                except Exception:
                    self._send_json({"ok": False, "error": "invalid payload"}, 400)
                    return

                try:
                    new_id = safe_move_song(sid, target_category)
                except Exception as e:
                    self._send_json({"ok": False, "error": str(e)}, 400)
                    return

                self._send_json({"ok": True, "newId": new_id})
                return
            if self.path == "/api/emotes/delete":
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body.decode("utf-8"))
                    name = str(payload.get("name", "")).strip()
                    if not name:
                        raise ValueError("empty")
                except Exception:
                    self._send_json({"ok": False, "error": "invalid payload"}, 400)
                    return

                remove_emote_everywhere(name)
                self._send_json({"ok": True})
                return

            if self.path == "/api/emotes/rename":
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body.decode("utf-8"))
                    old_name = str(payload.get("oldName", "")).strip()
                    new_name = str(payload.get("newName", "")).strip()
                    if not old_name or not new_name:
                        raise ValueError("missing fields")
                    rename_emote_everywhere(old_name, new_name)
                except Exception as e:
                    self._send_json({"ok": False, "error": str(e) or "invalid payload"}, 400)
                    return
                self._send_json({"ok": True})
                return

            if self.path == "/api/settings":
                global MP3_ROOT
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body.decode("utf-8"))
                    new_path = Path(payload.get("mp3_path", "")).resolve()
                except Exception:
                    self._send_json({"ok": False, "error": "invalid payload"}, 400)
                    return
                MP3_ROOT = new_path
                SETTINGS_FILE.write_text(json.dumps({"mp3_path": str(new_path)}, ensure_ascii=False), encoding="utf-8")
                self._send_json({"ok": True, "mp3_path": str(MP3_ROOT)})
                return

            if self.path == "/api/download":
                if not YTDLP_AVAILABLE:
                    self._send_json({"ok": False, "error": "yt-dlp not installed"}, 500)
                    return
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length)
                try:
                    payload = json.loads(body.decode("utf-8"))
                    url = payload.get("url", "").strip()
                except Exception:
                    self._send_json({"ok": False, "error": "invalid payload"}, 400)
                    return
                if not url:
                    self._send_json({"ok": False, "error": "no url"}, 400)
                    return
                out_dir = MP3_ROOT / "downloaded"
                out_dir.mkdir(exist_ok=True)
                task_id = str(uuid.uuid4())
                _download_tasks[task_id] = {"progress": 0.0, "status": "downloading", "title": "", "error": None}
                threading.Thread(target=_run_download, args=(task_id, url, out_dir), daemon=True).start()
                self._send_json({"ok": True, "id": task_id})
                return

            self.send_error(404, "Not found")
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8"))
            sid = payload["id"]
            tags = [str(t).strip() for t in payload.get("tags", []) if str(t).strip()]
        except Exception:
            self._send_json({"ok": False, "error": "invalid payload"}, 400)
            return

        db = load_tags_db()
        db[sid] = sorted(set(tags), key=lambda s: s.lower())
        save_tags_db(db)
        self._send_json({"ok": True})

    def _handle_ratings(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8"))
            sid = str(payload.get("id", "")).strip()
            rating = int(payload.get("rating", 0))
            if not sid or not (0 <= rating <= 5):
                raise ValueError("invalid")
        except Exception:
            self._send_json({"ok": False, "error": "invalid payload"}, 400)
            return
        db = load_ratings_db()
        if rating == 0:
            db.pop(sid, None)
        else:
            db[sid] = rating
        save_ratings_db(db)
        write_rating_to_mp3(sid, rating)
        self._send_json({"ok": True})


def main():
    host = os.environ.get("PLAYLIST_HOST", "127.0.0.1")
    port = int(os.environ.get("PLAYLIST_PORT", "8000"))
    server = HTTPServer((host, port), Handler)
    print(f"Playlist app running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
