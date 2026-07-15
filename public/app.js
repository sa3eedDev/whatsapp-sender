const socket = io();

const statusPill = document.getElementById("statusPill");
const statusText = document.getElementById("statusText");
const qrPlaceholder = document.getElementById("qrPlaceholder");
const qrImage = document.getElementById("qrImage");
const readyBadge = document.getElementById("readyBadge");
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
const alterImage = document.getElementById("alterImage");
const alterImageFiles = document.getElementById("alterImageFiles");
const alterImagePreview = document.getElementById("alterImagePreview");
const alterImagePreviewFiles = document.getElementById("alterImagePreviewFiles");
const alterImageThumb = document.getElementById("alterImageThumb");
const alterImageThumbFiles = document.getElementById("alterImageThumbFiles");
const alterImageName = document.getElementById("alterImageName");
const alterImageNameFiles = document.getElementById("alterImageNameFiles");
const alterImageClear = document.getElementById("alterImageClear");
const alterImageClearFiles = document.getElementById("alterImageClearFiles");

let selectedImageFile = null;
let selectedImageUrl = null;

function isAlterEnabled() {
  return alterMessage.checked || alterMessageFiles.checked;
}

function getOverrideText() {
  if (alterMessage.checked) return overrideMessage.value.trim();
  if (alterMessageFiles.checked) return overrideMessageFiles.value.trim();
  return overrideMessage.value.trim() || overrideMessageFiles.value.trim();
}

function buildSendBody(extra = {}) {
  const payload = getSendPayload(extra);
  if (!payload.alterMessage && !selectedImageFile) {
    return {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };
  }

  const form = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, String(value));
  });
  if (selectedImageFile) form.append("image", selectedImageFile);
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
  if (!getOverrideText() && !selectedImageFile) {
    alert("Write a message or upload a picture before sending");
    const focusEl = alterMessage.checked ? overrideMessage : overrideMessageFiles;
    focusEl.focus();
    return false;
  }
  return true;
}

function clearSelectedImage() {
  selectedImageFile = null;
  if (selectedImageUrl) {
    URL.revokeObjectURL(selectedImageUrl);
    selectedImageUrl = null;
  }
  alterImage.value = "";
  alterImageFiles.value = "";
  alterImagePreview.classList.add("hidden");
  alterImagePreviewFiles.classList.add("hidden");
  alterImageThumb.removeAttribute("src");
  alterImageThumbFiles.removeAttribute("src");
  alterImageName.textContent = "picture";
  alterImageNameFiles.textContent = "picture";
}

function setSelectedImage(file) {
  if (!file) {
    clearSelectedImage();
    return;
  }
  if (!file.type.startsWith("image/")) {
    alert("Only image files are allowed");
    return;
  }

  selectedImageFile = file;
  if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
  selectedImageUrl = URL.createObjectURL(file);

  alterImageThumb.src = selectedImageUrl;
  alterImageThumbFiles.src = selectedImageUrl;
  alterImageName.textContent = file.name;
  alterImageNameFiles.textContent = file.name;
  alterImagePreview.classList.remove("hidden");
  alterImagePreviewFiles.classList.remove("hidden");
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
    clearSelectedImage();
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
alterImage.addEventListener("change", () => {
  setSelectedImage(alterImage.files[0]);
});
alterImageFiles.addEventListener("change", () => {
  setSelectedImage(alterImageFiles.files[0]);
});
alterImageClear.addEventListener("click", clearSelectedImage);
alterImageClearFiles.addEventListener("click", clearSelectedImage);

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
  } else if (state.ready) {
    qrImage.classList.add("hidden");
    qrPlaceholder.classList.add("hidden");
    readyBadge.classList.remove("hidden");
  } else {
    qrImage.classList.add("hidden");
    readyBadge.classList.add("hidden");
    qrPlaceholder.classList.remove("hidden");
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
