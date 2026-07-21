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
const {
  clerkMiddleware,
  getAuth,
  authenticateRequest,
  clerkClient,
} = require("@clerk/express");

const PORT = process.env.PORT || 80;
const DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, "data");
const AUTH_ROOT = process.env.WWEBJS_AUTH_PATH || path.join(DATA_ROOT, ".wwebjs_auth");
const QR_TIMEOUT_MS = Number(process.env.QR_TIMEOUT_MS || 45_000);

const IMAGE_MAX_BYTES = 16 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;
const VIDEO_EXT = /\.(mp4|mov|avi|mkv|webm|3gp|m4v)$/i;

const puppeteerOptions = {
  headless: true,
  protocolTimeout: 120_000,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--disable-background-networking",
    "--disable-default-apps",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
  ],
};

if (process.env.PUPPETEER_EXECUTABLE_PATH) {
  puppeteerOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
}

function decodeOriginalName(name) {
  if (!name) return name;
  try {
    const decoded = Buffer.from(name, "latin1").toString("utf8");
    if (!decoded.includes("\uFFFD")) return decoded;
  } catch (_) {
    /* fall through */
  }
  return name;
}

function isImageFile(file) {
  return (
    (file.mimetype && file.mimetype.startsWith("image/")) ||
    IMAGE_EXT.test(file.originalname || "")
  );
}

function isVideoFile(file) {
  return (
    (file.mimetype && file.mimetype.startsWith("video/")) ||
    VIDEO_EXT.test(file.originalname || "")
  );
}

function toChatId(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("966")) return `${digits}@c.us`;
  if (digits.startsWith("0") && digits.length === 10) {
    return `966${digits.substring(1)}@c.us`;
  }
  return `${digits}@c.us`;
}

function loadExcelRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames.includes("whatsapp")
    ? "whatsapp"
    : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(sheet);

  return data
    .map((row, index) => {
      const phone = String(row["الرقم"] ?? row.phone ?? row.Phone ?? "").trim();
      const message = row["الرساله"] ?? row.message ?? row.Message ?? "";
      return { index, phone, message: String(message) };
    })
    .filter((row) => row.phone);
}

function cleanupMediaFiles(files) {
  for (const file of files || []) {
    fs.rmSync(file.path, { force: true });
  }
}

const sessions = new Map();
let io = null;

class UserSession {
  constructor(userId) {
    this.userId = userId;
    this.uploadDir = path.join(DATA_ROOT, "uploads", userId);
    this.mediaDir = path.join(this.uploadDir, "media");
    this.manifestPath = path.join(this.uploadDir, "files.json");
    this.authPath = path.join(AUTH_ROOT, userId);
    this.client = null;
    this.restarting = false;
    this.initAttempt = 0;
    this.qrWatchdog = null;
    this.uploadedFiles = [];
    this.state = {
      status: "initializing",
      qrDataUrl: null,
      ready: false,
      sending: false,
      fileName: null,
      rows: [],
      progress: { total: 0, sent: 0, failed: 0 },
      logs: [],
    };
    fs.mkdirSync(this.uploadDir, { recursive: true });
    fs.mkdirSync(this.mediaDir, { recursive: true });
    fs.mkdirSync(this.authPath, { recursive: true });
    this.loadManifest();
  }

  loadManifest() {
    try {
      if (fs.existsSync(this.manifestPath)) {
        this.uploadedFiles = JSON.parse(fs.readFileSync(this.manifestPath, "utf8"))
          .filter((f) => fs.existsSync(path.join(this.uploadDir, f.storedName)))
          .map((f) => ({ ...f, originalName: decodeOriginalName(f.originalName) }));
      }
    } catch (_) {
      this.uploadedFiles = [];
    }
  }

