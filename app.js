const state = {
  songs: [],
  categories: [],
  tagSet: new Set(),
  selectedCategories: new Set(),
  selectedTags: new Set(),
  search: "",
  currentSongId: null,
  viewMode: "grid",
  sortMode: "default",
};
const LOCAL_STATE_KEY = "playlist-local-state-v1";
const isNative = !!(window.Capacitor?.isNativePlatform?.());
let localMode = isNative;
let localState = { songTags: {}, songCategories: {}, emotes: [], categories: [] };

const categoryList = document.getElementById("category-list");
const categoryAddBtn = document.getElementById("category-add-btn");
const newCategoryInput = document.getElementById("new-category-input");
const emoteList = document.getElementById("emote-list");
const emoteAddBtn = document.getElementById("emote-add-btn");
const newEmoteInput = document.getElementById("new-emote-input");
const selectedFilters = document.getElementById("selected-filters");
const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
const themeToggle = document.getElementById("theme-toggle");
const themeToggleIcon = document.getElementById("theme-toggle-icon");
const settingsToggle = document.getElementById("settings-toggle");
const settingsOverlay = document.getElementById("settings-overlay");
const settingsMp3Path = document.getElementById("settings-mp3-path");
const settingsSave = document.getElementById("settings-save");
const settingsCancel = document.getElementById("settings-cancel");
const brandLogo = document.getElementById("brand-logo");
const songGrid = document.getElementById("song-grid");
const btnViewGrid = document.getElementById("btn-view-grid");
const btnViewList = document.getElementById("btn-view-list");
const btnSortName = document.getElementById("btn-sort-name");
const btnSortStar = document.getElementById("btn-sort-star");
const audio = document.getElementById("audio-player");
const tagMenu = document.getElementById("tag-menu");
const bottomPlayer = document.getElementById("bottom-player");
const dialogOverlay = document.getElementById("custom-dialog-overlay");
const dialogMessage = document.getElementById("custom-dialog-message");
const dialogInput = document.getElementById("custom-dialog-input");
const dialogOk = document.getElementById("custom-dialog-ok");
const dialogCancel = document.getElementById("custom-dialog-cancel");

let _dialogResolve = null;
function _closeDialog(value) {
  dialogOverlay.classList.add("hidden");
  if (_dialogResolve) { _dialogResolve(value); _dialogResolve = null; }
}
dialogOk.addEventListener("click", () => _closeDialog(true));
dialogCancel.addEventListener("click", () => _closeDialog(null));
dialogInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") _closeDialog(true);
  if (e.key === "Escape") _closeDialog(null);
});
dialogOverlay.addEventListener("click", (e) => { if (e.target === dialogOverlay) _closeDialog(null); });

function showPrompt(message, defaultValue = "") {
  return new Promise((resolve) => {
    _dialogResolve = (confirmed) => resolve(confirmed ? dialogInput.value : null);
    dialogMessage.textContent = message;
    dialogInput.value = defaultValue;
    dialogInput.style.display = "block";
    dialogOk.textContent = "OK";
    dialogCancel.style.display = "inline-block";
    dialogOverlay.classList.remove("hidden");
    setTimeout(() => { dialogInput.focus(); dialogInput.select(); }, 50);
  });
}

function showConfirm(message) {
  return new Promise((resolve) => {
    _dialogResolve = (confirmed) => resolve(!!confirmed);
    dialogMessage.textContent = message;
    dialogInput.style.display = "none";
    dialogOk.textContent = "OK";
    dialogCancel.style.display = "inline-block";
    dialogOverlay.classList.remove("hidden");
    setTimeout(() => dialogOk.focus(), 50);
  });
}

function showAlert(message) {
  return new Promise((resolve) => {
    _dialogResolve = () => resolve();
    dialogMessage.textContent = message;
    dialogInput.style.display = "none";
    dialogOk.textContent = "OK";
    dialogCancel.style.display = "none";
    dialogOverlay.classList.remove("hidden");
    setTimeout(() => dialogOk.focus(), 50);
  });
}
const playerCover = document.getElementById("player-cover");
const playerTitle = document.getElementById("player-title");
const playerSubtitle = document.getElementById("player-subtitle");
const playerToggle = document.getElementById("player-toggle");
const playerToggleIcon = document.getElementById("player-toggle-icon");
const playerPrev = document.getElementById("player-prev");
const playerNext = document.getElementById("player-next");
const playerCurrentTime = document.getElementById("player-current-time");
const playerTotalTime = document.getElementById("player-total-time");
const playerSeek = document.getElementById("player-seek");
const searchWrap = document.getElementById("search-wrap");
const downloadToggle = document.getElementById("download-toggle");
const downloadWrap = document.getElementById("download-wrap");
const downloadInput = document.getElementById("download-input");
const downloadBtn = document.getElementById("download-btn");
const downloadProgressWrap = document.getElementById("download-progress-wrap");
const downloadProgressBar = document.getElementById("download-progress-bar");
const downloadStatus = document.getElementById("download-status");
const playerSeekBar = document.getElementById("player-seek-bar");
const playerVolume = document.getElementById("player-volume");
const playerVolumeBar = document.getElementById("player-volume-bar");
const playerVolumeToggle = document.getElementById("player-volume-toggle");

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}

let visibleSongs = [];
let renderedCount = 0;
const PAGE_SIZE = 40;
let _scrollSentinel = null;
let _scrollObserver = null;
const durationCache = new Map();
const coverCache = new Map();

function _b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

function extractAlbumArt(buffer) {
  const b = new Uint8Array(buffer);
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;
  const ver = b[3];
  const hasExtHeader = (b[5] & 0x40) !== 0;
  const tagSize = ((b[6] & 0x7F) << 21) | ((b[7] & 0x7F) << 14) | ((b[8] & 0x7F) << 7) | (b[9] & 0x7F);
  let off = 10;
  if (hasExtHeader) {
    const extSize = ver === 4
      ? ((b[10] & 0x7F) << 21) | ((b[11] & 0x7F) << 14) | ((b[12] & 0x7F) << 7) | (b[13] & 0x7F)
      : (b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13];
    off += extSize;
  }
  const end = Math.min(tagSize + 10, b.length);
  while (off < end - 10) {
    let fid, fsz, fhs;
    if (ver >= 3) {
      fid = String.fromCharCode(b[off], b[off+1], b[off+2], b[off+3]);
      fsz = ver === 4
        ? ((b[off+4] & 0x7F) << 21) | ((b[off+5] & 0x7F) << 14) | ((b[off+6] & 0x7F) << 7) | (b[off+7] & 0x7F)
        : (b[off+4] << 24) | (b[off+5] << 16) | (b[off+6] << 8) | b[off+7];
      fhs = 10;
    } else {
      fid = String.fromCharCode(b[off], b[off+1], b[off+2]);
      fsz = (b[off+3] << 16) | (b[off+4] << 8) | b[off+5];
      fhs = 6;
    }
    if (fsz <= 0) break;
    if (fid === "APIC" || fid === "PIC") {
      let i = off + fhs;
      const enc = b[i++];
      let mime;
      if (fid === "PIC") {
        mime = String.fromCharCode(b[i], b[i+1], b[i+2]) === "PNG" ? "image/png" : "image/jpeg";
        i += 3;
      } else {
        let me = i; while (me < b.length && b[me] !== 0) me++;
        mime = String.fromCharCode(...b.slice(i, me)) || "image/jpeg";
        i = me + 1;
      }
      i++; // picture type
      if (enc === 0 || enc === 3) { while (i < b.length && b[i] !== 0) i++; i++; }
      else { while (i < b.length - 1 && !(b[i] === 0 && b[i+1] === 0)) i += 2; i += 2; }
      const img = b.subarray(i, off + fhs + fsz);
      if (img.length > 0) return `data:${mime};base64,${_b64(img)}`;
    }
    off += fhs + fsz;
  }
  return null;
}

