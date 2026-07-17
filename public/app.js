const socket = io();

const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");
const qrPlaceholder = document.getElementById("qrPlaceholder");
const qrImage = document.getElementById("qrImage");
const readyBadge = document.getElementById("readyBadge");
const qrWaitText = document.getElementById("qrWaitText");
const qrRefreshBtn = document.getElementById("qrRefreshBtn");
const qrRefreshReady = document.getElementById("qrRefreshReady");
const fileInput = document.getElementById("fileInput");
const dropzone = document.getElementById("dropzone");
const dropLabel = document.getElementById("dropLabel");
const fileNameEl = document.getElementById("fileName");
const rowCountEl = document.getElementById("rowCount");
const sendBtn = document.getElementById("sendBtn");
const progressWrap = document.getElementById("progressWrap");
const progressFill = document.getElementById("progressFill");
const progressText = document.getElementById("progressText");
const logList = document.getElementById("logList");
const clearLogsBtn = document.getElementById("clearLogs");
const fileList = document.getElementById("fileList");
const filesEmpty = document.getElementById("filesEmpty");
const alterMessage = document.getElementById("alterMessage");
const alterBox = document.getElementById("alterBox");
const overrideMessage = document.getElementById("overrideMessage");
const alterMessageFiles = document.getElementById("alterMessageFiles");
const alterBoxFiles = document.getElementById("alterBoxFiles");
const overrideMessageFiles = document.getElementById("overrideMessageFiles");
const alterMedia = document.getElementById("alterMedia");
const alterMediaFiles = document.getElementById("alterMediaFiles");
const alterMediaList = document.getElementById("alterMediaList");
const alterMediaListFiles = document.getElementById("alterMediaListFiles");

const IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const MAX_MEDIA_FILES = 10;

let selectedMediaItems = [];
let mediaIdCounter = 0;

function isAlterEnabled() {
  return alterMessage.checked || alterMessageFiles.checked;
}

function getOverrideText() {
  if (alterMessage.checked) return overrideMessage.value.trim();
  if (alterMessageFiles.checked) return overrideMessageFiles.value.trim();
  return overrideMessage.value.trim() || overrideMessageFiles.value.trim();
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImageMedia(file) {
  return (
    file &&
    (file.type.startsWith("image/") ||
      /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name))
  );
}

function isVideoMedia(file) {
  return (
    file &&
    (file.type.startsWith("video/") ||
      /\.(mp4|mov|avi|mkv|webm|3gp|m4v)$/i.test(file.name))
  );
}

function buildSendBody(extra = {}) {
  const payload = getSendPayload(extra);
  if (!payload.alterMessage && !selectedMediaItems.length) {
    return {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };
  }

  const form = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, String(value));
  });
  selectedMediaItems.forEach((item) => form.append("media", item.file));
  return { body: form };
}

function getSendPayload(extra = {}) {
  const payload = { ...extra };
  if (isAlterEnabled()) {
    payload.alterMessage = true;
    payload.overrideMessage = getOverrideText();
  }
  return payload;
}

function validateOverride() {
  if (!isAlterEnabled()) return true;
  if (!getOverrideText() && !selectedMediaItems.length) {
    alert("Write a message or upload a photo/video before sending");
    const focusEl = alterMessage.checked ? overrideMessage : overrideMessageFiles;
    focusEl.focus();
    return false;
  }
  return true;
}

function clearSelectedMedia() {
  selectedMediaItems.forEach((item) => URL.revokeObjectURL(item.url));
  selectedMediaItems = [];
  alterMedia.value = "";
  alterMediaFiles.value = "";
  renderMediaLists();
}

function removeMediaItem(id) {
  const idx = selectedMediaItems.findIndex((item) => item.id === id);
  if (idx === -1) return;
  URL.revokeObjectURL(selectedMediaItems[idx].url);
  selectedMediaItems.splice(idx, 1);
  renderMediaLists();
}

function createMediaListItem(item) {
  const li = document.createElement("li");
  li.className = "alter-media-item";

  if (item.kind === "video") {
    const video = document.createElement("video");
    video.src = item.url;
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    li.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.file.name;
    li.appendChild(img);
  }

  const meta = document.createElement("div");
  meta.className = "alter-media-meta";

  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = item.file.name;

  const size = document.createElement("span");
  size.className = "muted file-sub";
  size.textContent = `${item.kind === "video" ? "Video" : "Photo"} · ${formatBytes(item.file.size)}`;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn ghost";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => removeMediaItem(item.id));

  meta.append(name, size, removeBtn);
  li.appendChild(meta);
  return li;
}

