# RemoteLink — Backend Reference

## Project File (`RemoteLink.Api.csproj`)

```xml
<TargetFramework>net10.0-windows</TargetFramework>
<UseWindowsForms>true</UseWindowsForms>
<AllowUnsafeBlocks>true</AllowUnsafeBlocks>
```

- `net10.0-windows` is required because the app uses `System.Windows.Forms.Screen` (monitor enumeration) and `System.Drawing` (GDI+ screen capture). These are Windows-only APIs.
- `UseWindowsForms>true` adds the WinForms SDK references needed to use `Screen`, `Bitmap`, `Graphics`, etc.
- `AllowUnsafeBlocks>true` is required by `H264Encoder`, which uses unsafe pointer operations for FFmpeg interop.
- `RunamiLogger` is a local NuGet package providing file-based structured logging, resolved via `nuget.config`.

### FFmpeg packages

```xml
<PackageReference Include="Sdcb.FFmpeg" Version="7.0.0" />
<PackageReference Include="Sdcb.FFmpeg.runtime.windows-x64" Version="7.1.0" />
```

`Sdcb.FFmpeg` provides managed bindings to FFmpeg 7.x via the `Sdcb.FFmpeg.Raw` namespace (PascalCase API). `Sdcb.FFmpeg.runtime.windows-x64` bundles the actual FFmpeg DLLs and auto-copies them to the build/publish output. No manual DLL copying is required.

---

## Configuration (`appsettings.json`)

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
    "MaxFileSizeBytes": 10485760,
    "MaxFileCount": 10,
    "MinimumLevel": "Information"
  }
}
```

- **`Kestrel.Endpoints.Http.Url`** — binds to all network interfaces on the given port. `0.0.0.0` means the API is reachable from any device on the LAN, not just localhost. Change the port here if `5120` is in use.
- **`RemoteLink.Password`** — the shared secret used for all authentication. The same string is both the login password and the Bearer token. Change before use.
- **`RemoteLink.UploadPath` / `ChatLogPath`** — relative paths are resolved from the process's working directory (the `BackendPublish/` folder in Task Scheduler setup). Can also be absolute paths.
- **`FileLogger`** — configuration consumed by RunamiLogger. `FilePath` is the log directory, `MaxFileSizeBytes` is the per-file size limit before rotation, `MaxFileCount` is how many rotated files are kept.

### Options class (`Options/RemoteLinkOptions.cs`)

```csharp
public sealed class RemoteLinkOptions
{
    public const string Section = "RemoteLink";
    public string Password   { get; set; } = "changeme";
    public string UploadPath { get; set; } = "Uploads";
    public string ChatLogPath { get; set; } = "ChatLogs";
}
```

Bound from the `"RemoteLink"` section via `builder.Services.Configure<RemoteLinkOptions>(...)`. Injected into controllers and services via `IOptions<RemoteLinkOptions>`.

---

## Startup (`Program.cs`)

### DPI mode — must be first

```csharp
Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
```

This must be called before anything else. It changes how `Screen.Bounds` reports display dimensions:

- Without this: `Screen.Bounds` returns **logical pixels** (e.g. a 4K display at 200% DPI reports as 1920×1080)
- With `PerMonitorV2`: `Screen.Bounds` returns **physical pixels** (e.g. the same display correctly reports as 3840×2160)

Without this, captures on scaled displays only capture the top-left quarter of the screen because the bitmap is sized for logical pixels but `CopyFromScreen` works in physical pixels.

### Service registration

```csharp
builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.Configure<RemoteLinkOptions>(...);
builder.Services.AddSingleton<ScreenClientTracker>();
builder.Services.AddSingleton<H264Encoder>();
builder.Services.AddHostedService<ScreenCaptureService>();
builder.Services.AddSingleton<RemoteInputService>();
builder.Services.AddSingleton<ChatLogService>();
builder.Services.AddCors(...);
```

- `ScreenClientTracker` — singleton because it tracks state (connection count, selected monitor, stream mode) across the app's lifetime.
- `H264Encoder` — singleton because the FFmpeg codec context is expensive to initialize; it is created once and reused across all frames.
- `ScreenCaptureService` — registered as a `BackgroundService` (hosted service). ASP.NET Core starts it on app startup and stops it on shutdown.
- `RemoteInputService` — singleton; stateless, but singleton avoids unnecessary allocations.
- `ChatLogService` — singleton because it owns a `SemaphoreSlim` lock that must be shared across all concurrent requests.

### CORS

```csharp
policy.WithOrigins("http://localhost:5173")
      .AllowAnyHeader()
      .AllowAnyMethod()
      .AllowCredentials()