  saveManifest() {
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.uploadedFiles, null, 2));
  }

  loadExcel(filePath, originalName) {
    const rows = loadExcelRows(filePath);
    this.state.fileName = originalName || path.basename(filePath);
    this.state.rows = rows;
    return rows;
  }

  snapshot() {
    return {
      status: this.state.status,
      qrDataUrl: this.state.qrDataUrl,
      ready: this.state.ready,
      sending: this.state.sending,
      fileName: this.state.fileName,
      rowCount: this.state.rows.length,
      progress: this.state.progress,
      logs: this.state.logs.slice(-50),
      files: this.uploadedFiles.map((f) => ({
        id: f.id,
        name: f.originalName,
        rowCount: f.rowCount,
        uploadedAt: f.uploadedAt,
      })),
    };
  }

  emitState() {
    if (!io) return;
    io.to(this.userId).emit("state", this.snapshot());
  }

  addLog(message, type = "info") {
    this.state.logs.push({ message, type, at: new Date().toISOString() });
    if (this.state.logs.length > 200) this.state.logs.shift();
    if (io) {
      io.to(this.userId).emit("log", {
        message,
        type,
        at: new Date().toISOString(),
      });
    }
  }

  clearChromiumLocks() {
    if (!fs.existsSync(this.authPath)) return;
    const walk = (dir) => {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_) {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (
          entry.name === "SingletonLock" ||
          entry.name === "SingletonCookie" ||
          entry.name === "SingletonSocket"
        ) {
          fs.rmSync(full, { force: true, recursive: true });
          continue;
        }
        if (entry.isDirectory()) walk(full);
      }
    };
    walk(this.authPath);
  }

  clearQrWatchdog() {
    if (this.qrWatchdog) {
      clearTimeout(this.qrWatchdog);
      this.qrWatchdog = null;
    }
  }

  armQrWatchdog() {
    this.clearQrWatchdog();
    this.qrWatchdog = setTimeout(() => {
      if (this.state.ready || this.state.qrDataUrl || this.state.sending) return;
      this.addLog("QR code timed out — restarting WhatsApp…", "error");
      this.restartWhatsApp("timeout");
    }, QR_TIMEOUT_MS);
  }

  bindClientEvents(instance) {
    instance.on("loading_screen", (percent, message) => {
      this.state.status = "initializing";
      this.addLog(`Loading WhatsApp… ${percent}% ${message || ""}`.trim(), "info");
      this.emitState();
    });

    instance.on("qr", async (qr) => {
      this.clearQrWatchdog();
      this.state.status = "qr";
      this.state.ready = false;
      try {
        this.state.qrDataUrl = await QRCode.toDataURL(qr, {
          width: 280,
          margin: 2,
          color: { dark: "#0f172a", light: "#ffffff" },
        });
      } catch (err) {
        this.addLog(`Failed to render QR: ${err.message}`, "error");
        this.state.qrDataUrl = null;
      }
      this.addLog("Scan the QR code with WhatsApp", "info");
      this.emitState();
    });

    instance.on("authenticated", () => {
      this.clearQrWatchdog();
      this.state.status = "authenticated";
      this.state.qrDataUrl = null;
      this.addLog("Authenticated", "success");
      this.emitState();
    });

    instance.on("ready", () => {
      this.clearQrWatchdog();
      this.initAttempt = 0;
      this.state.status = "ready";
      this.state.ready = true;
      this.state.qrDataUrl = null;
      this.addLog("WhatsApp is ready", "success");
      this.emitState();
    });

    instance.on("auth_failure", (msg) => {
      this.clearQrWatchdog();
      this.state.status = "auth_failure";
      this.state.ready = false;
      this.addLog(`Auth failed: ${msg}`, "error");
      this.emitState();
      setTimeout(() => this.restartWhatsApp("auth_failure"), 3_000);
    });

    instance.on("disconnected", (reason) => {
      this.clearQrWatchdog();
      this.state.status = "disconnected";
      this.state.ready = false;
      this.state.qrDataUrl = null;
      this.addLog(`Disconnected: ${reason}`, "error");
      this.emitState();
      setTimeout(() => this.restartWhatsApp("disconnected"), 2_000);
    });
  }

  createClient() {
    const instance = new Client({
      authStrategy: new LocalAuth({ dataPath: this.authPath }),
      puppeteer: puppeteerOptions,
      authTimeoutMs: 60_000,
      qrMaxRetries: 5,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 10_000,
    });
    this.bindClientEvents(instance);
    return instance;
  }

  async restartWhatsApp(reason = "manual") {
    if (this.restarting) return;
    this.restarting = true;
    this.clearQrWatchdog();

    this.state.status = "initializing";
    this.state.ready = false;
    this.state.qrDataUrl = null;
    this.addLog(`Restarting WhatsApp (${reason})…`, "info");
    this.emitState();

    try {
      if (this.client) {
        try {
          await this.client.destroy();
        } catch (_) {
          /* ignore */
        }
        this.client = null;
      }
    } finally {
      this.clearChromiumLocks();
      this.restarting = false;
    }

    this.initializeClient();
  }

  initializeClient() {
    this.initAttempt += 1;
    this.clearChromiumLocks();

    if (!this.client) {
      this.client = this.createClient();
    }

    this.state.status = "initializing";
    this.state.ready = false;
    this.state.qrDataUrl = null;
    this.emitState();
    this.armQrWatchdog();

    this.client.initialize().catch((err) => {
      this.clearQrWatchdog();
      this.state.status = "error";
      this.state.ready = false;
      this.addLog(
        `WhatsApp failed to start (attempt ${this.initAttempt}): ${err.message}`,
        "error"
      );
      this.emitState();

      const delay = Math.min(this.initAttempt * 8_000, 60_000);
      this.addLog(`Retrying in ${Math.round(delay / 1000)}s…`, "info");
      setTimeout(() => {
        this.client = null;
        this.restartWhatsApp("init_error");
      }, delay);
    });
  }
}

