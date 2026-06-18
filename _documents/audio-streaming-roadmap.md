# Audio Streaming Roadmap

**Goal:** Stream PC system audio (loopback) to the phone browser in real time over LAN.

---

## Design decisions

| Decision | Choice | Reason |
|---|---|---|
| Capture API | NAudio `WasapiLoopbackCapture` | Captures system audio output, simple .NET API |
| Encoding | None — raw PCM Int16 | LAN bandwidth is ample; avoids codec compatibility hell on iOS |
| Wire format | Int16 little-endian, interleaved channels, base64 | Works with Web Audio API on all browsers including iOS Safari |
| Transport | Existing SignalR `ScreenHub` | Reuses connection; audio always goes with screen |
| Client playback | Web Audio API `AudioBuffer` + jitter buffer | The only reliable cross-browser path; iOS Safari has no `AudioDecoder` |
| Toggle | Button in toolbar | Mobile browsers block audio autoplay; requires a user gesture |

---

## Bandwidth estimate

| | Value |
|---|---|
| Sample rate | 44100–48000 Hz (whatever WASAPI returns) |
| Channels | 2 (stereo) |
| Bit depth | 16-bit Int (downconverted from WASAPI's Float32) |
| Raw throughput | ~176–192 KB/s |
| Base64 overhead | ~235–256 KB/s on wire |
| Current video (H.264) | ~375 KB/s |
| **Total increase** | **~60–70% more data** — still trivial on LAN |

---

## Architecture

```
WASAPI loopback (Float32) → AudioCaptureService → Int16 → base64 → SignalR
                                                                        ↓
                                               ScreenHub "ReceiveAudio(base64, sampleRate, channels)"
                                                                        ↓
                                               Web Audio API AudioBuffer → jitter buffer → speakers
```

---

## Server components

### 1. NAudio NuGet package
Added to `RemoteLink.Api.csproj`.

### 2. `ScreenClientTracker` — audio tracking
New fields: `_audioCount` (interlocked), `_audioConnections` (ConcurrentDictionary for per-connection tracking and disconnect cleanup).

### 3. `AudioCaptureService` (new — `Services/AudioCaptureService.cs`)
- Implements `IHostedService` (not `BackgroundService` — capture is event-driven, no loop needed)
- `WasapiLoopbackCapture.DataAvailable` → convert Float32 → Int16 → base64 → `hubContext.Clients.Group("audio").SendAsync("ReceiveAudio", ...)`
- `OnClientEnabled()` / `OnClientDisabled()` called by hub to start/stop WASAPI capture
- Registered as singleton + hosted service so it can be injected into ScreenHub

### 4. `ScreenHub` additions
- `EnableAudio()` — increments tracker audio count, adds connection to SignalR group "audio", calls `AudioCaptureService.OnClientEnabled()`
- `DisableAudio()` — inverse
- `OnDisconnectedAsync` — cleanup audio tracking if connection had audio enabled

### 5. `Program.cs`
Register `AudioCaptureService` as singleton and as hosted service.

---

## Client components (`Screen.tsx`)

### State
- `audioEnabled: boolean` — toggles UI button active state
- `audioCtxRef: useRef<AudioContext>` — Web Audio API context
- `nextPlayTimeRef: useRef<number>` — jitter buffer clock

### Toggle button
Speaker icon in toolbar. On click:
- **Enable:** `new AudioContext()` → `ctx.resume()` (required by iOS Safari) → call `EnableAudio` on hub
- **Disable:** `ctx.close()` → call `DisableAudio` on hub

### SignalR handler `ReceiveAudio`
Registered in the existing SignalR `useEffect`:
```
base64 → Uint8Array → Int16Array → AudioBuffer (Float32 channels) → AudioBufferSourceNode.start(nextPlayTime)
nextPlayTime += buffer.duration
```

### Jitter buffer logic
- `nextPlayTime` starts at `ctx.currentTime + 0.08` (80ms) on first chunk
- Each subsequent chunk scheduled immediately after previous (`nextPlayTime += duration`)
- If `nextPlayTime` falls behind `ctx.currentTime` (network stall/reconnect), reset with fresh 80ms head start
- No explicit queue needed — Web Audio API handles scheduling internally

### iOS Safari notes
- `AudioContext` must be created inside a user gesture handler (the toggle button tap) ✓
- `ctx.resume()` must be called explicitly — iOS often starts context in "suspended" state ✓
- No `AudioDecoder` needed — we use `createBuffer()` + `createBufferSource()` which are baseline Web Audio API, supported since iOS 9 ✓
- No codec dependency at all ✓

---

## Implementation order

1. `RemoteLink.Api.csproj` — add NAudio
2. `ScreenClientTracker.cs` — audio count + connection tracking
3. `AudioCaptureService.cs` — new file
4. `ScreenHub.cs` — EnableAudio / DisableAudio / disconnect cleanup
5. `Program.cs` — register service
6. `Screen.tsx` — state, toggle button, SignalR handler, jitter buffer
