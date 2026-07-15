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

const STATUS_LABELS = {
  initializing: "Connecting…",
  qr: "Scan QR code",
  authenticated: "Authenticated",
  ready: "Ready",
  auth_failure: "Auth failed",
  disconnected: "Disconnected",
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
  sendBtn.disabled = true;
  sendBtn.textContent = "Starting…";
  try {
    const res = await fetch("/api/send", { method: "POST" });
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
