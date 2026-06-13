# RemoteLink — Project Overview

## What It Is

RemoteLink is a local-network tool that lets a phone (or any browser on the same Wi-Fi) interact with a Windows PC. It runs entirely on the PC and is accessed via a web browser — no app installation required on the phone.

**Features:**

| Feature | Description |
|---|---|
| **Chat** | Real-time bidirectional messaging between PC and phone, with per-day log persistence |
| **Files** | Upload files from phone to PC, download files from PC to phone |
| **Screen** | Live screen stream from PC to phone at unlimited FPS. Two modes: **JPEG** (always available, lower latency on local networks) and **H.264** (available when FFmpeg is present and browser supports WebCodecs over HTTPS) |
| **Remote Control** | Phone can move the mouse, click, scroll, and type on the PC |

---

## Tech Stack

### Backend
| Layer | Technology |
|---|---|
| Runtime | .NET 10, Windows only (`net10.0-windows`) |
| Web framework | ASP.NET Core 10 (MVC + Kestrel) |
| Real-time | ASP.NET Core SignalR |
| Screen capture | `System.Drawing` (GDI+) + Windows Forms (`Screen`, `Graphics`) |
| H.264 encoding | `Sdcb.FFmpeg 7.0.0` + `Sdcb.FFmpeg.runtime.windows-x64 7.1.0` (bundles FFmpeg 7.x DLLs via NuGet) |
| Input simulation | `user32.dll SendInput` via P/Invoke |
| Logging | RunamiLogger (local NuGet package) |
| Hosting | Task Scheduler — runs in user's interactive Windows session |

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript |
| Build tool | Vite 8 + Rolldown |
| HTTP client | Axios |
| Real-time client | `@microsoft/signalr` |
| H.264 decode | Browser WebCodecs API (`VideoDecoder`) — requires HTTPS |
| Styling | Plain CSS custom properties (no CSS framework) |

---

## Architecture at a Glance

```
Phone browser
    │
    │  HTTP / WebSocket  (same port — Kestrel serves everything)
    │
    ▼
┌─────────────────────────────────────────────────────┐
│                   ASP.NET Core 10                   │
│                                                     │
│  Kestrel  →  Static files (wwwroot/*)               │
│             ↓                                       │
│  Middleware (auth token check on /api/*)            │
│             ↓                                       │
│  MVC Controllers          SignalR Hubs              │
│  ┌──────────────┐         ┌──────────────────────┐  │
│  │ AuthCtrl     │         │ ChatHub              │  │
│  │ FilesCtrl    │         │   SendMessage()      │  │
│  │ ChatCtrl     │         │ ScreenHub            │  │
│  │ ScreenCtrl   │         │   SelectScreen()     │  │
│  └──────────────┘         │   SelectMode()       │  │
│                           │   MouseMove()        │  │
│  Services (singletons)    │   MouseButton()      │  │
│  ┌──────────────────────┐ │   MouseScroll()      │  │
│  │ ChatLogService       │ │   KeyType()          │  │
│  │ ScreenClientTracker  │ │   KeyPress()         │  │
│  │ RemoteInputService   │ └──────────────────────┘  │
│  │ ScreenCaptureService │ ← BackgroundService        │
│  │ H264Encoder          │ ← Singleton                │
│  └──────────────────────┘                           │
└─────────────────────────────────────────────────────┘
            │
            │  Reads desktop / sends input
            ▼
       Windows Desktop
  (GDI+ screen capture, user32 SendInput, FFmpeg H.264)
```

---

## Request / Response Overview

All traffic goes through a single port (default `5120`). Kestrel handles:

- `GET /` → serves `wwwroot/index.html` (the React SPA)
- `GET /assets/*` → static JS/CSS bundles
- `POST /api/auth/login` → unauthenticated, returns token
- `GET|POST|DELETE /api/*` → requires Bearer token
- `WS /hubs/chat` → SignalR chat hub
- `WS /hubs/screen` → SignalR screen hub

---