let _coverActive = 0;
const _coverQueue = [];

function _coverNext() {
  while (_coverActive < 3 && _coverQueue.length > 0) {
    const fn = _coverQueue.shift();
    _coverActive++;
    fn().finally(() => { _coverActive--; _coverNext(); });
  }
}

async function ensureSongCover(song) {
  if (coverCache.has(song.id)) return;
  if (song.coverUrl) { coverCache.set(song.id, song.coverUrl); return; }
  coverCache.set(song.id, null);
  _coverQueue.push(async () => {
    try {
      const url = resolveAudioUrl(song.audioUrl);
      const resp = await fetch(url, { headers: { Range: "bytes=0-131071" } });
      const buf = await resp.arrayBuffer();
      const art = extractAlbumArt(buf);
      coverCache.set(song.id, art);
      if (art) {
        const card = document.querySelector(`.song-card[data-id="${CSS.escape(song.id)}"]`);
        if (card) card.querySelector(".thumb").style.backgroundImage = `url('${art}')`;
        if (state.currentSongId === song.id) playerCover.style.backgroundImage = `url('${art}')`;
      }
    } catch (_) {}
  });
  _coverNext();
}

const _coverObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    _coverObserver.unobserve(entry.target);
    const song = state.songs.find(s => s.id === entry.target.dataset.id);
    if (song) ensureSongCover(song);
  }
}, { rootMargin: "300px" });
let draggingSongId = null;
let dragGhostEl = null;
let bottomPlayerHasAnimatedIn = false;

// Visualizer
const visualizerCanvas = document.getElementById("visualizer");
const vCtx = visualizerCanvas.getContext("2d");
const BAR_COUNT = 24;
const BAR_W = 3;
const BAR_GAP = 2;
visualizerCanvas.width = BAR_COUNT * (BAR_W + BAR_GAP) - BAR_GAP;
visualizerCanvas.height = 28;

let audioCtx = null;
let analyser = null;
let audioSource = null;
let vizBars = new Float32Array(BAR_COUNT).fill(0);
let vizRaf = null;

function initAudioContext() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  audioSource = audioCtx.createMediaElementSource(audio);
  audioSource.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function drawVisualizer() {
  vizRaf = requestAnimationFrame(drawVisualizer);
  const W = visualizerCanvas.width;
  const H = visualizerCanvas.height;
  vCtx.clearRect(0, 0, W, H);

  const isDark = document.body.classList.contains("dark");
  const barColor = isDark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.18)";

  let freqData = null;
  if (analyser && !audio.paused) {
    freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);
  }

  for (let i = 0; i < BAR_COUNT; i++) {
    let target = 0;
    if (freqData) {
      const bin = Math.floor((i / BAR_COUNT) * (freqData.length * 0.75));
      target = freqData[bin] / 255;
    }
    vizBars[i] += (target - vizBars[i]) * 0.25;
    const barH = Math.max(2, vizBars[i] * H);
    const x = i * (BAR_W + BAR_GAP);
    const y = H - barH;
    vCtx.fillStyle = barColor;
    const r = BAR_W / 2;
    const cx = x + r;
    vCtx.beginPath();
    if (barH <= BAR_W) {
      vCtx.arc(cx, H - r, r, 0, Math.PI * 2);
    } else {
      vCtx.arc(cx, y + r, r, Math.PI, 0);
      vCtx.lineTo(cx + r, H - r);
      vCtx.arc(cx, H - r, r, 0, Math.PI);
      vCtx.closePath();
    }
    vCtx.fill();
  }
}

audio.addEventListener("play", () => {
  initAudioContext();
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (!vizRaf) drawVisualizer();
}, { passive: true });

audio.addEventListener("pause", () => {}, { passive: true });

drawVisualizer();

function normalizeTag(tag) {
  return tag.trim();
}

function canonicalTag(tag) {
  return normalizeTag(tag).toLowerCase();
}

function applyTheme(mode) {
  const dark = mode === "dark";
  document.body.classList.toggle("dark", dark);
  themeToggleIcon.className = `ui-icon ${dark ? "icon-sun" : "icon-moon"}`;
  const logoSrc = dark ? "/logo_white.svg" : "/logo_black.svg";
  brandLogo.src = logoSrc;
  const preloaderLogo = document.getElementById("preloader-logo");
  if (preloaderLogo) preloaderLogo.src = logoSrc;
}

function initTheme() {
  const saved = localStorage.getItem("theme-mode");
  const mode = saved === "light" ? "light" : "dark";
  applyTheme(mode);
}

async function scanDeviceSongs() {
  const basePath = (localStorage.getItem("settings-mp3-path") || "").replace(/\/+$/, "");
  if (!basePath) return { songs: [], categories: [], tags: [] };
  const { Filesystem } = window.Capacitor?.Plugins || {};
  if (!Filesystem) return { songs: [], categories: [], tags: [] };
  const audioExts = [".mp3", ".m4a", ".webm", ".opus", ".flac", ".wav", ".aac"];
  const categories = [];
  const songs = [];
  try {
    const { files: topFiles } = await Filesystem.readdir({ path: basePath });
    const dirs = topFiles.filter(f => f.type === "directory").sort((a, b) => a.name.localeCompare(b.name));
    // MP3s directly in root (no subfolders) — no category
    const rootAudio = topFiles
      .filter(f => f.type === "file" && audioExts.some(ext => f.name.toLowerCase().endsWith(ext)))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const file of rootAudio) {
      songs.push({ id: file.name, title: file.name.replace(/\.[^.]+$/, ""), category: "", audioUrl: file.name, coverUrl: null, tags: [], rating: 0 });
    }
    // MP3s in subfolders — category = subfolder name
    for (const dir of dirs) {
      try {
        const { files: dirFiles } = await Filesystem.readdir({ path: basePath + "/" + dir.name });
        const audioFiles = dirFiles
          .filter(f => f.type === "file" && audioExts.some(ext => f.name.toLowerCase().endsWith(ext)))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (audioFiles.length > 0) {
          categories.push(dir.name);
          for (const file of audioFiles) {
            const id = dir.name + "/" + file.name;
            songs.push({ id, title: file.name.replace(/\.[^.]+$/, ""), category: dir.name, audioUrl: id, coverUrl: null, tags: [], rating: 0 });
          }
        }
      } catch (_) {}
    }
  } catch (e) {
    console.error("scanDeviceSongs failed:", e);
  }
  return { songs, categories, tags: [] };
}