function renderMediaLists() {
  alterMediaList.innerHTML = "";
  alterMediaListFiles.innerHTML = "";
  selectedMediaItems.forEach((item) => {
    alterMediaList.appendChild(createMediaListItem(item));
    alterMediaListFiles.appendChild(createMediaListItem(item));
  });
}

function addMediaFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const errors = [];
  for (const file of files) {
    if (selectedMediaItems.length >= MAX_MEDIA_FILES) {
      errors.push(`You can attach up to ${MAX_MEDIA_FILES} photos/videos`);
      break;
    }

    const isImage = isImageMedia(file);
    const isVideo = isVideoMedia(file);

    if (!isImage && !isVideo) {
      errors.push(`${file.name}: only photo or video files are allowed`);
      continue;
    }
    if (isVideo && file.size > VIDEO_MAX_BYTES) {
      errors.push(`${file.name}: video must be less than 100 MB`);
      continue;
    }
    if (isImage && file.size > IMAGE_MAX_BYTES) {
      errors.push(`${file.name}: photo must be less than 16 MB`);
      continue;
    }

    selectedMediaItems.push({
      id: ++mediaIdCounter,
      file,
      url: URL.createObjectURL(file),
      kind: isVideo ? "video" : "image",
    });
  }

  renderMediaLists();
  alterMedia.value = "";
  alterMediaFiles.value = "";

  if (errors.length) alert(errors.join("\n"));
}

function syncAlterFrom(source) {
  const enabled = source === "upload" ? alterMessage.checked : alterMessageFiles.checked;
  const text =
    source === "upload" ? overrideMessage.value : overrideMessageFiles.value;

  alterMessage.checked = enabled;
  alterMessageFiles.checked = enabled;
  alterBox.classList.toggle("hidden", !enabled);
  alterBoxFiles.classList.toggle("hidden", !enabled);

  if (source === "upload") {
    overrideMessageFiles.value = text;
  } else {
    overrideMessage.value = text;
  }

  if (!enabled) {
    clearSelectedMedia();
    return;
  }

  const focusEl = source === "upload" ? overrideMessage : overrideMessageFiles;
  focusEl.focus();
}

alterMessage.addEventListener("change", () => syncAlterFrom("upload"));
alterMessageFiles.addEventListener("change", () => syncAlterFrom("files"));
overrideMessage.addEventListener("input", () => {
  overrideMessageFiles.value = overrideMessage.value;
});
overrideMessageFiles.addEventListener("input", () => {
  overrideMessage.value = overrideMessageFiles.value;
});
alterMedia.addEventListener("change", () => {
  addMediaFiles(alterMedia.files);
});
alterMediaFiles.addEventListener("change", () => {
  addMediaFiles(alterMediaFiles.files);
});

const STATUS_LABELS = {
  initializing: "Connecting…",
  qr: "Scan QR code",
  authenticated: "Authenticated",
  ready: "Ready",
  auth_failure: "Auth failed",
  disconnected: "Disconnected",
  error: "WhatsApp error — retrying",
};

