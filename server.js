const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const QRCode = require("qrcode");
const XLSX = require("xlsx");
const { Server } = require("socket.io");
const { Client, LocalAuth } = require("whatsapp-web.js");

const PORT = process.env.PORT || 80;
const UPLOAD_DIR = path.join(__dirname, "uploads");
const UPLOAD_PATH = path.join(UPLOAD_DIR, "contacts.xlsx");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
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
    filename: (_req, _file, cb) => cb(null, "contacts.xlsx"),
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

function emitState() {
  io.emit("state", {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    ready: state.ready,
    sending: state.sending,
    fileName: state.fileName,
    rowCount: state.rows.length,
    progress: state.progress,
    logs: state.logs.slice(-50),
  });
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
    .filter((row) => row.phone && row.message);

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
  res.json({
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    ready: state.ready,
    sending: state.sending,
    fileName: state.fileName,
    rowCount: state.rows.length,
    progress: state.progress,
    logs: state.logs.slice(-50),
  });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const rows = loadExcel(req.file.path, req.file.originalname);
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
    addLog(`Upload failed: ${err.message}`, "error");
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/send", async (_req, res) => {
  if (!state.ready) {
    return res.status(400).json({ error: "WhatsApp is not ready yet" });
  }
  if (state.sending) {
    return res.status(400).json({ error: "Already sending messages" });
  }
  if (!state.rows.length) {
    if (fs.existsSync(UPLOAD_PATH)) {
      loadExcel(UPLOAD_PATH, state.fileName || "contacts.xlsx");
    } else if (fs.existsSync(path.join(__dirname, "whatsapp.xlsx"))) {
      loadExcel(path.join(__dirname, "whatsapp.xlsx"), "whatsapp.xlsx");
    }
  }
  if (!state.rows.length) {
    return res.status(400).json({ error: "Upload an Excel file first" });
  }

  state.sending = true;
  state.progress = { total: state.rows.length, sent: 0, failed: 0 };
  addLog(`Sending ${state.rows.length} messages…`, "info");
  emitState();
  res.json({ ok: true, total: state.rows.length });

  for (const row of state.rows) {
    const chatId = toChatId(row.phone);
    try {
      await client.sendMessage(chatId, row.message);
      state.progress.sent += 1;
      addLog(`Sent to ${row.phone}`, "success");
    } catch (err) {
      state.progress.failed += 1;
      addLog(`Failed ${row.phone}: ${err.message}`, "error");
    }
    emitState();
    await new Promise((r) => setTimeout(r, 3000));
  }

  state.sending = false;
  addLog(
    `Done — ${state.progress.sent} sent, ${state.progress.failed} failed`,
    "info"
  );
  emitState();
});

io.on("connection", (socket) => {
  socket.emit("state", {
    status: state.status,
    qrDataUrl: state.qrDataUrl,
    ready: state.ready,
    sending: state.sending,
    fileName: state.fileName,
    rowCount: state.rows.length,
    progress: state.progress,
    logs: state.logs.slice(-50),
  });
});

if (fs.existsSync(path.join(__dirname, "whatsapp.xlsx"))) {
  try {
    loadExcel(path.join(__dirname, "whatsapp.xlsx"), "whatsapp.xlsx");
  } catch (_) {
    /* ignore preload errors */
  }
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WhatsApp Sender UI → http://localhost:${PORT}`);
  state.status = "initializing";
  emitState();
  initializeClient();
});