async function loadData() {
  let data;
  try {
    const resp = await fetch("/api/songs");
    if (!resp.ok) throw new Error("api unavailable");
    data = await resp.json();
  } catch (_err) {
    localMode = true;
    if (isNative) {
      data = await scanDeviceSongs();
    } else {
      const resp = await fetch("/data/songs.json");
      if (!resp.ok) throw new Error("local songs.json not found");
      data = await resp.json();
    }
  }

  if (localMode) {
    loadLocalState();
    applyLocalOverrides(data);
  }

  state.songs = data.songs;
  state.categories = data.categories;
  state.tagSet = new Set(data.tags);

  state.songs.forEach((song) => song.tags.forEach((t) => state.tagSet.add(t)));

  renderSidebar();
  renderFilters();
  renderSongs();
}

async function moveSongToCategory(songId, category) {
  if (localMode) {
    localState.songCategories[songId] = category;
    persistLocalState();
    const song = state.songs.find((s) => s.id === songId);
    if (song) song.category = category;
    if (!state.categories.includes(category)) state.categories.push(category);
    renderSidebar();
    renderFilters();
    renderSongs();
    return;
  }
  const resp = await fetch("/api/move-song", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: songId, targetCategory: category }),
  });
  if (!resp.ok) throw new Error("Song move failed");
  await loadData();
}

async function createCategory(name) {
  if (localMode) {
    if (!state.categories.includes(name)) state.categories.push(name);
    if (!localState.categories.includes(name)) localState.categories.push(name);
    persistLocalState();
    return;
  }
  const resp = await fetch("/api/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) {
    const msg = await resp.json().catch(() => ({}));
    throw new Error(msg.error || "Category create failed");
  }
}

async function renameCategory(oldName, newName) {
  if (localMode) {
    state.categories = state.categories.map((c) => (c === oldName ? newName : c));
    state.songs.forEach((s) => {
      if (s.category === oldName) {
        s.category = newName;
        localState.songCategories[s.id] = newName;
      }
    });
    localState.categories = state.categories.slice();
    persistLocalState();
    return;
  }
  const resp = await fetch("/api/categories/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldName, newName }),
  });
  if (!resp.ok) {
    const msg = await resp.json().catch(() => ({}));
    throw new Error(msg.error || "Category rename failed");
  }
}

async function deleteCategory(name) {
  if (localMode) {
    state.categories = state.categories.filter((c) => c !== name);
    const fallback = state.categories[0] || "Uncategorized";
    state.songs.forEach((s) => {
      if (s.category === name) {
        s.category = fallback;
        localState.songCategories[s.id] = fallback;
      }
    });
    localState.categories = state.categories.slice();
    persistLocalState();
    return;
  }
  const resp = await fetch("/api/categories/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!resp.ok) {
    const msg = await resp.json().catch(() => ({}));
    throw new Error(msg.error || "Category delete failed");
  }
}