function applyState(state) {
  const status = state.status || "initializing";
  statusPill.dataset.status = status;
  statusText.textContent = STATUS_LABELS[status] || status;

  if (state.qrDataUrl) {
    qrImage.src = state.qrDataUrl;
    qrImage.classList.remove("hidden");
    qrPlaceholder.classList.add("hidden");
    readyBadge.classList.add("hidden");
    qrRefreshReady.classList.remove("hidden");
  } else if (state.ready) {
    qrImage.classList.add("hidden");
    qrPlaceholder.classList.add("hidden");
    readyBadge.classList.remove("hidden");
    qrRefreshReady.classList.remove("hidden");
  } else {
    qrImage.classList.add("hidden");
    readyBadge.classList.add("hidden");
    qrPlaceholder.classList.remove("hidden");
    qrRefreshReady.classList.add("hidden");
    if (status === "error" || status === "auth_failure" || status === "disconnected") {
      qrWaitText.textContent = "Connection issue — tap refresh to retry";
    } else {
      qrWaitText.textContent = "Waiting for QR…";
    }
  }

  if (state.fileName) {
    fileNameEl.textContent = state.fileName;
    dropLabel.textContent = "Replace Excel file";
  } else {
    fileNameEl.textContent = "No file selected";
  }

  rowCountEl.textContent = `${state.rowCount || 0} contacts`;

  const canSend = state.ready && state.rowCount > 0 && !state.sending;
  sendBtn.disabled = !canSend;
  sendBtn.textContent = state.sending ? "Sending…" : "Send messages";

  if (state.progress && state.progress.total > 0) {
    progressWrap.classList.remove("hidden");
    const done = state.progress.sent + state.progress.failed;
    const pct = Math.round((done / state.progress.total) * 100);
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${done} / ${state.progress.total}  ·  ${state.progress.sent} sent  ·  ${state.progress.failed} failed`;
  }

  if (Array.isArray(state.logs)) {
    logList.innerHTML = "";
    state.logs.forEach(appendLog);
    logList.scrollTop = logList.scrollHeight;
  }

  if (Array.isArray(state.files)) {
    renderFiles(state.files, state);
  }
}

const SEND_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M4 12l16-7-5 16-3.5-6L4 12z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const DELETE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function renderFiles(files, state) {
  fileList.innerHTML = "";
  filesEmpty.classList.toggle("hidden", files.length > 0);

  const canSend = state.ready && !state.sending;

  files.forEach((file) => {
    const li = document.createElement("li");
    li.className = "file-item";

    const info = document.createElement("div");
    info.className = "file-info";

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.name;

    const meta = document.createElement("span");
    meta.className = "muted file-sub";
    const when = new Date(file.uploadedAt).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    meta.textContent = `${file.rowCount} contacts · ${when}`;

    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "file-actions";

    const sendIconBtn = document.createElement("button");
    sendIconBtn.type = "button";
    sendIconBtn.className = "icon-btn send";
    sendIconBtn.title = "Send messages from this file";
    sendIconBtn.innerHTML = SEND_ICON;
    sendIconBtn.disabled = !canSend;
    sendIconBtn.addEventListener("click", () => sendFromFile(file));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "icon-btn delete";
    deleteBtn.title = "Delete this file";
    deleteBtn.innerHTML = DELETE_ICON;
    deleteBtn.addEventListener("click", () => deleteFile(file));

    actions.append(sendIconBtn, deleteBtn);
    li.append(info, actions);
    fileList.appendChild(li);
  });
}

async function sendFromFile(file) {
  if (!validateOverride()) return;
  if (!confirm(`Send messages to ${file.rowCount} contacts from "${file.name}"?`)) {
    return;
  }
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      ...buildSendBody({ fileId: file.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Send failed");
    progressWrap.classList.remove("hidden");
  } catch (err) {
    alert(err.message);
  }
}

async function deleteFile(file) {
  if (!confirm(`Delete "${file.name}"?`)) return;
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(file.id)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");
  } catch (err) {
    alert(err.message);
  }
}

function appendLog(entry) {
  const li = document.createElement("li");
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = new Date(entry.at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const msg = document.createElement("span");
  msg.className = `msg ${entry.type || "info"}`;
  msg.textContent = entry.message;
  li.append(time, msg);
  logList.appendChild(li);
}

async function uploadFile(file) {
  if (!file) return;
  const form = new FormData();
  form.append("file", file);

  dropLabel.textContent = "Uploading…";
  try {
    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    fileNameEl.textContent = data.fileName;
    rowCountEl.textContent = `${data.rowCount} contacts`;
    dropLabel.textContent = "Replace Excel file";
  } catch (err) {
    dropLabel.textContent = "Upload failed — try again";
    alert(err.message);
  }
}

fileInput.addEventListener("change", () => {
  uploadFile(fileInput.files[0]);
});

["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});

["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});

dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) uploadFile(file);
});

sendBtn.addEventListener("click", async () => {
  if (!validateOverride()) return;
  sendBtn.disabled = true;
  sendBtn.textContent = "Starting…";
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      ...buildSendBody(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Send failed");
    progressWrap.classList.remove("hidden");
  } catch (err) {
    alert(err.message);
    sendBtn.disabled = false;
    sendBtn.textContent = "Send messages";
  }
});

async function restartWhatsApp() {
  qrWaitText.textContent = "Restarting WhatsApp…";
  qrRefreshBtn.disabled = true;
  qrRefreshReady.disabled = true;
  try {
    const res = await fetch("/api/whatsapp/restart", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Restart failed");
  } catch (err) {
    alert(err.message);
  } finally {
    qrRefreshBtn.disabled = false;
    qrRefreshReady.disabled = false;
  }
}

qrRefreshBtn.addEventListener("click", restartWhatsApp);
qrRefreshReady.addEventListener("click", restartWhatsApp);

clearLogsBtn.addEventListener("click", () => {
  logList.innerHTML = "";
});

socket.on("state", applyState);
socket.on("log", (entry) => {
  appendLog(entry);
  logList.scrollTop = logList.scrollHeight;
});

fetch("/api/state")
  .then((r) => r.json())
  .then(applyState)
  .catch(() => {});
