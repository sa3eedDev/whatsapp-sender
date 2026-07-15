const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const QRCode = require("qrcode");
const XLSX = require("xlsx");
const { Server } = require("socket.io");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

const PORT = process.env.PORT || 80;
const UPLOAD_DIR = path.join(__dirname, "uploads");
const MEDIA_DIR = path.join(UPLOAD_DIR, "media");
const MANIFEST_PATH = path.join(UPLOAD_DIR, "files.json");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// Library of previously uploaded Excel files, persisted alongside the
// files themselves so it survives restarts.
let uploadedFiles = [];
try {
  if (fs.existsSync(MANIFEST_PATH)) {
    uploadedFiles = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")).filter(
      (f) => fs.existsSync(path.join(UPLOAD_DIR, f.storedName))
    );
  }
} catch (_) {
  uploadedFiles = [];
}

function saveManifest() {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(uploadedFiles, null, 2));
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".xlsx";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.includes("sheet") ||
      file.mimetype.includes("excel") ||
      /\.xlsx?$/i.test(file.originalname);
    cb(ok ? null : new Error("Only Excel files (.xlsx, .xls) are allowed"), ok);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: MEDIA_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("image/") ||
      /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.originalname);
    cb(ok ? null : new Error("Only image files are allowed"), ok);
  },
  limits: { fileSize: 16 * 1024 * 1024 },
});

function parseSendUpload(req, res, next) {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) {
    return imageUpload.single("image")(req, res, next);
  }
  next();
}

const state = {
  status: "initializing",
  qrDataUrl: null,
  ready: false,
  sending: false,
  fileName: null,
  rows: [],
  progress: { total: 0, sent: 0, failed: 0 },
  logs: [],
};

function snapshot() {
  return {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    ready: state.ready,
    sending: state.sending,
    fileName: state.fileName,
    rowCount: state.rows.length,
    progress: state.progress,
    logs: state.logs.slice(-50),
    files: uploadedFiles.map((f) => ({
      id: f.id,
      name: f.originalName,
      rowCount: f.rowCount,
      uploadedAt: f.uploadedAt,
    })),
  };
}

function emitState() {
  io.emit("state", snapshot());
}

function addLog(message, type = "info") {
  state.logs.push({ message, type, at: new Date().toISOString() });
  if (state.logs.length > 200) state.logs.shift();
  io.emit("log", { message, type, at: new Date().toISOString() });
}

function loadExcel(filePath, originalName) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames.includes("whatsapp")
    ? "whatsapp"
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);

  const rows = data
    .map((row, index) => {
      const phone = String(row["الرقم"] ?? row.phone ?? row.Phone ?? "").trim();
      const message = row["الرساله"] ?? row.message ?? row.Message ?? "";
      return { index, phone, message: String(message) };
    })
    .filter((row) => row.phone);

  state.fileName = originalName || path.basename(filePath);
  state.rows = rows;
  return rows;
}

function toChatId(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("966")) return `${digits}@c.us`;
  if (digits.startsWith("0") && digits.length === 10) {
    return `966${digits.substring(1)}@c.us`;
  }
  return `${digits}@c.us`;
}

const puppeteerOptions = {
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ],
};

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: process.env.WWEBJS_AUTH_PATH || ".wwebjs_auth" }),
  puppeteer: puppeteerOptions,
});

client.on("qr", async (qr) => {
  state.status = "qr";
  state.ready = false;
  state.qrDataUrl = await QRCode.toDataURL(qr, {
    width: 280,
    margin: 2,
    color: { dark: "#0f172a", light: "#ffffff" },
  });
  addLog("Scan the QR code with WhatsApp", "info");
  emitState();
});

client.on("authenticated", () => {
  state.status = "authenticated";
  state.qrDataUrl = null;
  addLog("Authenticated", "success");
  emitState();
});

client.on("ready", () => {
  state.status = "ready";
  state.ready = true;
  state.qrDataUrl = null;
  addLog("WhatsApp is ready", "success");
  emitState();
});

client.on("auth_failure", (msg) => {
  state.status = "auth_failure";
  state.ready = false;
  addLog(`Auth failed: ${msg}`, "error");
  emitState();
});

client.on("disconnected", (reason) => {
  state.status = "disconnected";
  state.ready = false;
  state.qrDataUrl = null;
  addLog(`Disconnected: ${reason}`, "error");
  emitState();
  initializeClient();
});

// Keep the web server alive if WhatsApp/Chromium fails to start
// (an unhandled rejection would otherwise kill the whole process),
// and retry so transient failures recover on their own.
function initializeClient(attempt = 1) {
  client.initialize().catch((err) => {
    state.status = "error";
    state.ready = false;
    addLog(`WhatsApp failed to start (attempt ${attempt}): ${err.message}`, "error");
    emitState();
    const delay = Math.min(attempt * 10_000, 60_000);
    addLog(`Retrying in ${delay / 1000}s…`, "info");
    setTimeout(() => initializeClient(attempt + 1), delay);
  });
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
  addLog(`Unexpected error: ${err.message || err}`, "error");
});