function renderSidebar() {
  const categoryCount = new Map();
  const tagCount = new Map();
  const currentSong = state.songs.find((s) => s.id === state.currentSongId);
  const playingCategory = currentSong ? currentSong.category : null;

  state.songs.forEach((song) => {
    categoryCount.set(song.category, (categoryCount.get(song.category) || 0) + 1);
    song.tags.forEach((tag) => {
      tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
    });
  });

  categoryList.innerHTML = "";
  state.categories.forEach((cat) => {
    const li = document.createElement("li");
    const showPlayingMarker = playingCategory === cat && !audio.paused;
    li.innerHTML = `<span>${cat}</span><span class="meta">${showPlayingMarker ? '<span class="playing-marker"><span class="ui-icon icon-play"></span></span>' : ''}<span class="count">${categoryCount.get(cat) || 0}</span></span>`;
    li.className = state.selectedCategories.has(cat) ? "" : "muted";
    li.onclick = () => {
      if (state.selectedCategories.has(cat)) state.selectedCategories.delete(cat);
      else state.selectedCategories.add(cat);
      renderSidebar();
      renderFilters();
      renderSongs();
    };
    li.oncontextmenu = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openCategoryActionsMenu(cat, ev.clientX, ev.clientY);
    };
    li.ondragover = (ev) => {
      if (!draggingSongId) return;
      ev.preventDefault();
      li.classList.add("drop-target");
    };
    li.ondragleave = () => li.classList.remove("drop-target");
    li.ondrop = async (ev) => {
      ev.preventDefault();
      li.classList.remove("drop-target");
      if (!draggingSongId) return;
      try {
        await moveSongToCategory(draggingSongId, cat);
      } catch (err) {
        console.error(err);
      } finally {
        draggingSongId = null;
      }
    };
    categoryList.appendChild(li);
  });

  emoteList.innerHTML = "";
  [...state.tagSet].sort((a, b) => a.localeCompare(b)).forEach((tag) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${tag}</span><span class="count">${tagCount.get(tag) || 0}</span>`;
    li.className = state.selectedTags.has(tag) ? "" : "muted";
    li.onclick = () => {
      if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
      else state.selectedTags.add(tag);
      renderSidebar();
      renderFilters();
      renderSongs();
    };
    li.oncontextmenu = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      openEmoteActionsMenu(tag, ev.clientX, ev.clientY);
    };
    emoteList.appendChild(li);
  });
}

async function addNewEmote(rawTag) {
  const tag = normalizeTag(rawTag);
  if (!tag) return false;
  const exists = [...state.tagSet].some((t) => canonicalTag(t) === canonicalTag(tag));
  if (exists) return false;

  if (!localMode) {
    try {
      const resp = await fetch("/api/emotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tag }),
      });
      if (!resp.ok) return false;
    } catch (err) {
      console.error(err);
      return false;
    }
  } else {
    if (!localState.emotes.includes(tag)) localState.emotes.push(tag);
    persistLocalState();
  }

  state.tagSet.add(tag);
  renderSidebar();
  return true;
}

async function deleteEmote(tag) {
  if (!localMode) {
    try {
      const resp = await fetch("/api/emotes/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tag }),
      });
      if (!resp.ok) return false;
    } catch (err) {
      console.error(err);
      return false;
    }
  } else {
    localState.emotes = localState.emotes.filter((e) => canonicalTag(e) !== canonicalTag(tag));
    Object.keys(localState.songTags).forEach((id) => {
      localState.songTags[id] = (localState.songTags[id] || []).filter((t) => canonicalTag(t) !== canonicalTag(tag));
    });
    persistLocalState();
  }

  state.tagSet = new Set([...state.tagSet].filter((t) => canonicalTag(t) !== canonicalTag(tag)));
  state.songs.forEach((song) => {
    song.tags = song.tags.filter((t) => canonicalTag(t) !== canonicalTag(tag));
  });
  state.selectedTags = new Set([...state.selectedTags].filter((t) => canonicalTag(t) !== canonicalTag(tag)));
  renderSidebar();
  renderFilters();
  renderSongs();
  return true;
}

async function renameEmote(oldName, newName) {
  if (localMode) {
    localState.emotes = localState.emotes.map((e) => (canonicalTag(e) === canonicalTag(oldName) ? newName : e));
    Object.keys(localState.songTags).forEach((id) => {
      localState.songTags[id] = (localState.songTags[id] || []).map((t) => (canonicalTag(t) === canonicalTag(oldName) ? newName : t));
    });
    persistLocalState();
    return;
  }
  const resp = await fetch("/api/emotes/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oldName, newName }),
  });
  if (!resp.ok) {
    const msg = await resp.json().catch(() => ({}));
    throw new Error(msg.error || "Emote rename failed");
  }
}

function renderFilters() {
  selectedFilters.innerHTML = "";
  [...state.selectedCategories, ...state.selectedTags].forEach((item) => {
    const span = document.createElement("span");
    const isCategory = state.selectedCategories.has(item);
    span.className = `pill active ${isCategory ? "category-pill" : "emote-pill"}`;
    span.textContent = `${item} ×`;
    span.onclick = () => {
      state.selectedCategories.delete(item);
      state.selectedTags.delete(item);
      renderSidebar();
      renderFilters();
      renderSongs();
    };
    selectedFilters.appendChild(span);
  });
}

function songMatches(song) {
  const byCategory = state.selectedCategories.size === 0 || state.selectedCategories.has(song.category);
  const byTags = state.selectedTags.size === 0 || [...state.selectedTags].every((t) => song.tags.includes(t));
  const bySearch = !state.search || song.title.toLowerCase().includes(state.search);
  return byCategory && byTags && bySearch;
}

function getSortedVisibleSongs() {
  const songs = state.songs.filter(songMatches);
  if (state.sortMode === "name") return [...songs].sort((a, b) => a.title.localeCompare(b.title));
  if (state.sortMode === "rating") return [...songs].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  return songs;
}

function makeDragHandlers(card, thumbRef) {
  card.draggable = true;
  card.ondragstart = (ev) => {
    draggingSongId = card.dataset.id;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData("text/plain", card.dataset.id);
    const rect = thumbRef.getBoundingClientRect();
    const bg = window.getComputedStyle(thumbRef).backgroundImage;
    dragGhostEl = document.createElement("div");
    dragGhostEl.classList.add("drag-ghost");
    dragGhostEl.style.width = `${rect.width * 0.5}px`;
    dragGhostEl.style.height = `${rect.height * 0.5}px`;
    dragGhostEl.style.backgroundImage = bg;
    document.body.appendChild(dragGhostEl);
    ev.dataTransfer.setDragImage(dragGhostEl, rect.width * 0.25, rect.height * 0.25);
  };
  card.ondragend = () => {
    draggingSongId = null;
    document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    if (dragGhostEl) { dragGhostEl.remove(); dragGhostEl = null; }
  };
}

function renderGridCard(song) {
  const card = document.createElement("article");
  card.className = "song-card";
  card.dataset.id = song.id;

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (song.coverUrl) thumb.style.backgroundImage = `url('${song.coverUrl}')`;
  thumb.onclick = () => handleSongPrimaryAction(song.id);
  card.oncontextmenu = (ev) => { ev.preventDefault(); openTagMenu(song, ev.clientX, ev.clientY); };

  const progress = document.createElement("div");
  progress.className = "progress";
  const bar = document.createElement("div");
  progress.appendChild(bar);
  progress.onclick = (ev) => { ev.stopPropagation(); seekByProgressClick(song.id, progress, ev.clientX); };

  const duration = document.createElement("div");
  duration.className = "song-duration";
  duration.textContent = durationCache.get(song.id) || "--:--";

  const title = document.createElement("div");
  title.className = "song-title";
  title.textContent = song.title;


  thumb.appendChild(progress);
  thumb.appendChild(duration);
  card.appendChild(thumb);
  card.appendChild(title);
  makeDragHandlers(card, thumb);
  songGrid.appendChild(card);
  ensureSongDuration(song);
  _coverObserver.observe(card);
}

function renderListRow(song) {
  const card = document.createElement("article");
  card.className = "song-card";
  card.dataset.id = song.id;
  card.oncontextmenu = (ev) => { ev.preventDefault(); openTagMenu(song, ev.clientX, ev.clientY); };

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (song.coverUrl) thumb.style.backgroundImage = `url('${song.coverUrl}')`;
  thumb.onclick = () => handleSongPrimaryAction(song.id);

  const info = document.createElement("div");
  info.className = "list-info";
  const titleEl = document.createElement("div");
  titleEl.className = "list-title";
  titleEl.textContent = song.title;
  titleEl.style.cursor = "pointer";
  titleEl.onclick = () => handleSongPrimaryAction(song.id);
  info.appendChild(titleEl);

  const catEl = document.createElement("div");
  catEl.className = "list-cat";
  catEl.textContent = song.category;

  const tagsEl = document.createElement("div");
  tagsEl.className = "list-tags-col";
  tagsEl.textContent = song.tags.join(", ");

  const progressWrap = document.createElement("div");
  progressWrap.className = "list-progress-wrap";
  const progressBar = document.createElement("div");
  progressBar.className = "list-progress-bar";
  progressWrap.appendChild(progressBar);
  progressWrap.onclick = (ev) => { ev.stopPropagation(); seekByProgressClick(song.id, progressWrap, ev.clientX); };

  const playBtn = document.createElement("button");
  playBtn.className = "list-play-btn";
  playBtn.type = "button";
  playBtn.onclick = () => handleSongPrimaryAction(song.id);
  const playIcon = document.createElement("span");
  playIcon.className = "list-play-icon";
  playBtn.appendChild(playIcon);

  card.appendChild(thumb);
  card.appendChild(info);
  card.appendChild(catEl);
  card.appendChild(tagsEl);
  card.appendChild(progressWrap);
  card.appendChild(playBtn);
  makeDragHandlers(card, thumb);
  songGrid.appendChild(card);
}

function _renderPage() {
  const batch = visibleSongs.slice(renderedCount, renderedCount + PAGE_SIZE);
  if (state.viewMode === "list") {
    batch.forEach(renderListRow);
  } else {
    batch.forEach(renderGridCard);
  }
  renderedCount += batch.length;

  if (_scrollSentinel) _scrollSentinel.remove();
  if (renderedCount < visibleSongs.length) {
    _scrollSentinel = document.createElement("div");
    _scrollSentinel.className = "scroll-sentinel";
    songGrid.appendChild(_scrollSentinel);
    if (!_scrollObserver) {
      _scrollObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) _renderPage();
      }, { rootMargin: "200px" });
    }
    _scrollObserver.observe(_scrollSentinel);
  } else {
    if (_scrollObserver) { _scrollObserver.disconnect(); _scrollObserver = null; }
  }
  syncPlayingCard();
}

function renderSongs() {
  if (_scrollObserver) { _scrollObserver.disconnect(); _scrollObserver = null; }
  songGrid.innerHTML = "";
  renderedCount = 0;
  visibleSongs = getSortedVisibleSongs();
  songGrid.classList.toggle("list-view", state.viewMode === "list");
  _renderPage();
}

function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "--:--";
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function ensureSongDuration(song) {
  if (durationCache.has(song.id)) return;
  const probe = document.createElement("audio");
  probe.preload = "metadata";
  probe.src = resolveAudioUrl(song.audioUrl);
  probe.addEventListener("loadedmetadata", () => {
    durationCache.set(song.id, formatDuration(probe.duration));
    const card = document.querySelector(`.song-card[data-id="${song.id}"]`);
    const durationEl = card?.querySelector(".song-duration");
    if (durationEl) durationEl.textContent = durationCache.get(song.id);
    probe.src = "";
  }, { once: true });
}

function syncPlayingCard() {
  document.querySelectorAll(".song-card").forEach((el) => {
    const isCurrent = el.dataset.id === state.currentSongId;
    el.classList.toggle("current", isCurrent);
    el.classList.toggle("playing", isCurrent && !audio.paused);
  });
  syncBottomPlayer();
}

function syncBottomPlayer() {
  const song = state.songs.find((s) => s.id === state.currentSongId);
  if (!song) {
    bottomPlayer.classList.add("hidden");
    return;
  }

  const wasHidden = bottomPlayer.classList.contains("hidden");
  bottomPlayer.classList.remove("hidden");
  if (wasHidden && !bottomPlayerHasAnimatedIn) {
    bottomPlayer.classList.add("entering");
    bottomPlayerHasAnimatedIn = true;
    window.setTimeout(() => bottomPlayer.classList.remove("entering"), 380);
  }
  playerTitle.textContent = song.title;
  playerSubtitle.textContent = `${song.category}${song.tags.length ? `  ${song.tags.join(", ")}` : ""}`;
  const cover = coverCache.get(song.id) || song.coverUrl || null;
  playerCover.style.backgroundImage = cover ? `url('${cover}')` : "";
  playerToggleIcon.className = `ui-icon ${audio.paused ? "icon-play" : "icon-stop"}`;
  playerCurrentTime.textContent = formatDuration(audio.currentTime || 0);
  playerTotalTime.textContent = formatDuration(audio.duration || 0);

  if (audio.duration && Number.isFinite(audio.duration)) {
    playerSeekBar.style.width = `${(audio.currentTime / audio.duration) * 100}%`;
  } else {
    playerSeekBar.style.width = "0%";
  }
  const effectiveVolume = audio.muted ? 0 : audio.volume;
  playerVolumeBar.style.width = `${Math.max(0, Math.min(1, effectiveVolume)) * 100}%`;
  playerVolumeToggle.classList.toggle("muted", audio.muted);
}

function resolveAudioUrl(relUrl) {
  if (!isNative) return relUrl;
  const basePath = (localStorage.getItem("settings-mp3-path") || "/sdcard/BudburryPlaylist").replace(/\/+$/, "");
  const encoded = relUrl.split("/").map(encodeURIComponent).join("/");
  if (window.Capacitor?.convertFileSrc) {
    return window.Capacitor.convertFileSrc(`${basePath}/${relUrl}`);
  }
  return `https://localhost/_capacitor_file_${basePath}/${encoded}`;
}