function getSession(userId) {
  if (!sessions.has(userId)) {
    const session = new UserSession(userId);
    sessions.set(userId, session);
    session.initializeClient();
  }
  return sessions.get(userId);
}

const app = express();
const server = http.createServer(app);
io = new Server(server, {
  cors: { origin: true, credentials: true },
});

const PUBLIC_DIR = path.join(__dirname, "public");

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(clerkMiddleware());

function requireUser(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.userId = userId;
  req.session = getSession(userId);
  next();
}

app.get("/api/clerk-config", (_req, res) => {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return res.status(500).json({ error: "Clerk is not configured" });
  }
  res.json({ publishableKey });
});

app.get("/app.html", (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) {
    return res.redirect("/sign-in.html?redirect_url=/app.html");
  }
  res.sendFile(path.join(PUBLIC_DIR, "app.html"));
});

app.use(express.static(PUBLIC_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => cb(null, req.session.uploadDir),
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

function parseSendUpload(req, res, next) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    next();
    return;
  }

  const mediaUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, req.session.mediaDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || ".bin";
        cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (isImageFile(file) || isVideoFile(file)) {
        cb(null, true);
        return;
      }
      cb(new Error("Only photo or video files are allowed"));
    },
    limits: { fileSize: VIDEO_MAX_BYTES, files: 10 },
  });

  mediaUpload.array("media", 10)(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Each video must be less than 100 MB"
          : err.code === "LIMIT_FILE_COUNT"
            ? "You can attach up to 10 photos/videos"
            : err.message || "Media upload failed";
      return res.status(400).json({ error: message });
    }

    const files = req.files || [];
    for (const file of files) {
      if (isImageFile(file) && file.size > IMAGE_MAX_BYTES) {
        cleanupMediaFiles(files);
        return res.status(400).json({ error: "Each photo must be less than 16 MB" });
      }
      if (isVideoFile(file) && file.size > VIDEO_MAX_BYTES) {
        cleanupMediaFiles(files);
        return res.status(400).json({ error: "Each video must be less than 100 MB" });
      }
    }
    next();
  });
}

app.get("/api/state", requireUser, (req, res) => {
  res.json(req.session.snapshot());
});

app.post("/api/whatsapp/restart", requireUser, async (req, res) => {
  const session = req.session;
  if (session.state.sending) {
    return res.status(400).json({ error: "Cannot restart while sending messages" });
  }
  res.json({ ok: true });
  session.restartWhatsApp("manual");
});

app.post("/api/upload", requireUser, upload.single("file"), (req, res) => {
  const session = req.session;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const originalName = decodeOriginalName(req.file.originalname);
    const rows = session.loadExcel(req.file.path, originalName);

    session.uploadedFiles.unshift({
      id: path.parse(req.file.filename).name,
      originalName,
      storedName: req.file.filename,
      rowCount: rows.length,
      uploadedAt: new Date().toISOString(),
    });
    session.saveManifest();

    session.addLog(`Loaded ${rows.length} contacts from ${originalName}`, "success");
    session.emitState();

    res.json({
      ok: true,
      fileName: session.state.fileName,
      rowCount: rows.length,
      preview: rows.slice(0, 5),
    });
  } catch (err) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    session.addLog(`Upload failed: ${err.message}`, "error");
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/files/:id", requireUser, (req, res) => {
  const session = req.session;
  const idx = session.uploadedFiles.findIndex((f) => f.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "File not found" });
  }
  const [file] = session.uploadedFiles.splice(idx, 1);
  fs.rmSync(path.join(session.uploadDir, file.storedName), { force: true });
  session.saveManifest();
  session.addLog(`Deleted ${file.originalName}`, "info");
  session.emitState();
  res.json({ ok: true });
});

