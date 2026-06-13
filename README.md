# RemoteLink

A local-network web tool for PC↔phone file transfer and real-time messaging. Access your PC from your phone browser — no internet required, no third-party services.

## Features

- **File transfer** — upload files from phone to PC, download from PC to phone, drag & drop support
- **Real-time chat** — bidirectional messaging via SignalR, click any message to copy
- **Simple auth** — single password configured in `appsettings.json`
- **Auto-start** — deployed to IIS, starts with Windows

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | ASP.NET Core 10 Minimal API + SignalR |
| Frontend | React + TypeScript + Vite |
| Logging | RunamiLogger (local NuGet package) |
| Hosting | IIS on Windows |

## Project Structure

```
RemoteLink/
  RemoteLink.sln
  nuget.config                  ← local NuGet feed for RunamiLogger
  RemoteLink.Api/               ← backend (ASP.NET Core 10)
  RemoteLink.Client/            ← frontend (React + Vite)
  BackendPublish/               ← IIS publish output (not committed)
  _documents/                   ← deployment and setup docs
```

## Development

### Prerequisites
- .NET 10 SDK
- Node.js 18+

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

See [`_documents/deploy-2026-06-11.md`](_documents/deploy-2026-06-11.md) for full IIS deployment instructions including:

- Prerequisites (.NET 10 Hosting Bundle)
- Building and publishing steps
- IIS app pool and site configuration
- Firewall setup
- Re-deployment workflow
- Troubleshooting guide

## Configuration

Edit `BackendPublish/appsettings.json` (or `RemoteLink.Api/appsettings.json` before publish):

```json
{
  "RemoteLink": {
    "Password": "changeme",
    "UploadPath": "Uploads"
  },
  "FileLogger": {
    "FilePath": "logs",
    "MinimumLevel": "Information"
  }
}
```

## Access

On the same local network, open `http://<your-pc-ip>:<port>` from any browser.
Find your PC IP with `ipconfig` (look for IPv4 under Wi-Fi adapter).