function handleSongPrimaryAction(songId) {
  if (state.currentSongId === songId) {
    if (!audio.paused) {
      audio.pause();
      syncPlayingCard();
      return;
    }
    audio.play();
    syncPlayingCard();
    return;
  }
  playSong(songId);
}

function playSong(songId, onReady) {
  const song = state.songs.find((x) => x.id === songId);
  if (!song) return;
  state.currentSongId = songId;
  if (typeof onReady === "function") {
    audio.addEventListener("loadedmetadata", onReady, { once: true });
  }
  audio.src = resolveAudioUrl(song.audioUrl);
  audio.play();
  syncPlayingCard();
}

function seekByProgressClick(songId, progressEl, clientX) {
  if (state.currentSongId !== songId) return;
  const rect = progressEl.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  let duration = audio.duration;
  if (!duration || Number.isNaN(duration) || !Number.isFinite(duration)) {
    if (audio.seekable && audio.seekable.length > 0) {
      duration = audio.seekable.end(audio.seekable.length - 1);
    }
  }
  if (!duration || Number.isNaN(duration) || !Number.isFinite(duration)) return;
  audio.currentTime = ratio * duration;
}

function nextSong() {
  if (!visibleSongs.length) return;
  const idx = visibleSongs.findIndex((s) => s.id === state.currentSongId);
  const next = idx >= 0 ? visibleSongs[(idx + 1) % visibleSongs.length] : visibleSongs[0];
  playSong(next.id);
}

audio.addEventListener("ended", nextSong);
audio.addEventListener("play", syncPlayingCard);
audio.addEventListener("pause", syncPlayingCard);
audio.addEventListener("timeupdate", () => {
  const card = document.querySelector(`.song-card[data-id="${state.currentSongId}"]`);
  if (!card || !audio.duration) return;
  const pct = `${(audio.currentTime / audio.duration) * 100}%`;
  const bar = card.querySelector(".progress > div") ?? card.querySelector(".list-progress-bar");
  if (bar) bar.style.width = pct;
  syncBottomPlayer();
});
audio.addEventListener("loadedmetadata", syncBottomPlayer);

searchInput.addEventListener("input", (e) => {
  state.search = e.target.value.trim().toLowerCase();
  searchClear.hidden = !e.target.value;
  renderSongs();
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  searchClear.hidden = true;
  state.search = "";
  renderSongs();
  searchInput.focus();
});

const btnSortNameMob = document.getElementById("btn-sort-name-mob");
const btnSortStarMob = document.getElementById("btn-sort-star-mob");

function updateViewBtns() {
  btnViewGrid.classList.toggle("active", state.viewMode === "grid");
  btnViewList.classList.toggle("active", state.viewMode === "list");
  btnSortName.classList.toggle("active", state.sortMode === "name");
  btnSortStar.classList.toggle("active", state.sortMode === "rating");
  if (btnSortNameMob) btnSortNameMob.classList.toggle("active", state.sortMode === "name");
  if (btnSortStarMob) btnSortStarMob.classList.toggle("active", state.sortMode === "rating");
}

if (btnSortNameMob) btnSortNameMob.addEventListener("click", () => { state.sortMode = state.sortMode === "name" ? "default" : "name"; updateViewBtns(); renderSongs(); });
if (btnSortStarMob) btnSortStarMob.addEventListener("click", () => { state.sortMode = state.sortMode === "rating" ? "default" : "rating"; updateViewBtns(); renderSongs(); });

