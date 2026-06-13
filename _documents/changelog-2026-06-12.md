# RemoteLink — Changelog
_Date: 2026-06-12_

---

## Summary of Changes

| Area | Change |
|---|---|
| Screen capture | New feature — server-side screen streaming via SignalR |
| Chat logging | New feature — persist messages to daily JSON files |
| Deployment | Changed from IIS to Task Scheduler (required for screen capture) |
| Build | Suppressed third-party Vite/Rolldown annotation warnings |
| Project | Target framework changed to `net10.0-windows` + `UseWindowsForms` |

---

## 1. Screen Capture

### What was added

Real-time screen viewing from phone. The backend captures the PC screen and streams JPEG frames over SignalR. No external software (OBS, etc.) required.

### New files

| File | Purpose |
|---|---|
| `RemoteLink.Api/Services/ScreenClientTracker.cs` | Thread-safe connection counter; capture loop only runs when at least one client is connected |
| `RemoteLink.Api/Hubs/ScreenHub.cs` | SignalR hub at `/hubs/screen`; tracks connect/disconnect; exposes `SelectScreen(int index)` for monitor switching |
| `RemoteLink.Api/Services/ScreenCaptureService.cs` | `BackgroundService`; captures screen, draws cursor, encodes to JPEG, broadcasts base64 via SignalR |
| `RemoteLink.Api/Controllers/ScreenController.cs` | `GET /api/screen/monitors` — returns list of all connected displays |
| `RemoteLink.Client/src/api/screen.ts` | SignalR connection factory + `getMonitors()` API call |
| `RemoteLink.Client/src/components/Screen.tsx` | Screen tab UI: live frame display, monitor switcher, FPS counter, fullscreen button |

### Modified files

- `RemoteLink.Api/Program.cs` — added `Application.SetHighDpiMode(PerMonitorV2)`, registered `ScreenClientTracker` and `ScreenCaptureService`, mapped `/hubs/screen`
- `RemoteLink.Api/RemoteLink.Api.csproj` — changed `TargetFramework` to `net10.0-windows`, added `<UseWindowsForms>true</UseWindowsForms>`
- `RemoteLink.Client/src/App.tsx` — added "Screen" tab
- `RemoteLink.Client/src/index.css` — screen panel, toolbar, viewer, placeholder styles

### How it works

```
BackgroundService loop
  ↓ (only when ConnectionCount > 0)
Screen.AllScreens[selectedIndex].Bounds  → physical pixel bounds
Graphics.CopyFromScreen(...)             → raw bitmap
DrawCursor(bitmap, bounds)               → overlays real cursor shape via DrawIconEx
ScaleToWidth(bitmap, 1920)              → resize if screen > 1920px wide (4K etc.)
JPEG encode at 60% quality
Convert.ToBase64String(...)
SignalR broadcast → "ReceiveFrame"
  ↓
Phone: <img src="data:image/jpeg;base64,..." /> updated on each frame
```

### DPI / 4K fix

`Application.SetHighDpiMode(HighDpiMode.PerMonitorV2)` is called in `Program.cs` before the builder. This makes `Screen.Bounds` return physical pixel dimensions (e.g. 3840×2160 for a 4K display at 200% scaling) instead of logical/scaled dimensions. Without this, a 4K display at 200% DPI would report as 1920×1080 and only capture the top-left quarter of the screen.

### Cursor overlay

Uses P/Invoke `GetCursorInfo` + `DrawIconEx` to render the actual current cursor shape (not just an arrow) directly onto the bitmap before encoding. Cursor is skipped if it is on a different monitor than the one being captured.

### FPS

No artificial frame rate cap. The loop runs at the natural speed of JPEG encoding + SignalR queuing (~20–50 fps depending on resolution and CPU). When no clients are connected the loop sleeps 100ms to avoid idle CPU burn. A real-time FPS counter is displayed in the screen toolbar.

### Multiple monitors

`GET /api/screen/monitors` returns all connected displays with index, resolution, and primary flag. If more than one monitor is detected, Display 1 / Display 2 / … buttons appear in the screen toolbar. Clicking one invokes `SelectScreen(index)` on the hub; the capture service reads `ScreenClientTracker.ScreenIndex` on every frame.

---

## 2. Chat Logging

### What was added

Chat messages are automatically saved to daily JSON files. Today's log is pre-loaded when the chat connects. A Logs button lets you view and delete past days.

### New files

| File | Purpose |
|---|---|
| `RemoteLink.Api/Services/ChatLogService.cs` | Reads/writes/deletes `ChatLogs/{yyyy-MM-dd}.json`; thread-safe with `SemaphoreSlim` |
| `RemoteLink.Api/Controllers/ChatController.cs` | REST endpoints for listing and deleting logs |

