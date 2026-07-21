# WhatsApp Sender

A self-hosted web app for sending bulk WhatsApp messages from an Excel spreadsheet. Connect your WhatsApp account via QR code, upload a contact list, and send personalized or custom messages with optional photos and videos — with live progress in the browser.

## What it does

- **Links WhatsApp** — scan a QR code to connect your account (same flow as WhatsApp Web / Linked devices).
- **Reads contacts from Excel** — one row per recipient with phone number and message text.
- **Sends in bulk** — messages go out one by one with a short delay between each to reduce rate-limit risk.
- **Custom broadcasts** — optionally replace every row’s message with one shared text, and attach up to 10 photos or videos.
- **File library** — previously uploaded spreadsheets are saved so you can resend without re-uploading.
- **Arabic support** — Arabic column names, message text, and filenames display and send correctly.

The landing page at `/` explains the workflow; the sender UI lives at `/app.html`.

## Tech stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 |
| Server | Express 5, Socket.io (real-time status & logs) |
| WhatsApp | [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) (Puppeteer + Chromium) |
| Spreadsheets | [SheetJS (xlsx)](https://sheetjs.com/) |
| Uploads | Multer |
| QR codes | qrcode |
| Frontend | Vanilla HTML/CSS/JS |
| Container | Docker (Debian + Chromium) |

Persistent data:

- `uploads/` — Excel files and a `files.json` manifest
- `.wwebjs_auth/` (or `WWEBJS_AUTH_PATH`) — WhatsApp session so you stay logged in across restarts

## Excel format

Create a spreadsheet (`.xlsx` or `.xls`) with at least these columns:

| Column (Arabic) | Column (English) | Description |
|-----------------|------------------|-------------|
| `الرقم` | `phone` | Phone number (e.g. `0501234567` or `966501234567`) |
| `الرساله` | `message` | Message text for that contact |

- If a sheet named **`whatsapp`** exists, it is used; otherwise the first sheet is read.
- Rows without a phone number are skipped.
- Saudi numbers starting with `0` are normalized to the `966` country code automatically.

## How to use

1. Open the app in your browser (`/` for the homepage, `/app.html` for the sender).
2. **Scan the QR code** — WhatsApp → Linked devices → Link a device.
3. Wait until the status shows **Connected**.
4. **Upload an Excel file** (drag-and-drop or click to browse), or pick a file from your upload history.
5. (Optional) Enable **Alter message** to send the same custom text and/or media to every contact instead of each row’s message.
6. Click **Send** and watch progress and logs update live.
7. To reconnect later, use **Refresh WhatsApp** if the QR stalls, or **Reconnect WhatsApp** after a session expires.

### Media limits

- Up to **10** photos/videos per send
- Photos: max **16 MB** each
- Videos: max **100 MB** each
- When media is attached, the custom/override message is sent as the caption on the first item

## Run locally

**Requirements:** Node.js 20+, npm

```bash
git clone <repo-url>
cd whatsapp-sender
npm install
```

The server listens on port **80** by default (needs elevated privileges on some systems). Use a higher port for local development:

```bash
PORT=3000 npm start
```

Open [http://localhost:3000](http://localhost:3000).

For auto-reload during development:

```bash
PORT=3000 npm run dev
```

On first run, WhatsApp session data is stored in `.wwebjs_auth/` in the project directory. Uploaded files go to `uploads/`.

### Environment variables (local)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `80` | HTTP port |
| `WWEBJS_AUTH_PATH` | `.wwebjs_auth` | WhatsApp session storage |
| `PUPPETEER_EXECUTABLE_PATH` | *(bundled Chromium)* | Path to Chromium/Chrome (set in Docker) |
| `QR_TIMEOUT_MS` | `45000` | Restart WhatsApp client if no QR within this time |

## Run with Docker

```bash
docker compose up --build
```

The app is available at [http://localhost:8080](http://localhost:8080) (host port **8080** → container port **80**).

Docker Compose mounts two volumes:

- `wwebjs_auth` → `/data/.wwebjs_auth` — WhatsApp session
- `uploads` → `/app/uploads` — Excel files and media

The entrypoint clears stale Chromium lock files on startup so redeploys (e.g. on Coolify) do not fail with “profile in use” errors.

### Deploying (Coolify / reverse proxy)

- The container exposes port **80** and binds to `0.0.0.0`.
- Point your reverse proxy at that port; HTTPS is handled by the proxy, not the app.
- Set `shm_size: 256mb` (already in `docker-compose.yml`) — Chromium needs shared memory.
- Persist `/data/.wwebjs_auth` and `/app/uploads` so sessions and files survive restarts.

## API overview

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/state` | Current WhatsApp status, progress, file list |
| `POST` | `/api/upload` | Upload Excel (multipart field: `file`) |
| `DELETE` | `/api/files/:id` | Remove a saved Excel file |
| `POST` | `/api/send` | Start sending (`fileId`, optional `alterMessage`, `overrideMessage`, `media[]`) |
| `POST` | `/api/whatsapp/restart` | Restart WhatsApp client / refresh QR |

Socket.io emits `state` and `log` events to all connected clients.

## Project layout

```
server.js           Express server, WhatsApp client, APIs
public/
  index.html        Landing page
  app.html          Sender UI
  app.js            Frontend logic
  styles.css        Styles (incl. Arabic fonts)
app.js              Original CLI script (legacy; web app uses server.js)
Dockerfile
docker-compose.yml
docker-entrypoint.sh
```

## Notes

- This uses the unofficial WhatsApp Web protocol. Use responsibly and follow WhatsApp’s terms of service; bulk messaging can trigger account restrictions.
- Only one WhatsApp session is active per server instance. For multi-user setups with separate accounts, run separate instances or use per-user isolation (see the `cursor/clerk-authentication` branch if merged).
- Keep session and upload volumes backed up if you rely on saved logins or file libraries.
