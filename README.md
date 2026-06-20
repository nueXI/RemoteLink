# RemoteLink

A local-network web tool for PC↔phone file transfer, real-time messaging, and remote screen viewing. Access your PC from your phone browser — no internet required, no third-party services.

## Features

- **File transfer** — upload from phone to PC, download from PC to phone
- **Real-time chat** — bidirectional messaging via SignalR with persistent daily chat logs
- **Screen viewing & control** — live H.264 stream of the PC desktop with full touch-based mouse control from phone browser
- **Simple auth** — single password configured in `appsettings.json`
- **Auto-start** — runs via Windows Task Scheduler on login

## Touch Controls (Mobile)

The screen viewer shows a floating action button (FAB, bottom-right) with per-session settings. Controls are only active in **Control mode** (toggled via the FAB).

| Gesture | Action |
|---|---|
| 1-finger tap | Configurable: **left click** / **right click** / **double click** (cycle via FAB) |
| 1-finger hold (300 ms) + drag | Hold left button and drag — for file drag-and-drop |
| 1-finger drag (zoomed in) | Pan the zoomed view (toggle via FAB) |
| 2-finger pinch | Zoom the local view in/out |
| 2-finger swipe (up/down) | Scroll (mouse wheel) |
| Mouse move / click | Full mouse control when using a desktop browser |

Settings (tap behavior, pan on/off) are saved in `localStorage` and persist across sessions.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | ASP.NET Core 10 + SignalR (Kestrel) |
| Frontend | React + TypeScript + Vite |
| Screen capture | Windows GDI (`Graphics.CopyFromScreen`) + FFmpeg H.264 (Sdcb.FFmpeg) |
| Logging | RunamiLogger (local NuGet package) |
| Hosting | Windows Task Scheduler (user session) |

> **Why Task Scheduler and not IIS?** Screen capture requires access to the interactive desktop (Session 1). IIS runs in Session 0 and cannot access it. Task Scheduler with "Run only when user is logged on" starts the process in the correct session.

## Project Structure

```
RemoteLink/
  RemoteLink.slnx
  nuget.config                  ← local NuGet feed for RunamiLogger
  RemoteLink.Api/               ← backend (ASP.NET Core 10)
  RemoteLink.Client/            ← frontend (React + Vite)
  BackendPublish/               ← publish output / Task Scheduler target (not committed)
  _documents/                   ← deployment and setup docs
```

## Development

**Prerequisites:** .NET 10 SDK, Node.js 23.x

### Backend
```bash
cd RemoteLink.Api
dotnet run
# runs on http://localhost:5120
```

### Frontend
```bash
cd RemoteLink.Client
npm install
npm run dev
# runs on http://localhost:5173, proxies /api and /hubs to :5120
```

## Deployment

See [`_documents/deploy-2026-06-18.md`](_documents/deploy-2026-06-18.md) for the full guide covering:

- Task Scheduler setup (first time)
- Building the frontend and publishing the backend
- Firewall rule
- Re-deployment checklist
- Troubleshooting

## Configuration

Edit `BackendPublish/appsettings.json` after each publish:

```json
{
  "Kestrel": {
    "Endpoints": {
      "Http": { "Url": "http://0.0.0.0:5120" }
    }
  },
  "RemoteLink": {
    "Password": "changeme",
    "UploadPath": "Uploads",
    "ChatLogPath": "ChatLogs"
  },
  "FileLogger": {
    "FilePath": "logs",
    "MinimumLevel": "Information"
  }
}
```

Relative paths (`Uploads`, `ChatLogs`, `logs`) resolve from the exe directory automatically.

## Access

On the same local network, open `http://<your-pc-ip>:5120` from any browser.  
Find your PC IP with `ipconfig` (look for IPv4 under Wi-Fi adapter).