btnViewGrid.addEventListener("click", () => {
  state.viewMode = "grid";
  updateViewBtns();
  renderSongs();
});
btnViewList.addEventListener("click", () => {
  state.viewMode = "list";
  updateViewBtns();
  renderSongs();
});
btnSortName.addEventListener("click", () => {
  state.sortMode = state.sortMode === "name" ? "default" : "name";
  updateViewBtns();
  renderSongs();
});
btnSortStar.addEventListener("click", () => {
  state.sortMode = state.sortMode === "rating" ? "default" : "rating";
  updateViewBtns();
  renderSongs();
});

function openTagMenu(song, x, y) {
  const existingTags = new Set(song.tags);
  const allTags = [...state.tagSet].sort();
  tagMenu.innerHTML = "";
  tagMenu.classList.add("tag-menu-tags");

  let currentRating = song.rating || 0;

  const categoryRow = document.createElement("div");
  categoryRow.className = "tag-row tag-category-row";

  const categoryName = document.createElement("span");
  categoryName.textContent = song.category;

  const starsWrap = document.createElement("div");
  starsWrap.className = "tag-rating-row";

  const renderStars = () => {
    starsWrap.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("span");
      star.className = "tag-star" + (i <= currentRating ? " active" : "");
      star.dataset.value = i;
      star.onmouseenter = () => {
        starsWrap.querySelectorAll(".tag-star").forEach((s) => {
          s.classList.toggle("hover", Number(s.dataset.value) <= i);
        });
      };
      star.onmouseleave = () => {
        starsWrap.querySelectorAll(".tag-star").forEach((s) => s.classList.remove("hover"));
      };
      star.onclick = async (ev) => {
        ev.stopPropagation();
        const newRating = currentRating === i ? 0 : i;
        currentRating = newRating;
        song.rating = newRating;
        if (!localMode) {
          await fetch("/api/ratings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: song.id, rating: newRating }),
          });
        } else {
          localState.songRatings = localState.songRatings || {};
          localState.songRatings[song.id] = newRating;
          persistLocalState();
        }
        renderStars();
        renderSongs();
      };
      starsWrap.appendChild(star);
    }
  };
  renderStars();

  categoryRow.appendChild(categoryName);
  categoryRow.appendChild(starsWrap);
  tagMenu.appendChild(categoryRow);

  const tagList = document.createElement("div");
  tagList.className = "tag-menu-list";

  allTags.forEach((tag) => {
    const row = document.createElement("label");
    row.className = "tag-row";
    row.innerHTML = `<span>${tag}</span>`;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "tag-checkbox-input";
    input.checked = existingTags.has(tag);
    input.onchange = async () => {
      if (input.checked) existingTags.add(tag);
      else existingTags.delete(tag);

      if (!localMode) {
        await fetch("/api/tags", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: song.id, tags: [...existingTags] }),
        });
      } else {
        localState.songTags[song.id] = [...existingTags];
        persistLocalState();
      }

      song.tags = [...existingTags];
      song.tags.forEach((t) => state.tagSet.add(normalizeTag(t)));
      renderSidebar();
      renderFilters();
      renderSongs();
    };

    const checkboxUi = document.createElement("span");
    checkboxUi.className = "tag-checkbox-ui";

    row.appendChild(input);
    row.appendChild(checkboxUi);
    tagList.appendChild(row);
  });
  tagMenu.appendChild(tagList);

  tagMenu.classList.remove("hidden");

  // Position menu after it has real dimensions, then keep it inside viewport.
  const margin = 8;
  const menuRect = tagMenu.getBoundingClientRect();
  const playerRect = bottomPlayer && !bottomPlayer.classList.contains("hidden")
    ? bottomPlayer.getBoundingClientRect()
    : null;
  const bottomSafe = playerRect ? (window.innerHeight - playerRect.top) + margin : margin;
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - bottomSafe);
  const left = Math.min(Math.max(margin, x), maxLeft);
  const top = Math.min(Math.max(margin, y), maxTop);

  tagMenu.style.left = `${left}px`;
  tagMenu.style.top = `${top}px`;
}

function openEmoteActionsMenu(tag, x, y) {
  tagMenu.innerHTML = "";
  tagMenu.classList.remove("tag-menu-tags");

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "tag-action-btn";
  renameBtn.textContent = "Premenovat";
  renameBtn.onclick = async (ev) => {
    ev.stopPropagation();
    tagMenu.classList.add("hidden");
    const nextName = await showPrompt("Novy nazov emote:", tag);
    if (!nextName || nextName.trim() === tag) return;
    try {
      await renameEmote(tag, nextName.trim());
      if (state.selectedTags.has(tag)) {
        state.selectedTags.delete(tag);
        state.selectedTags.add(nextName.trim());
      }
      await loadData();
    } catch (err) {
      await showAlert(err.message || "Rename failed");
    }
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "tag-action-btn";
  deleteBtn.textContent = "Vymazat";
  deleteBtn.onclick = async (ev) => {
    ev.stopPropagation();
    tagMenu.classList.add("hidden");
    const ok = await showConfirm(`Vymazat emote "${tag}"?`);
    if (!ok) return;
    await deleteEmote(tag);
  };

  tagMenu.appendChild(renameBtn);
  tagMenu.appendChild(deleteBtn);
  tagMenu.classList.remove("hidden");

  const margin = 8;
  const menuRect = tagMenu.getBoundingClientRect();
  const playerRect = bottomPlayer && !bottomPlayer.classList.contains("hidden")
    ? bottomPlayer.getBoundingClientRect()
    : null;
  const bottomSafe = playerRect ? (window.innerHeight - playerRect.top) + margin : margin;
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - bottomSafe);
  const left = Math.min(Math.max(margin, x), maxLeft);
  const top = Math.min(Math.max(margin, y), maxTop);
  tagMenu.style.left = `${left}px`;
  tagMenu.style.top = `${top}px`;
}