app.post("/api/send", requireUser, parseSendUpload, async (req, res) => {
  const session = req.session;
  const { state, client } = session;

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
  const mediaFiles = req.files || [];

  if (fileId) {
    const file = session.uploadedFiles.find((f) => f.id === fileId);
    if (!file) {
      cleanupMediaFiles(mediaFiles);
      return res.status(404).json({ error: "File not found" });
    }
    try {
      session.loadExcel(path.join(session.uploadDir, file.storedName), file.originalName);
    } catch (err) {
      cleanupMediaFiles(mediaFiles);
      return res.status(400).json({ error: `Could not read file: ${err.message}` });
    }
  }

  if (!state.rows.length) {
    cleanupMediaFiles(mediaFiles);
    return res.status(400).json({ error: "Upload an Excel file first" });
  }

  if (alterEnabled && !overrideMessage && !mediaFiles.length) {
    return res
      .status(400)
      .json({ error: "Write a message or upload a photo/video before sending" });
  }

  let mediaItems = [];
  if (mediaFiles.length) {
    try {
      mediaItems = mediaFiles.map((file) => ({
        media: MessageMedia.fromFilePath(file.path),
        kind: isVideoFile(file) ? "video" : "image",
        path: file.path,
      }));
    } catch (err) {
      cleanupMediaFiles(mediaFiles);
      return res.status(400).json({ error: `Could not read media: ${err.message}` });
    }
  }

  state.sending = true;
  state.progress = { total: state.rows.length, sent: 0, failed: 0 };
  const mediaLabel = mediaItems.length
    ? `${mediaItems.length} media file${mediaItems.length > 1 ? "s" : ""}`
    : null;
  const modeLabel = mediaLabel
    ? overrideMessage
      ? `${mediaLabel} + custom message`
      : mediaLabel
    : overrideMessage
      ? "custom message"
      : "Excel messages";
  session.addLog(`Sending ${modeLabel} to ${state.rows.length} contacts…`, "info");
  session.emitState();
  res.json({ ok: true, total: state.rows.length });

  try {
    for (const row of state.rows) {
      const chatId = toChatId(row.phone);
      const message = alterEnabled
        ? overrideMessage
        : String(row.message || "").trim();

      if (!mediaItems.length && !message) {
        state.progress.failed += 1;
        session.addLog(`Failed ${row.phone}: no message`, "error");
        session.emitState();
        continue;
      }

      try {
        if (mediaItems.length) {
          for (let i = 0; i < mediaItems.length; i++) {
            const item = mediaItems[i];
            await client.sendMessage(chatId, item.media, {
              caption: i === 0 && message ? message : undefined,
              sendMediaAsDocument: false,
            });
            if (i < mediaItems.length - 1) {
              await new Promise((r) => setTimeout(r, 800));
            }
          }
        } else {
          await client.sendMessage(chatId, message);
        }
        state.progress.sent += 1;
        session.addLog(`Sent to ${row.phone}`, "success");
      } catch (err) {
        state.progress.failed += 1;
        session.addLog(`Failed ${row.phone}: ${err.message}`, "error");
      }
      session.emitState();
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    cleanupMediaFiles(mediaFiles);
  }

  state.sending = false;
  session.addLog(
    `Done — ${state.progress.sent} sent, ${state.progress.failed} failed`,
    "info"
  );
  session.emitState();
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (token) {
      const request = new Request("http://localhost/socket.io", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await clerkClient.authenticateRequest(request);
      if (result.isAuthenticated) {
        socket.data.userId = result.toAuth().userId;
        return next();
      }
    }

    const result = await authenticateRequest({
      clerkClient,
      request: socket.request,
      options: {},
    });
    if (!result.isAuthenticated) {
      return next(new Error("Unauthorized"));
    }
    socket.data.userId = result.toAuth().userId;
    next();
  } catch (_) {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.data.userId;
  socket.join(userId);
  const session = getSession(userId);
  socket.emit("state", session.snapshot());
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WhatsApp Sender UI → http://localhost:${PORT}`);
});