app.get("/api/state", (_req, res) => {
  res.json(snapshot());
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const rows = loadExcel(req.file.path, req.file.originalname);

    uploadedFiles.unshift({
      id: path.parse(req.file.filename).name,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      rowCount: rows.length,
      uploadedAt: new Date().toISOString(),
    });
    saveManifest();

    addLog(
      `Loaded ${rows.length} contacts from ${req.file.originalname}`,
      "success"
    );
    emitState();

    res.json({
      ok: true,
      fileName: state.fileName,
      rowCount: rows.length,
      preview: rows.slice(0, 5),
    });
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    addLog(`Upload failed: ${err.message}`, "error");
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/files/:id", (req, res) => {
  const idx = uploadedFiles.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "File not found" });
  }
  const [file] = uploadedFiles.splice(idx, 1);
  fs.rmSync(path.join(UPLOAD_DIR, file.storedName), { force: true });
  saveManifest();
  addLog(`Deleted ${file.originalName}`, "info");
  emitState();
  res.json({ ok: true });
});

app.post("/api/send", parseSendUpload, async (req, res) => {
  if (!state.ready) {
    return res.status(400).json({ error: "WhatsApp is not ready yet" });
  }
  if (state.sending) {
    return res.status(400).json({ error: "Already sending messages" });
  }

  const body = req.body || {};
  const fileId = body.fileId;
  const alterEnabled =
    body.alterMessage === true ||
    body.alterMessage === "true" ||
    body.alterMessage === "1";
  const overrideMessage =
    typeof body.overrideMessage === "string" ? body.overrideMessage.trim() : "";
  const mediaPath = req.file ? req.file.path : null;

  if (fileId) {
    const file = uploadedFiles.find((f) => f.id === fileId);
    if (!file) {
      if (mediaPath) fs.rmSync(mediaPath, { force: true });
      return res.status(404).json({ error: "File not found" });
    }
    try {
      loadExcel(path.join(UPLOAD_DIR, file.storedName), file.originalName);
    } catch (err) {
      if (mediaPath) fs.rmSync(mediaPath, { force: true });
      return res.status(400).json({ error: `Could not read file: ${err.message}` });
    }
  }

  if (!state.rows.length) {
    if (mediaPath) fs.rmSync(mediaPath, { force: true });
    return res.status(400).json({ error: "Upload an Excel file first" });
  }

  if (alterEnabled && !overrideMessage && !mediaPath) {
    return res
      .status(400)
      .json({ error: "Write a message or upload a picture before sending" });
  }

  let media = null;
  if (mediaPath) {
    try {
      media = MessageMedia.fromFilePath(mediaPath);
    } catch (err) {
      fs.rmSync(mediaPath, { force: true });
      return res.status(400).json({ error: `Could not read image: ${err.message}` });
    }
  }

  state.sending = true;
  state.progress = { total: state.rows.length, sent: 0, failed: 0 };
  const modeLabel = media
    ? overrideMessage
      ? "image + custom message"
      : "image"
    : overrideMessage
      ? "custom message"
      : "Excel messages";
  addLog(`Sending ${modeLabel} to ${state.rows.length} contacts…`, "info");
  emitState();
  res.json({ ok: true, total: state.rows.length });

  try {
    for (const row of state.rows) {
      const chatId = toChatId(row.phone);
      const message = alterEnabled
        ? overrideMessage
        : String(row.message || "").trim();

      if (!media && !message) {
        state.progress.failed += 1;
        addLog(`Failed ${row.phone}: no message`, "error");
        emitState();
        continue;
      }

      try {
        if (media) {
          await client.sendMessage(chatId, media, {
            caption: message || undefined,
          });
        } else {
          await client.sendMessage(chatId, message);
        }
        state.progress.sent += 1;
        addLog(`Sent to ${row.phone}`, "success");
      } catch (err) {
        state.progress.failed += 1;
        addLog(`Failed ${row.phone}: ${err.message}`, "error");
      }
      emitState();
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    if (mediaPath) fs.rmSync(mediaPath, { force: true });
  }

  state.sending = false;
  addLog(
    `Done — ${state.progress.sent} sent, ${state.progress.failed} failed`,
    "info"
  );
  emitState();
});

io.on("connection", (socket) => {
  socket.emit("state", snapshot());
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WhatsApp Sender UI → http://localhost:${PORT}`);
  state.status = "initializing";
  emitState();
  initializeClient();
});