function openCategoryActionsMenu(category, x, y) {
  tagMenu.innerHTML = "";
  tagMenu.classList.remove("tag-menu-tags");

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "tag-action-btn";
  renameBtn.textContent = "Premenovat";
  renameBtn.onclick = async (ev) => {
    ev.stopPropagation();
    tagMenu.classList.add("hidden");
    const nextName = await showPrompt("Novy nazov kategorie:", category);
    if (!nextName || nextName.trim() === category) return;
    try {
      await renameCategory(category, nextName.trim());
      if (state.selectedCategories.has(category)) {
        state.selectedCategories.delete(category);
        state.selectedCategories.add(nextName.trim());
      }
      await loadData();
    } catch (err) {
      await showAlert(err.message || "Rename failed");
    }
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "tag-action-btn";
  deleteBtn.textContent = "Vymazat";
  deleteBtn.onclick = async (ev) => {
    ev.stopPropagation();
    tagMenu.classList.add("hidden");
    const ok = await showConfirm(`Vymazat kategoriu "${category}"?`);
    if (!ok) return;
    try {
      await deleteCategory(category);
      state.selectedCategories.delete(category);
      await loadData();
    } catch (err) {
      await showAlert(err.message || "Delete failed");
    }
  };

  tagMenu.appendChild(renameBtn);
  tagMenu.appendChild(deleteBtn);
  tagMenu.classList.remove("hidden");

  const margin = 8;
  const menuRect = tagMenu.getBoundingClientRect();
  const playerRect = bottomPlayer && !bottomPlayer.classList.contains("hidden")
    ? bottomPlayer.getBoundingClientRect()
    : null;
  const bottomSafe = playerRect ? (window.innerHeight - playerRect.top) + margin : margin;
  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - bottomSafe);
  const left = Math.min(Math.max(margin, x), maxLeft);
  const top = Math.min(Math.max(margin, y), maxTop);
  tagMenu.style.left = `${left}px`;
  tagMenu.style.top = `${top}px`;
}

document.addEventListener("click", (ev) => {
  if (!tagMenu.contains(ev.target)) {
    tagMenu.classList.add("hidden");
  }
});

emoteAddBtn.addEventListener("click", (ev) => {
  ev.stopPropagation();
  const panel = emoteList.closest(".panel");
  if (panel.classList.contains("collapsed")) panel.classList.remove("collapsed");
  newEmoteInput.classList.toggle("hidden");
  if (!newEmoteInput.classList.contains("hidden")) {
    newEmoteInput.value = "";
    newEmoteInput.focus();
  }
});

categoryAddBtn.addEventListener("click", (ev) => {
  ev.stopPropagation();
  const panel = categoryList.closest(".panel");
  if (panel.classList.contains("collapsed")) panel.classList.remove("collapsed");
  newCategoryInput.classList.toggle("hidden");
  if (!newCategoryInput.classList.contains("hidden")) {
    newCategoryInput.value = "";
    newCategoryInput.focus();
  }
});

document.querySelector("#category-list").closest(".panel").querySelector("h2").addEventListener("click", () => {
  const panel = categoryList.closest(".panel");
  panel.classList.toggle("collapsed");
});

document.querySelector("#emote-list").closest(".panel").querySelector("h2").addEventListener("click", () => {
  const panel = emoteList.closest(".panel");
  panel.classList.toggle("collapsed");
});

newEmoteInput.addEventListener("keydown", async (ev) => {
  if (ev.key === "Escape") {
    ev.preventDefault();
    newEmoteInput.value = "";
    newEmoteInput.classList.add("hidden");
    return;
  }
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  const added = await addNewEmote(newEmoteInput.value);
  if (added) {
    newEmoteInput.value = "";
    newEmoteInput.classList.add("hidden");
  }
});

newCategoryInput.addEventListener("keydown", async (ev) => {
  if (ev.key === "Escape") {
    ev.preventDefault();
    newCategoryInput.value = "";
    newCategoryInput.classList.add("hidden");
    return;
  }
  if (ev.key !== "Enter") return;
  ev.preventDefault();
  const name = newCategoryInput.value.trim();
  if (!name) return;
  try {
    await createCategory(name);
    newCategoryInput.value = "";
    newCategoryInput.classList.add("hidden");
    await loadData();
  } catch (err) {
    await showAlert(err.message || "Create failed");
  }
});

themeToggle.addEventListener("click", () => {
  const next = document.body.classList.contains("dark") ? "light" : "dark";
  applyTheme(next);
  localStorage.setItem("theme-mode", next);
});

async function openSettings() {
  if (!localMode) {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      settingsMp3Path.value = data.mp3_path || "";
    } catch (_) {
      settingsMp3Path.value = localStorage.getItem("settings-mp3-path") || "";
    }
  } else {
    settingsMp3Path.value = localStorage.getItem("settings-mp3-path") || "";
  }
  settingsOverlay.classList.remove("hidden");
  settingsMp3Path.focus();
}

async function saveSettings() {
  const newPath = settingsMp3Path.value.trim();
  if (!newPath) return;
  localStorage.setItem("settings-mp3-path", newPath);
  if (!localMode) {
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mp3_path: newPath }),
      });
    } catch (_) {}
  }
  settingsOverlay.classList.add("hidden");
  loadData();
}

settingsToggle.addEventListener("click", openSettings);
settingsSave.addEventListener("click", saveSettings);
settingsCancel.addEventListener("click", () => settingsOverlay.classList.add("hidden"));
settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) settingsOverlay.classList.add("hidden"); });
settingsMp3Path.addEventListener("keydown", (e) => { if (e.key === "Enter") saveSettings(); if (e.key === "Escape") settingsOverlay.classList.add("hidden"); });

// Download (desktop only)
if (!isNative && downloadToggle) {
  let _downloadPollId = null;
  let _downloadMode = false;

  downloadToggle.addEventListener("click", () => {
    _downloadMode = !_downloadMode;
    const downloadToggleIcon = document.getElementById("download-toggle-icon");
    if (_downloadMode) {
      downloadWrap.classList.remove("hidden");
      searchWrap.classList.add("hidden");
      downloadToggleIcon.setAttribute("class", "ui-icon icon-sound");
      downloadInput.focus();
    } else {
      downloadWrap.classList.add("hidden");
      searchWrap.classList.remove("hidden");
      downloadToggleIcon.setAttribute("class", "ui-icon icon-download");
    }
  });

  downloadBtn.addEventListener("click", startDownload);
  downloadInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startDownload(); });

  async function startDownload() {
    const url = downloadInput.value.trim();
    if (!url) return;
    downloadProgressWrap.classList.remove("hidden");
    downloadProgressBar.style.width = "0%";
    downloadBtn.disabled = true;
    downloadInput.disabled = true;
    try {
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!data.ok) { showAlert(data.error || "Download failed"); resetDownloadUI(); return; }
      pollDownload(data.id);
    } catch (e) {
      showAlert("Download failed: " + e.message);
      resetDownloadUI();
    }
  }

  function pollDownload(taskId) {
    _downloadPollId = setInterval(async () => {
      try {
        const res = await fetch(`/api/download/status?id=${taskId}`);
        const data = await res.json();
        const pct = Math.round((data.progress || 0) * 100);
        downloadProgressBar.style.width = pct + "%";
        if (data.status === "done") {
          clearInterval(_downloadPollId);
          downloadProgressWrap.classList.add("hidden");
          downloadProgressBar.style.width = "0%";
          downloadBtn.disabled = false;
          downloadInput.disabled = false;
          downloadInput.value = "";
          downloadStatus.classList.remove("hidden");
          await loadData();
          setTimeout(() => { downloadStatus.classList.add("hidden"); }, 3000);
        } else if (data.status === "error") {
          clearInterval(_downloadPollId);
          showAlert("Download error: " + (data.error || "unknown"));
          downloadProgressWrap.classList.add("hidden");
          downloadProgressBar.style.width = "0%";
          downloadBtn.disabled = false;
          downloadInput.disabled = false;
          downloadInput.value = "";
        }
      } catch (_) {}
    }, 500);
  }

  function resetDownloadUI() {
    downloadBtn.disabled = false;
    downloadInput.disabled = false;
    downloadInput.value = "";
    downloadProgressBar.style.width = "0%";
  }
} else if (isNative && downloadToggle) {
  downloadToggle.classList.add("hidden");
}

