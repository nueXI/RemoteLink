# RemoteLink

A local-network web tool for PC↔phone file transfer, real-time messaging, and remote screen viewing. Access your PC from your phone browser — no internet required, no third-party services.

## Features

- **File transfer** — upload from phone to PC, download from PC to phone
- **Real-time chat** — bidirectional messaging via SignalR with persistent daily chat logs
- **Screen viewing** — live H.264 stream of the PC desktop, viewable from phone browser
- **Simple auth** — single password configured in `appsettings.json`
- **Auto-start** — runs via Windows Task Scheduler on login

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