```

Only needed during development when the Vite dev server (`localhost:5173`) calls the API on a different port (`localhost:5120`). In production, the React build is served directly by Kestrel from `wwwroot/` — same origin, no CORS needed.

### Startup directory creation

```csharp
Directory.CreateDirectory(Path.GetFullPath(remoteLinkOptions.UploadPath));
Directory.CreateDirectory(Path.GetFullPath(remoteLinkOptions.ChatLogPath));
```

Creates `Uploads/` and `ChatLogs/` if they don't exist. `Path.GetFullPath` resolves relative paths against the process's current directory, ensuring they resolve correctly regardless of how the app was launched.

### Authentication middleware

```csharp
app.Use(async (context, next) =>
{
    var path = context.Request.Path.Value ?? "";
    bool requiresAuth = path.StartsWith("/api") && path != "/api/auth/login";
    if (requiresAuth)
    {
        var token = headerToken ?? queryToken;
        if (token != options.Password)
        {
            context.Response.StatusCode = 401;
            return;
        }
    }
    await next();
});
```

- Only `/api/*` routes are protected. The frontend SPA, static assets, SignalR hubs, and the login endpoint itself are all publicly accessible.
- Token is accepted from either the `Authorization: Bearer <token>` header or `?token=<token>` query string.
- The query string form is used for file downloads, since an `<a href="...">` download link cannot set custom headers.
- SignalR hubs pass the token via `accessTokenFactory` in the client connection builder, which SignalR maps to the `Authorization` header automatically.

### Route mapping

```csharp
app.MapControllers();
app.MapHub<ChatHub>("/hubs/chat");
app.MapHub<ScreenHub>("/hubs/screen");
app.MapFallbackToFile("index.html");
```

`MapFallbackToFile("index.html")` makes the React SPA's client-side routing work — any URL that doesn't match an API route or static file returns `index.html`, and React Router handles it client-side.

---

## Controllers

### `AuthController` — `POST /api/auth/login`

```
Request body:  { "password": "..." }
Response 200:  { "token": "..." }
Response 401:  (wrong password)
```

The token returned is simply the password itself — a shared secret approach. No JWT, no expiry. The client stores this in `sessionStorage` and attaches it as a Bearer token on all subsequent requests.

This endpoint is the only one excluded from the auth middleware, so it is always accessible without a token.

---

### `FilesController` — `GET|POST|DELETE /api/files`

All endpoints require authentication.

#### `GET /api/files`

Returns an array of file metadata for everything in `UploadPath`:

```json
[
  { "name": "photo.jpg", "size": 204800, "modified": "2026-06-12T08:00:00Z" },
  ...
]
```

Files are returned ordered newest-first by `LastWriteTimeUtc`.

#### `POST /api/files/upload`

Accepts `multipart/form-data`. Iterates `Request.Form.Files` and writes each file to `UploadPath`. `Path.GetFileName` is applied to each filename to strip any directory components (security: prevents path traversal). Files are overwritten if they already exist.

#### `GET /api/files/download/{fileName}`

Returns the file as `application/octet-stream` with `Content-Disposition: attachment`. `Path.GetFileName` is applied to the route parameter to prevent path traversal. Returns 404 if the file doesn't exist.

Since this is a download link (`<a href="..." download>`), it cannot send a Bearer header. Authentication is handled via `?token=<password>` in the URL instead.

#### `DELETE /api/files/{fileName}`

Deletes the named file from `UploadPath`. Returns `204 No Content` on success, `404` if not found.

---

### `ChatController` — `GET|DELETE /api/chat/logs`

All endpoints require authentication.

#### `GET /api/chat/logs`

Returns `string[]` of available log dates in `yyyy-MM-dd` format, newest first:

```json
["2026-06-12", "2026-06-11", "2026-06-10"]
```

Delegates to `ChatLogService.GetDates()`.

#### `GET /api/chat/logs/{date}`

Returns the full message array for a given date:

```json
[
  { "sender": "Phone", "message": "Hello", "timestamp": "2026-06-12T08:00:00Z" },
  { "sender": "PC", "message": "Hi", "timestamp": "2026-06-12T08:00:05Z" }
]
```

Date must be in `yyyy-MM-dd` format — validated with `DateOnly.TryParseExact`. Returns `400` for invalid format, `200` with an empty array if no log exists for that date.

#### `DELETE /api/chat/logs/{date}`

Deletes the JSON file for the given date. Returns `204` on success, `404` if no log exists for that date.

---

### `ScreenController` — `GET /api/screen/monitors`

```json
{
  "monitors": [
    { "index": 0, "width": 1920, "height": 1080, "primary": true,  "name": "Display 1" },
    { "index": 1, "width": 3840, "height": 2160, "primary": false, "name": "Display 2" }
  ],
  "currentIndex": 0,
  "h264Available": true
}
```

Returns all connected displays using `Screen.AllScreens`. `h264Available` reflects whether `H264Encoder.IsAvailable` is true — i.e. whether FFmpeg DLLs loaded successfully and at least one supported codec (NVENC, AMF, QSV, or libx264) was found. The frontend uses this flag to enable or disable the H.264 quality button.

---

## SignalR Hubs

### `ChatHub` — `/hubs/chat`

```csharp
public class ChatHub(ChatLogService logService) : Hub
{
    public async Task SendMessage(string sender, string message)
}
```

**Connection:** No connect/disconnect overrides. SignalR manages connection lifecycle automatically.

**`SendMessage(sender, message)`**

1. Captures `DateTime.UtcNow` as the timestamp.
2. Broadcasts `"ReceiveMessage"` to **all connected clients** (including the sender) with `sender`, `message`, and `timestamp`.
3. Appends the message to the daily log file via `ChatLogService.AppendAsync`.

Broadcasting back to the sender (instead of all-except-sender) is intentional: the client does not optimistically add its own message to the UI — it only shows messages received from the hub. This keeps the server as the single source of truth and ensures the logged timestamp matches what the UI displays.

**Client event to listen for:** `"ReceiveMessage"` — `(sender: string, message: string, timestamp: string)`

---

### `ScreenHub` — `/hubs/screen`

```csharp
public sealed class ScreenHub(ScreenClientTracker tracker, RemoteInputService input) : Hub
```

**`OnConnectedAsync`** — calls `tracker.Increment()`. The capture loop in `ScreenCaptureService` only runs when `ConnectionCount > 0`, so connecting a client starts the stream.

**`OnDisconnectedAsync`** — calls `tracker.Decrement()`. When the last client disconnects the capture loop pauses (saves CPU).

**`SelectScreen(int index)`** — sets `tracker.ScreenIndex` if the index is within bounds. The capture service reads this on every frame, so switching monitors takes effect on the next captured frame.

**`SelectMode(string mode)`** — switches the active stream mode. Accepts `"h264"` or anything else (falls back to `"jpeg"`). When switching to H.264, also calls `tracker.RequestKeyframe()` so the first packet sent to the client contains an IDR frame (necessary for the WebCodecs decoder to configure itself from the codec string embedded in the SPS NAL).

**Remote control methods** (called by the phone):

| Method | Parameters | Action |
|---|---|---|
| `MouseMove` | `ratioX: double, ratioY: double` | Moves the mouse cursor. Coordinates are 0–1 ratios relative to the selected screen |
| `MouseButton` | `button: int, down: bool` | Presses or releases a mouse button (0=left, 1=right, 2=middle) |
| `MouseScroll` | `delta: int` | Scrolls the mouse wheel. Positive = scroll up, negative = scroll down. Use multiples of 120 (Windows WHEEL_DELTA) |
| `KeyType` | `text: string` | Types a string of Unicode characters using `KEYEVENTF_UNICODE` SendInput |
| `KeyPress` | `vk: ushort` | Presses and releases a virtual key (e.g. 0x1B = Esc, 0x0D = Enter) |

**Client events to listen for:**
- `"ReceiveFrame"` — `(base64Jpeg: string)` — broadcast by `ScreenCaptureService` in JPEG mode
- `"ReceiveH264Frame"` — `(base64Data: string, isKeyFrame: boolean, codecString: string | null)` — broadcast in H.264 mode. `codecString` is only non-null on keyframes and contains the WebCodecs codec identifier (e.g. `"avc1.640028"`).

---

## Services

### `StreamMode` (`Services/StreamMode.cs`)

```csharp
public enum StreamMode { Jpeg, H264 }
```

Shared enum used by `ScreenClientTracker` and `ScreenCaptureService` to coordinate which encoding mode is active.

---

### `ScreenClientTracker`

```csharp
public sealed class ScreenClientTracker
{
    private int _count;       // connection count
    private int _screenIndex; // selected monitor index
    private int _streamMode;  // StreamMode enum value (int for Interlocked)
    private int _forceKeyframe; // 0/1 flag
}
```

Thread-safe using `Interlocked` operations. Shared between `ScreenHub` (which increments/decrements, sets index, sets mode) and `ScreenCaptureService` (which reads all values). Because both classes receive it via DI as a singleton, they share the same instance.

```csharp
public StreamMode StreamMode => (StreamMode)Volatile.Read(ref _streamMode);
public void SetStreamMode(StreamMode mode) => Interlocked.Exchange(ref _streamMode, (int)mode);
public void RequestKeyframe() => Interlocked.Exchange(ref _forceKeyframe, 1);
public bool ConsumeForceKeyframe() => Interlocked.Exchange(ref _forceKeyframe, 0) == 1;
```

`ConsumeForceKeyframe()` uses an atomic exchange: it reads the flag and clears it in one operation, preventing two encode calls from both seeing a pending keyframe request.

---

### `ScreenCaptureService`

A `BackgroundService` that runs a continuous loop for the lifetime of the application.

#### Loop logic

```
while not cancelled:
    if ConnectionCount > 0:
        try:
            capture bitmap
            if StreamMode == H264 and h264.IsAvailable:
                h264.Initialize(width, height)     ← no-op if already initialized at same size
                if ConsumeForceKeyframe: h264.ForceNextKeyframe()
                frame = h264.Encode(bitmap)
                if frame != null:
                    hub.Clients.All.SendAsync("ReceiveH264Frame", base64, isKeyFrame, codecString)
            else:
                base64 = JpegEncode(bitmap)
                hub.Clients.All.SendAsync("ReceiveFrame", base64)
        catch:
            log warning once
            sleep 5 seconds   ← back-off on error (e.g. if running in Session 0)
    else:
        sleep 100ms           ← idle when no clients connected
```

No artificial FPS cap. Both JPEG and H.264 paths run as fast as encoding + SignalR queuing allows.

#### `CaptureFrame(screenIndex)`

1. **Select screen** — `Screen.AllScreens[screenIndex]`, fallback to `Screen.PrimaryScreen` if index is out of range.
2. **Get bounds** — `screen.Bounds` returns physical pixel rectangle thanks to `PerMonitorV2` DPI mode. For multi-monitor setups, `bounds.X/Y` is the screen's position within the virtual desktop (not always zero).
3. **Create bitmap** — `new Bitmap(bounds.Width, bounds.Height, Format32bppRgb)`
4. **Capture** — `Graphics.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size, SourceCopy)`. `bounds.Location` is the top-left corner of the screen in virtual desktop coordinates.
5. **Draw cursor** — calls `DrawCursor(bitmap, bounds)`.
6. **Scale if needed** — if width > 1920px, `ScaleToWidth(bitmap, 1920)` using high-quality bicubic interpolation. This caps bandwidth for 4K screens while keeping the content readable on a phone.
7. **Encode** — JPEG (quality 60, base64) or H.264 depending on active mode.

#### `DrawCursor(bitmap, screenBounds)`

Uses P/Invoke:
- `GetCursorInfo(out CursorInfo)` — gets cursor position in virtual desktop coordinates and the cursor handle.
- Converts position to bitmap-relative coordinates: `x = cursorX - screenBounds.X`, `y = cursorY - screenBounds.Y`.
- If the cursor is outside this screen's bounds, returns without drawing (cursor is on a different monitor).
- `DrawIconEx(hdc, x, y, hCursor, 0, 0, 0, IntPtr.Zero, DI_NORMAL)` — draws the actual current cursor shape (arrow, I-beam, resize handles, etc.) directly onto the bitmap using GDI.

The cursor is baked into the frame rather than sent as a separate overlay. This avoids any synchronization complexity between the frame and cursor position on the client.

#### `ScaleToWidth(source, targetWidth)`

Creates a new bitmap at `targetWidth × (height * targetWidth/width)` and draws the source onto it with `InterpolationMode.HighQualityBicubic`. The original bitmap is not modified.

---

### `H264Encoder`

An `unsafe` singleton service wrapping FFmpeg codec context lifecycle and per-frame encoding.

#### Fields

```csharp
private AVCodecContext* _ctx;
private AVFrame*        _frame;
private AVPacket*       _pkt;
private SwsContext*     _swsCtx;
private int             _width, _height;
private long            _pts;
private int             _forceKeyframe;   // interlocked 0/1
private byte[]?         _extraData;       // cached Annex-B SPS/PPS from ctx->extradata
private string?         _cachedCodecString;
```

#### `IsAvailable`

Set in the constructor by probing `ffmpeg.avcodec_version()`. If the FFmpeg DLLs are not present, this call throws `DllNotFoundException` and `IsAvailable` is set to `false`. The rest of the service is never used in that case.

#### `Initialize(width, height, fps = 30)`

No-op if already initialized at the same dimensions. Otherwise frees the existing context and tries codecs in order:

1. `h264_nvenc` (NVIDIA GPU)
2. `h264_amf` (AMD GPU)
3. `h264_qsv` (Intel Quick Sync)
4. `libx264` (software fallback)

For each, creates an `AVCodecContext`, sets common parameters (`width`, `height`, `pix_fmt = YUV420P`, `bit_rate = 3Mbps`, `gop_size = fps`, `max_b_frames = 0`), applies codec-specific low-latency options:

| Codec | Options |
|---|---|
| `libx264` | `preset=ultrafast, tune=zerolatency` |
| `h264_nvenc` | `preset=p1, tune=ull, delay=0` |
| `h264_amf` | `usage=ultralowlatency, quality=speed` |
| `h264_qsv` | `preset=veryfast, low_delay_brc=1` |

Then calls `avcodec_open2`. If it fails, the context is freed and the next codec is tried. First successful open wins.

After `avcodec_open2`, the SPS/PPS bytes are read from `ctx->extradata`. Hardware encoders (NVENC, AMF) store the parameter sets here in AVCC format instead of inlining them in keyframe packets. `ToAnnexB()` converts AVCC to Annex-B (prepends `00 00 00 01` start codes). The Annex-B bytes are cached in `_extraData` and the codec string (`avc1.PPCCLL`) is extracted and cached in `_cachedCodecString`.

#### `Encode(Bitmap)`

1. LockBits the bitmap as `Format32bppRgb`.
2. Calls `sws_scale` to convert BGR0 → YUV420P into `_frame`.
3. If `_forceKeyframe` is set (atomically consumed), sets `_frame->pict_type = AVPictureType.I`.
4. Sends frame to encoder via `avcodec_send_frame`.
5. Receives packet via `avcodec_receive_packet`. Returns `null` if the encoder is still buffering (EAGAIN).
6. On keyframes: checks if the packet already contains an SPS NAL (`HasSps`). If not (hardware encoder case), prepends `_extraData`. This guarantees every keyframe sent to the frontend contains the SPS/PPS needed for WebCodecs to configure the decoder.
7. Returns an `H264Frame(data, isKeyFrame, codecString)`.

#### `HasSps(byte[])`

Scans for Annex-B start codes (`00 00 00 01` or `00 00 01`) and checks if the following NAL type byte has type 7 (SPS).

#### `ToAnnexB(byte[])`

Detects whether the input is already Annex-B (starts with `00 00`) or is in AVCC format (starts with `01`). For AVCC: reads the SPS count, then each SPS unit (length-prefixed), writes each as Annex-B with a 4-byte start code. Then reads the PPS units the same way.

#### `ExtractCodecString(byte[])`

Finds the SPS NAL in Annex-B data, reads bytes at `nalOffset+1`, `+2`, `+3` (profile_idc, profile_compatibility, level_idc), and formats them as `"avc1.{XX}{XX}{XX}"` (uppercase hex). This is the codec string required by the WebCodecs `VideoDecoder.configure()` call.

#### `H264Frame` record

```csharp
public sealed record H264Frame(byte[] Data, bool IsKeyFrame, string? CodecString);
```

`CodecString` is non-null only on keyframes and only when the SPS is available. The frontend only calls `decoder.configure()` when it receives a keyframe with a non-null codec string.

---

### `ChatLogService`

Manages persistent chat history stored as JSON files: one file per day, named `{yyyy-MM-dd}.json`.

#### Log record

```csharp
public record ChatLogEntry(string Sender, string Message, DateTime Timestamp);
```

#### Thread safety

A `SemaphoreSlim(1, 1)` guards all write operations. Read operations (`GetEntriesAsync`, `GetDates`) are not locked because:
- File reads are atomic at the OS level for small files.
- `GetDates` only calls `Directory.GetFiles`, which is inherently safe.
- `Delete` calls `File.Delete` which is atomic.

Only `AppendAsync` is locked because it reads → modifies → writes the JSON array, and concurrent appends without locking would cause race conditions (one write overwriting another's appended entry).

#### `AppendAsync(entry)`

```
acquire lock
  read existing file → List<ChatLogEntry>
  append new entry
  serialize entire list → write file
release lock
```

The file date uses `DateTime.Now` (local time / MYT) for the filename, but the `Timestamp` field in the entry is `DateTime.UtcNow` (captured in `ChatHub`). This means the file is created on the correct local calendar date while timestamps inside the file are UTC (the frontend formats them with `toLocaleTimeString()`).

#### `GetDates()`

Scans the log directory for files matching `????-??-??.json`, extracts the date from the filename, and returns them newest-first. Returns an empty array if the directory doesn't exist yet.

#### JSON serialization

- **Writing**: `JsonNamingPolicy.CamelCase` so the JSON keys match JavaScript conventions (`sender`, `message`, `timestamp`).
- **Reading**: `PropertyNameCaseInsensitive = true` so it tolerates both `Sender`/`sender` when deserializing.

---

### `RemoteInputService`

Wraps `user32.dll!SendInput` to simulate mouse and keyboard events. Stateless — all methods are pure operations with no stored state.

#### Mouse movement (`MoveMouse`)

```
physX = screen.Bounds.X + (ratioX * screen.Bounds.Width)
physY = screen.Bounds.Y + (ratioY * screen.Bounds.Height)

normX = (physX - SM_XVIRTUALSCREEN) * 65535 / SM_CXVIRTUALSCREEN
normY = (physY - SM_YVIRTUALSCREEN) * 65535 / SM_CYVIRTUALSCREEN

SendInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, normX, normY)
```

`MOUSEEVENTF_VIRTUALDESK` is essential for multi-monitor setups. Without it, absolute coordinates are interpreted relative to the primary monitor only (0–65535 maps to the primary monitor's resolution). With it, they map to the entire virtual desktop.

`SM_XVIRTUALSCREEN` / `SM_YVIRTUALSCREEN` give the top-left corner of the virtual desktop (can be negative if a monitor is positioned to the left of or above the primary). `SM_CXVIRTUALSCREEN` / `SM_CYVIRTUALSCREEN` give the total virtual desktop size.

#### Mouse buttons (`MouseButton`)

Sends `MOUSEEVENTF_LEFTDOWN/UP`, `RIGHTDOWN/UP`, or `MIDDLEDOWN/UP` based on the button index (0/1/2) and whether it's a press or release.

#### Mouse scroll (`MouseScroll`)

Sends `MOUSEEVENTF_WHEEL` with `mouseData` set to `delta`. Windows uses 120 as one scroll "click" (`WHEEL_DELTA`). Positive = scroll up, negative = scroll down.

#### Text typing (`TypeText`)

For each character in the string, sends a key-down/key-up pair using `KEYEVENTF_UNICODE` with `wScan` set to the character's codepoint. No virtual key code is needed — Unicode input bypasses the keyboard layout. Works for any Unicode character including non-ASCII.

#### Virtual key press (`KeyPress`)

Sends a key-down/key-up pair using the provided virtual key code (`wVk`). Used for special keys that don't have Unicode equivalents: Escape (0x1B), Tab (0x09), Enter (0x0D), Backspace (0x08), arrow keys (0x25–0x28), Delete (0x2E).

#### P/Invoke structures

```csharp
[StructLayout(Sequential)] struct INPUT     { uint type; InputUnion U; }
[StructLayout(Explicit)]   struct InputUnion { MOUSEINPUT mi; KEYBDINPUT ki; }  // overlapping at offset 0
[StructLayout(Sequential)] struct MOUSEINPUT { int dx, dy; uint mouseData, dwFlags, time; IntPtr dwExtraInfo; }
[StructLayout(Sequential)] struct KEYBDINPUT { ushort wVk, wScan; uint dwFlags, time; IntPtr dwExtraInfo; }
```

`InputUnion` uses `[FieldOffset(0)]` on both fields — they occupy the same memory, which is the correct representation of the C union inside `INPUT`.