// Folder browser
const folderBrowserOverlay = document.getElementById("folder-browser-overlay");
const folderBrowserPathEl = document.getElementById("folder-browser-path");
const folderBrowserList = document.getElementById("folder-browser-list");
const folderBrowserBack = document.getElementById("folder-browser-back");
const folderBrowserSelect = document.getElementById("folder-browser-select");
const settingsBrowse = document.getElementById("settings-browse");

let _fbCurrentPath = "/storage/emulated/0";
let _fbHistory = [];

async function _fbBrowseTo(path) {
  _fbCurrentPath = path;
  folderBrowserPathEl.textContent = path;
  folderBrowserList.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted)">Loading…</div>';
  try {
    const { Filesystem } = window.Capacitor?.Plugins || {};
    if (!Filesystem) throw new Error("Filesystem plugin not available");
    const { files } = await Filesystem.readdir({ path });
    const dirs = files.filter(f => f.type === "directory").sort((a, b) => a.name.localeCompare(b.name));
    if (dirs.length === 0) {
      folderBrowserList.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--muted)">No subfolders</div>';
      return;
    }
    folderBrowserList.innerHTML = "";
    dirs.forEach(dir => {
      const item = document.createElement("div");
      item.className = "folder-browser-item";
      item.textContent = dir.name;
      item.addEventListener("click", () => {
        _fbHistory.push(_fbCurrentPath);
        _fbBrowseTo(path.replace(/\/+$/, "") + "/" + dir.name);
      });
      folderBrowserList.appendChild(item);
    });
  } catch (e) {
    folderBrowserList.innerHTML = `<div style="padding:16px;font-size:12px;color:var(--muted)">Cannot read folder: ${e.message || "Permission denied"}</div>`;
  }
}

if (isNative && settingsBrowse) settingsBrowse.addEventListener("click", () => {
  _fbHistory = [];
  const start = localStorage.getItem("settings-mp3-path") || "/storage/emulated/0";
  _fbBrowseTo(start);
  settingsOverlay.classList.add("hidden");
  folderBrowserOverlay.classList.remove("hidden");
});
if (!isNative && settingsBrowse) settingsBrowse.classList.add("hidden");


folderBrowserSelect.addEventListener("click", () => {
  settingsMp3Path.value = _fbCurrentPath;
  folderBrowserOverlay.classList.add("hidden");
  saveSettings();
});

folderBrowserOverlay.addEventListener("click", (e) => {
  if (e.target === folderBrowserOverlay) {
    folderBrowserOverlay.classList.add("hidden");
    settingsOverlay.classList.remove("hidden");
  }
});

folderBrowserBack.addEventListener("click", () => {
  if (_fbHistory.length > 0) {
    _fbBrowseTo(_fbHistory.pop());
  } else {
    const parent = _fbCurrentPath.replace(/\/[^/]+\/?$/, "");
    if (parent && parent !== _fbCurrentPath) {
      _fbBrowseTo(parent);
    } else {
      folderBrowserOverlay.classList.add("hidden");
      settingsOverlay.classList.remove("hidden");
    }
  }
});

// Android: download code removed

playerToggle.addEventListener("click", () => {
  if (!state.currentSongId) return;
  if (audio.paused) audio.play();
  else audio.pause();
});

playerPrev.addEventListener("click", () => {
  if (!visibleSongs.length) return;
  const idx = visibleSongs.findIndex((s) => s.id === state.currentSongId);
  const prev = idx > 0 ? visibleSongs[idx - 1] : visibleSongs[visibleSongs.length - 1];
  playSong(prev.id);
});

playerNext.addEventListener("click", nextSong);

playerSeek.addEventListener("click", (ev) => {
  if (!audio.duration || !Number.isFinite(audio.duration)) return;
  const rect = playerSeek.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  audio.currentTime = ratio * audio.duration;
});

playerVolume.addEventListener("click", (ev) => {
  const rect = playerVolume.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  audio.muted = false;
  audio.volume = ratio;
  playerVolumeBar.style.width = `${ratio * 100}%`;
  syncBottomPlayer();
});

playerVolumeToggle.addEventListener("click", () => {
  audio.muted = !audio.muted;
  syncBottomPlayer();
});

function loadLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    localState = {
      songTags: parsed.songTags && typeof parsed.songTags === "object" ? parsed.songTags : {},
      songCategories: parsed.songCategories && typeof parsed.songCategories === "object" ? parsed.songCategories : {},
      emotes: Array.isArray(parsed.emotes) ? parsed.emotes : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
    };
  } catch (_err) {
    localState = { songTags: {}, songCategories: {}, emotes: [], categories: [] };
  }
}

function persistLocalState() {
  localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(localState));
}

function applyLocalOverrides(data) {
  const songs = data.songs || [];
  songs.forEach((song) => {
    if (Array.isArray(localState.songTags[song.id])) song.tags = localState.songTags[song.id].slice();
    if (typeof localState.songCategories[song.id] === "string" && localState.songCategories[song.id].trim()) {
      song.category = localState.songCategories[song.id].trim();
    }
  });
  const categories = new Set([...(data.categories || []), ...(localState.categories || []), ...songs.map((s) => s.category)]);
  const tags = new Set([...(data.tags || []), ...(localState.emotes || []), ...songs.flatMap((s) => s.tags || [])]);
  data.categories = [...categories];
  data.tags = [...tags];
}

initTheme();

categoryList.closest(".panel").classList.add("collapsed");
emoteList.closest(".panel").classList.add("collapsed");

// Request storage permission on Android via Filesystem plugin
if (window.Capacitor && window.Capacitor.isNativePlatform()) {
  (async () => {
    try {
      const { Filesystem } = window.Capacitor.Plugins;
      if (Filesystem) await Filesystem.requestPermissions().catch(() => {});
    } catch (_) {}
  })();
}

loadData().then(() => {
  const preloaderBar = document.getElementById("preloader-bar");
  const preloader = document.getElementById("preloader");
  preloaderBar.style.animation = "none";
  preloaderBar.style.width = "100%";
  setTimeout(() => {
    preloader.classList.add("hidden");
    setTimeout(() => {
      preloader.style.display = "none";
    }, 500);
  }, 300);
}).catch((err) => {
  console.error(err);
  songGrid.innerHTML = `<p>Nepodarilo sa nacitat data: ${err.message}</p>`;
  const preloader = document.getElementById("preloader");
  preloader.classList.add("hidden");
});