## Directory Structure

```
RemoteLink/
├── RemoteLink.sln
├── nuget.config                      ← local NuGet feed for RunamiLogger
├── _documents/                       ← changelogs, guides, this file
│   └── FullDetailedGuide/
├── BackendPublish/                   ← dotnet publish output, Task Scheduler points here
│   ├── RemoteLink.Api.exe
│   ├── appsettings.json              ← EDIT PASSWORD HERE
│   ├── wwwroot/                      ← npm run build output (auto-generated)
│   ├── Uploads/                      ← file storage (auto-created at startup)
│   ├── ChatLogs/                     ← chat log JSON files (auto-created at startup)
│   └── logs/                         ← app log files (auto-created by RunamiLogger)
├── RemoteLink.Api/                   ← backend source
│   ├── Controllers/
│   │   ├── AuthController.cs
│   │   ├── FilesController.cs
│   │   ├── ChatController.cs
│   │   └── ScreenController.cs
│   ├── Hubs/
│   │   ├── ChatHub.cs
│   │   └── ScreenHub.cs
│   ├── Services/
│   │   ├── ChatLogService.cs
│   │   ├── ScreenCaptureService.cs
│   │   ├── ScreenClientTracker.cs
│   │   ├── RemoteInputService.cs
│   │   ├── H264Encoder.cs            ← FFmpeg-based H.264 encoder
│   │   └── StreamMode.cs             ← enum: Jpeg | H264
│   ├── Options/
│   │   └── RemoteLinkOptions.cs
│   ├── Program.cs
│   ├── appsettings.json
│   └── RemoteLink.Api.csproj
└── RemoteLink.Client/                ← frontend source
    ├── src/
    │   ├── api/
    │   │   ├── auth.ts
    │   │   ├── client.ts
    │   │   ├── chat.ts
    │   │   ├── files.ts
    │   │   └── screen.ts
    │   ├── components/
    │   │   ├── Login.tsx
    │   │   ├── Chat.tsx
    │   │   ├── Files.tsx
    │   │   └── Screen.tsx
    │   ├── App.tsx
    │   ├── main.tsx
    │   └── index.css
    ├── vite.config.ts
    └── package.json
```

---

## Why Task Scheduler (not IIS)

The screen capture feature uses `Graphics.CopyFromScreen` which requires access to the interactive Windows desktop (Session 1). IIS worker processes (`w3wp.exe`) run in **Session 0** — a headless, isolated session with no access to the display. Attempting to capture in Session 0 throws `"The handle is invalid"`.

Task Scheduler with **"Run only when user is logged on"** starts the process directly in the user's interactive session (Session 1+), giving it full desktop access. **"Run with highest privileges"** must NOT be checked — elevated processes are also restricted from GDI desktop surfaces.

> If the screen capture and remote control features are not needed, the app works fine under IIS for Chat and Files only.

---

## H.264 Mode — Requirements and Limitations

H.264 streaming is an optional mode layered on top of the always-available JPEG stream.

**Server-side requirements:**
- `Sdcb.FFmpeg.runtime.windows-x64` NuGet package must be present (it bundles FFmpeg DLLs into the publish output automatically).
- `H264Encoder.IsAvailable` is checked on startup by probing `ffmpeg.avcodec_version()`. If the DLLs are missing, H.264 is silently disabled and the `/api/screen/monitors` response includes `"h264Available": false`.

**Client-side requirements:**
- **HTTPS or localhost only** — the browser WebCodecs API (`VideoDecoder`) is restricted to secure contexts. If the app is served over plain HTTP on a local IP, `VideoDecoder` is undefined and the H.264 button is disabled with a tooltip explaining the requirement.
- **Chrome (or Chromium-based)** recommended. Firefox does not support WebCodecs as of 2026.

**Performance note:** On a fast local network, JPEG typically has lower end-to-end latency than H.264 because JPEG requires no JS-side decode step. H.264 is useful when bandwidth is limited (e.g. remote access via HTTPS tunnel).