### Modified files

- `RemoteLink.Api/Options/RemoteLinkOptions.cs` — added `ChatLogPath` (default: `"ChatLogs"`)
- `RemoteLink.Api/appsettings.json` — added `"ChatLogPath": "ChatLogs"`
- `RemoteLink.Api/Hubs/ChatHub.cs` — injects `ChatLogService`; calls `AppendAsync` after every `SendMessage`
- `RemoteLink.Api/Program.cs` — registered `ChatLogService` singleton; creates `ChatLogs/` directory at startup
- `RemoteLink.Client/src/api/chat.ts` — added `getChatLogDates()`, `getChatLog(date)`, `deleteChatLog(date)`
- `RemoteLink.Client/src/components/Chat.tsx` — auto-loads today's log on connect; added Logs panel

### API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/chat/logs` | Returns `string[]` of available dates (`yyyy-MM-dd`), newest first |
| `GET` | `/api/chat/logs/{date}` | Returns `ChatMessage[]` for that date |
| `DELETE` | `/api/chat/logs/{date}` | Deletes that date's JSON file |

### Log format

`ChatLogs/2026-06-12.json`:
```json
[
  { "sender": "Phone", "message": "Hello", "timestamp": "2026-06-12T08:30:00Z" },
  { "sender": "PC",    "message": "Hi",    "timestamp": "2026-06-12T08:30:05Z" }
]
```

- File date uses **local system time** (MYT) — matches what the user sees on their clock
- Timestamps inside the file are **UTC** — the frontend formats them with `.toLocaleTimeString()`
- `ChatLogPath` is configurable in `appsettings.json`

### UI behaviour

- On `connected`, the frontend fetches today's log and sets it as the initial messages list
- New messages from SignalR append on top normally (no deduplication needed — they are new)
- **Logs button** (top-right of status bar): opens an inline panel listing all available dates with a Delete button per row
- Deleting calls `DELETE /api/chat/logs/{date}` and removes the row immediately

---

## 3. Deployment Change — IIS → Task Scheduler

### Reason

IIS worker processes (`w3wp.exe`) run in **Windows Session 0**, which is isolated from the interactive desktop. `Graphics.CopyFromScreen` fails in Session 0 with "The handle is invalid" because there is no display surface accessible from that session. Changing the app pool identity does not fix this — the process is still in Session 0 regardless of which user account it runs as.

The fix is to run the backend process in the **user's interactive session** (Session 1+), which is achieved via Task Scheduler with "Run only when user is logged on."

### Kestrel URL binding

Added to `appsettings.json` so Kestrel binds to all interfaces on port 5120 when running standalone (without IIS as a reverse proxy):

```json
"Kestrel": {
  "Endpoints": {
    "Http": { "Url": "http://0.0.0.0:5173" }
  }
}
```

> Port can be changed to any available port. Ensure the Windows Firewall rule covers whichever port is used.

### Task Scheduler setup

1. Open **Task Scheduler** → **Create Task** (not Basic Task)
2. **General tab**
   - Name: `RemoteLink Backend`
   - ✅ Run only when user is logged on
   - ❌ Do NOT check "Run with highest privileges" — elevated processes run in a restricted session
3. **Triggers tab** → New → At log on → your user account
4. **Actions tab** → New → Start a program
   - Program: `D:\path\to\BackendPublish\RemoteLink.Api.exe`
   - Start in: `D:\path\to\BackendPublish\` ← **required** for relative paths (`Uploads/`, `ChatLogs/`, `logs/`) to resolve correctly
5. Run the task once manually to verify, then re-login to confirm auto-start

### Phone access

```
http://192.168.x.x:5173
```

The React frontend is served by Kestrel from `wwwroot/`. There is no separate frontend server in production — everything comes from the same port.

---

## 4. Other Changes

### Vite build warning suppression

`@microsoft/signalr` emits `INVALID_ANNOTATION` warnings with Vite 8 / Rolldown. Suppressed in `vite.config.ts`:

```ts
rollupOptions: {
  onwarn(warning, warn) {
    if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules')) return;
    warn(warning);
  },
},
```

### Responsive screen viewer fix

- Added `min-height: 0` to `main` and `.screen-panel` — required for flex column children to shrink below content height on mobile
- Switched `.screen-frame` from `position: absolute` to `max-width: 100%; max-height: 100%` within a flex-centered container — more reliable for `max-height: 100%` to resolve against a defined parent height
