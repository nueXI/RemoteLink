# RemoteLink — Frontend Reference

## Build & Dev Setup

### `vite.config.ts`

```ts
build: {
  outDir: "../BackendPublish/wwwroot",  // output goes directly into the deploy folder
  emptyOutDir: true,                    // clears stale files before each build
}
server: {
  port: 5173,
  proxy: {
    "/api":  "http://localhost:5120",   // REST calls proxied to backend in dev
    "/hubs": { target: "...", ws: true } // WebSocket (SignalR) proxied in dev
  }
}
```

In **development** (`npm run dev`), the Vite dev server runs on `localhost:5173`. All `/api/*` and `/hubs/*` requests are proxied to the ASP.NET Core backend on `localhost:5120`. This avoids CORS issues and simulates the production single-origin setup.

In **production** (`npm run build`), the compiled output lands in `BackendPublish/wwwroot/`. Kestrel serves these static files directly — there is no separate frontend server.

### Build output

```
BackendPublish/wwwroot/
  index.html          ← entry point
  assets/
    index-[hash].js   ← all JS (React, SignalR, Axios, app code)
    index-[hash].css  ← all CSS
```

`INVALID_ANNOTATION` warnings from `@microsoft/signalr` are suppressed via the `onwarn` callback in `rollupOptions` — these come from the SignalR package itself and are harmless.

---

## Entry Point (`main.tsx`)

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

Standard React 19 entry. Mounts `<App />` into the `<div id="root">` in `index.html`. `StrictMode` is enabled — components render twice in development to surface side effects.

---

## API Layer (`src/api/`)

All API modules are thin wrappers. They do not hold state and do not use React hooks.

### `auth.ts` — Authentication

The token is stored in **`sessionStorage`** under the key `rl_token`. Using `sessionStorage` (not `localStorage`) means the session clears when the browser tab or window is closed, requiring re-login — appropriate for a local network tool.

```ts
getToken()    → string | null        // read from sessionStorage
setToken(t)   → void                 // write to sessionStorage
clearToken()  → void                 // remove from sessionStorage
login(pw)     → Promise<boolean>     // POST /api/auth/login, stores token on success
```

`login()` uses plain `axios` (not the authenticated `client`) because this is the unauthenticated endpoint.

### `client.ts` — Authenticated HTTP client

```ts
const client = axios.create();

client.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

An Axios instance with a request interceptor that automatically injects `Authorization: Bearer <token>` on every request. All API modules (except `auth.ts` for login) use this client.

### `files.ts` — File transfer

```ts
listFiles()                  → Promise<RemoteFile[]>   // GET /api/files
uploadFiles(fileList)        → Promise<void>            // POST /api/files/upload (multipart)
downloadUrl(fileName)        → string                   // /api/files/download/{name}?token=...
deleteFile(fileName)         → Promise<void>            // DELETE /api/files/{name}
```

`downloadUrl` is a synchronous helper (not async) that builds a URL with the token in the query string. This is used in an `<a href="..." download>` element — browsers cannot set custom headers on navigation requests, so the token goes in the query string instead.

`uploadFiles` wraps the `FileList` into a `FormData` with all files appended under the key `"files"`, then POSTs it. The backend iterates `form.Files` to receive all of them.

### `chat.ts` — Chat and logs

```ts
createChatConnection()       → HubConnection             // SignalR connection to /hubs/chat
getChatLogDates()            → Promise<string[]>         // GET /api/chat/logs
getChatLog(date)             → Promise<ChatMessage[]>    // GET /api/chat/logs/{date}
deleteChatLog(date)          → Promise<void>             // DELETE /api/chat/logs/{date}
```

`createChatConnection()` builds a SignalR `HubConnection` with `withAutomaticReconnect()`. The token is provided via `accessTokenFactory`, which SignalR appends as a query string parameter (`?access_token=...`) on the WebSocket URL — the standard SignalR auth pattern.

### `screen.ts` — Screen and remote control

```ts
export interface Monitor {
  index: number; width: number; height: number; primary: boolean; name: string;
}

export interface MonitorsResult {
  monitors: Monitor[];
  currentIndex: number;
  h264Available: boolean;
}

createScreenConnection()     → HubConnection             // SignalR connection to /hubs/screen
getMonitors()                → Promise<MonitorsResult>   // GET /api/screen/monitors
```

`getMonitors()` returns the full `MonitorsResult` including `h264Available`, which the `Screen` component uses to enable or disable the H.264 quality button.

The hub methods for remote control (`MouseMove`, `MouseButton`, etc.) are invoked directly on the `HubConnection` object in the `Screen` component — they are not wrapped here since they are not reused elsewhere.

---

## App Shell (`App.tsx`)

```tsx
const [authenticated, setAuthenticated] = useState(() => !!getToken());
const [tab, setTab] = useState<Tab>('chat');
const [senderName] = useState(() =>
  /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Phone' : 'PC'
);
```

### Authentication gate

The initial `authenticated` state is derived from whether a token already exists in `sessionStorage`. If the user previously logged in this session, they skip the login screen automatically on page load/refresh.

`<Login onSuccess={() => setAuthenticated(true)} />` is rendered when not authenticated. Once `login()` succeeds and the token is stored, `onSuccess` fires and the app state switches to authenticated, unmounting `Login` and mounting the main layout.

Logout calls `clearToken()` (removes from `sessionStorage`) then sets `authenticated` to `false`, returning to the login screen.

### Sender name detection

`senderName` is set once on mount from the user agent string. It is either `"Phone"` or `"PC"`. This string is used:
- In chat messages as the `sender` argument sent to the hub.
- In the header as the device badge.
- In chat to determine if a message is "own" (shown on the right).

The `senderName` state is initialized with a function (`useState(() => ...)`) so the UA check runs only once, not on every render.

### Tab switching

Three tabs: `chat`, `files`, `screen`. Switching tabs unmounts the previous component and mounts the new one. Each tab component manages its own connection and state independently.

```tsx
<main>
  {tab === 'chat' ? <Chat senderName={senderName} /> : tab === 'files' ? <Files /> : <Screen />}
</main>
```

---

## `Login.tsx`

Controlled form with three local state values: `password`, `error`, `loading`.

On submit:
1. Sets `loading = true`, clears `error`.
2. Calls `login(password)` from `api/auth.ts`.
3. If successful: calls `onSuccess()` prop (parent sets authenticated).
4. If failed: sets `error = "Wrong password. Try again."`.
5. Always sets `loading = false` when done.

The submit button is disabled while `loading` or while `password` is empty — prevents double-submits and submitting an empty form.

---

## `Chat.tsx`

### State

| State | Type | Purpose |
|---|---|---|
| `messages` | `ChatMessage[]` | All messages displayed in the current view |
| `input` | `string` | Current text in the message input field |
| `status` | connection state | SignalR connection state for status bar |
| `copiedIndex` | `number \| null` | Index of the message currently showing "Copied!" toast |
| `showLogs` | `boolean` | Whether the Logs panel is visible instead of the chat |
| `logDates` | `string[]` | List of available log dates fetched when Logs panel opens |
| `deletingDate` | `string \| null` | Date currently being deleted (disables its delete button) |

### Refs

| Ref | Purpose |
|---|---|
| `connectionRef` | Holds the `HubConnection` so event handlers can access it without re-renders |
| `bottomRef` | `<div>` at the bottom of the message list — scrolled to when messages change |
| `todayLoaded` | `boolean` flag so today's history is loaded only once (prevents double-load on StrictMode re-mount) |

### Connection lifecycle (`useEffect`)

```
mount:
  create connection
  register "ReceiveMessage" handler
  register reconnecting/reconnected/close handlers
  start connection
    → on success: set status connected, load today's log (once)
    → on failure: set status disconnected

unmount:
  stop connection
```

The connection is created and started inside a `useEffect` with an empty dependency array (`[]`), so it runs once when the component mounts. The cleanup function stops the connection when the component unmounts (e.g. when switching tabs).

### Today's log loading

```tsx
if (!todayLoaded.current) {
  todayLoaded.current = true;
  const today = new Date().toISOString().slice(0, 10);
  const history = await getChatLog(today);
  if (history.length > 0) setMessages(history);
}
```

`todayLoaded` is a `useRef` (not state) so setting it to `true` does not trigger a re-render. This prevents the log from being loaded twice if `connection.start()` fires twice (React StrictMode double-invokes effects in development).

### Message sending

```tsx
await connectionRef.current.invoke('SendMessage', senderName, input.trim());
setInput('');
```

`invoke` sends the method call to the hub and returns a Promise. The input is cleared immediately after invoking (before the message comes back via `ReceiveMessage`). The UI does not optimistically add the message — it only appears once the hub broadcasts it back, which ensures the timestamp is always the server-assigned one.

### Copy-to-clipboard

Each message bubble is clickable. On click, `navigator.clipboard.writeText(text)` copies the message text. `copiedIndex` is set to the clicked message's index, showing a "Copied!" toast positioned above the bubble. A `setTimeout` clears `copiedIndex` after 1500ms, hiding the toast.

### Logs panel

When the Logs button is clicked:
1. `getChatLogDates()` fetches the list of available dates from the API.
2. `showLogs` is set to `true`, replacing the message list with the logs panel.
3. Each date row shows the date (formatted as "Mon, Jun 12, 2026") and a Delete button.
4. Clicking Delete calls `deleteChatLog(date)`, removes the date from `logDates` state on success.
5. The Logs button toggles back to "Back" — clicking it returns to the live chat view.

The live chat input remains visible even when the logs panel is shown, so the user can still send messages.

---

## `Files.tsx`

### State

| State | Type | Purpose |
|---|---|---|
| `files` | `RemoteFile[]` | Current list of files on the server |
| `uploading` | `boolean` | Whether an upload is in progress |
| `error` | `string` | Error message, empty when no error |
| `dragOver` | `boolean` | Whether a file is being dragged over the drop zone |

### `inputRef`

Points to a hidden `<input type="file" multiple>` element. Clicking the Upload button or the drop zone calls `inputRef.current?.click()` to trigger the file picker.

### File loading

`refresh()` calls `listFiles()` and updates `files` state. Called once on mount via `useEffect`, and again after each upload or delete.

### Upload flow

```
handleUpload(fileList):
  setUploading(true)
  uploadFiles(fileList)   ← POST multipart to /api/files/upload
  refresh()               ← reload file list
  setUploading(false)
  clear input value       ← allows re-uploading the same file
```

Triggered from:
- The hidden file input's `onChange` event (clicking Upload button → file picker → select files).
- The drop zone's `onDrop` event (drag-and-drop).

### Drag-and-drop

```
onDragOver  → e.preventDefault() + setDragOver(true)   ← shows highlighted state
onDragLeave → setDragOver(false)
onDrop      → e.preventDefault() + handleUpload(e.dataTransfer.files)
```

`e.preventDefault()` in `onDragOver` is required to allow `onDrop` to fire (browser default behavior for drag-over is "not droppable").

### Download

```tsx
<a href={downloadUrl(file.name)} download={file.name}>Download</a>
```

`downloadUrl` builds `/api/files/download/{name}?token=<password>`. The `download` attribute on the `<a>` element prompts the browser to save the file instead of navigating to it. The token in the URL is validated by the auth middleware on the backend.

### File type icons

`fileIconClass(name)` maps file extensions to CSS class names: `file-icon-img`, `file-icon-video`, `file-icon-audio`, `file-icon-doc`, `file-icon-zip`, `file-icon-other`. Each class has a different background and foreground color. The `FileIcon` component renders the appropriate SVG icon inside a colored circle.

---

## `Screen.tsx`

### State

| State | Type | Purpose |
|---|---|---|
| `frame` | `string \| null` | Current base64 JPEG frame (JPEG mode only), `null` before first frame |
| `status` | connection state | SignalR connection status |
| `monitors` | `Monitor[]` | List of detected displays |
| `activeScreen` | `number` | Currently selected monitor index |
| `fps` | `number` | Frames per second in last 1-second window |
| `isFullscreen` | `boolean` | Whether the viewer is in fullscreen mode |
| `forcedLandscape` | `boolean` | CSS rotation fallback when `screen.orientation.lock` is unavailable |
| `showKeyboard` | `boolean` | Whether the keyboard control bar is visible |
| `controlMode` | `'view' \| 'control'` | Whether touch/mouse events are forwarded to the PC |
| `zoom` | `number` | Current pinch-zoom level (1 = no zoom, max 5) |
| `pan` | `{ x, y }` | Current pan offset in pixels |
| `streamMode` | `'jpeg' \| 'h264'` | Active stream encoding mode |
| `h264Available` | `boolean` | Whether the server has a working H.264 encoder |
| `h264HasFrame` | `boolean` | Whether the H.264 canvas has received at least one decoded frame |
| `decoderVersion` | `number` | Incremented to force VideoDecoder recreation (e.g. on reconnect) |
| `supportsH264` | `boolean` | Computed once: `typeof VideoDecoder !== 'undefined'` |

### Refs

| Ref | Purpose |
|---|---|
| `connectionRef` | The `HubConnection` — used by event handlers and gesture handlers |
| `viewerRef` | The `.screen-viewer` div — used for fullscreen, coordinate mapping, and zoom/pan |
| `kbInputRef` | The keyboard bar text input — focused programmatically when keyboard bar opens |
| `canvasRef` | The `<canvas>` element where H.264 decoded frames are drawn |
| `decoderRef` | The active `VideoDecoder` instance — kept in a ref so SignalR handlers access the current one |
| `frameCountRef` | Frame counter for FPS calculation (not state — no re-render on increment) |
| `lastFpsRef` | Timestamp of last FPS calculation window |
| `controlModeRef` | Mirrors `controlMode` state — stale-closure-safe for touch/mouse handlers |
| `activeScreenRef` | Mirrors `activeScreen` state — used in reconnect handler |
| `zoomRef` | Mirrors `zoom` state — used in touch handlers |
| `panRef` | Mirrors `pan` state — used in touch handlers |
| `streamModeRef` | Mirrors `streamMode` state — used in reconnect handler |
| `touchRef` | Current single-touch state `{x, y, time, moved}` |
| `longPressRef` | `setTimeout` handle for the right-click long-press timer |
| `lastMoveRef` | Timestamp of last `MouseMove` hub call — used for throttling |
| `pinchRef` | Pinch state `{dist, midX, midY}` — used for zoom/pan on two-finger gesture |

### Mirror refs

Several refs exist solely to give stale-closure-safe access to the latest state values inside `setTimeout` callbacks and SignalR message handlers. The pattern is:

```tsx
const [controlMode, setControlMode] = useState<'view' | 'control'>('view');
const controlModeRef = useRef<'view' | 'control'>('view');
useEffect(() => { controlModeRef.current = controlMode; }, [controlMode]);
```

The `useEffect` keeps the ref in sync whenever the state changes. Handlers read from the ref instead of closing over the state directly.

### FPS counter

Every received frame (both JPEG and H.264) increments `frameCountRef.current` (a ref, not state — no re-render). Every 1000ms the frame count is moved to the `fps` state (which does cause a re-render to update the display), then the counter and timestamp are reset.

### Monitor switching

`getMonitors()` is fetched once on mount. If more than one monitor is returned, a `<select>` dropdown appears in the toolbar. Changing the selection:
1. Sets `activeScreen` state (updates the displayed value).
2. Invokes `SelectScreen(index)` on the hub (tells the backend to switch the capture target).

### Stream mode (JPEG / H.264)

The H.264 quality button is shown in the toolbar. Its enabled/disabled state:

- **`qualityDisabled = !h264Available || !supportsH264`**
  - `h264Available` — set from the `GET /api/screen/monitors` response. `false` if the server has no FFmpeg or no encoder initialized.
  - `supportsH264` — computed once on mount: `typeof VideoDecoder !== 'undefined'`. This is `false` on Firefox (no WebCodecs support) and on any browser when the page is served over plain HTTP (WebCodecs requires a secure context — HTTPS or localhost).

When disabled, the button shows:
- `"H.264 ✗"` with tooltip `"H.264 requires WebCodecs (use Chrome)"` — when `supportsH264` is false.
- `"H.264 ?"` with tooltip `"H.264 encoder not available on server"` — when server has no encoder.

When enabled and clicked, `toggleStreamMode()`:
1. Flips `streamMode` between `'jpeg'` and `'h264'`.
2. Updates `streamModeRef.current` immediately (not waiting for the `useEffect` sync).
3. Invokes `SelectMode(mode)` on the hub.
4. If switching back to JPEG, clears `h264HasFrame` so the canvas placeholder reappears if H.264 is enabled again later.

### VideoDecoder lifecycle

A `useEffect` keyed on `[streamMode, decoderVersion, supportsH264]` manages the `VideoDecoder` instance:

```
if streamMode !== 'h264' or !supportsH264:
  decoderRef.current = null
  return

setH264HasFrame(false)
create new VideoDecoder({
  output: (videoFrame) → draw to canvas, setH264HasFrame(true), videoFrame.close()
  error:  (err)        → console.error
})
decoderRef.current = decoder

cleanup: decoderRef.current = null; decoder.close()
```

The decoder is not configured here — `VideoDecoder.configure()` requires the codec string, which is only known once the first keyframe arrives from the server. Configuration happens in the `ReceiveH264Frame` handler.

`decoderVersion` is a counter that can be incremented to force decoder recreation (e.g. on reconnect). This is needed because a `VideoDecoder` is bound to a specific codec configuration; after reconnecting, the server starts a fresh encoding session and the decoder must be recreated to avoid state mismatch.

### `ReceiveH264Frame` handler

```
frameCountRef++ (FPS counter)

decoder = decoderRef.current
if no decoder or decoder.state === 'closed': return

if isKeyFrame and codecStr and decoder.state === 'unconfigured':
    decoder.configure({ codec: codecStr, optimizeForLatency: true })

if decoder.state !== 'configured': return   ← still unconfigured, waiting for keyframe

if decoder.decodeQueueSize > 2:
    decoder.reset()                          ← safe state reset, doesn't corrupt GOP
    invoke SelectMode('h264')               ← trigger fresh IDR + codec string from server
    return

decode new EncodedVideoChunk({ type: isKeyFrame ? 'key' : 'delta', data: bytes, timestamp })
```

**Why `decoder.reset()` instead of dropping frames:** Silently dropping delta frames when the queue is full corrupts the decoder — subsequent frames reference the dropped frames and cannot decode. `decoder.reset()` puts the decoder back to `'unconfigured'` state cleanly, and re-invoking `SelectMode('h264')` triggers the backend to request a new keyframe, which carries the codec string needed to re-configure.

**Why `optimizeForLatency: true`:** Signals to the browser decoder to minimize output buffering. Without it, some implementations hold decoded frames to improve ordering, adding latency.

### Reconnect handling

On `onreconnected`:
1. Re-invokes `SelectScreen(activeScreenRef.current)` to restore the selected monitor.
2. If `streamModeRef.current === 'h264'`, re-invokes `SelectMode('h264')` and increments `decoderVersion` to recreate the `VideoDecoder`.

### View element (JPEG vs H.264)

```tsx
{isH264Mode ? (
  <>
    <canvas ref={canvasRef} className="screen-frame"
            style={{ display: h264HasFrame ? 'block' : 'none' }} />
    {!h264HasFrame && <div className="screen-placeholder">…Waiting for H.264 keyframe…</div>}
  </>
) : frame ? (
  <img className="screen-frame" src={`data:image/jpeg;base64,${frame}`} … />
) : (
  <div className="screen-placeholder">…</div>
)}
```

In H.264 mode the `<canvas>` is hidden (not removed) until the first frame arrives, to avoid a layout flash when `canvas.width/height` are set on the first decoded frame. In JPEG mode, a plain `<img>` is updated by setting its `src` to the latest base64 JPEG.

### Fullscreen and orientation

`toggleFullscreen()` calls `viewerRef.current.requestFullscreen()` then attempts `screen.orientation.lock('landscape')`. If orientation lock is not supported (Firefox, iOS), it falls back to `setForcedLandscape(true)` which applies a CSS rotation transform to the inner content.

The `isFullscreen` state is driven by a `fullscreenchange` DOM event listener (not by `toggleFullscreen` directly) so it stays accurate regardless of how fullscreen exits — button, Escape key, or browser gesture. On exit, `forcedLandscape` and zoom/pan are reset.

### Zoom and pan

- **Pinch gesture** (two fingers): adjusts `zoom` (1–5) and `pan` based on the pinch midpoint movement.
- **`clampedPan(x, y, z)`**: restricts pan so the zoomed content cannot be panned beyond its edges (prevents empty space from showing).
- **Zoom reset button**: appears in the toolbar when `zoom > 1`. Resets both zoom and pan to defaults.
- Pan is only applied via CSS transform (`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`), not by adjusting any layout properties.
- Single-finger drag at `zoom > 1` pans the view instead of sending mouse move events.

### Touch gesture system

#### Touch start
```
single finger:
  record {x, y, time: now, moved: false}
  start 600ms long-press timer → right-click at start position if not moved

two fingers:
  record {dist, midX, midY} for pinch/pan tracking
```

#### Touch move
```
two fingers:
  if not forcedLandscape:
    compute new zoom from distance ratio
    compute new pan from midpoint delta
    clamp pan to bounds

single finger:
  if movement > 6px from start: mark as moved, cancel long-press timer
  if zoom > 1 and not forcedLandscape: pan instead of mouse move
  else if time since last move > 16ms: invoke MouseMove(ratioX, ratioY)
```

`e.preventDefault()` is called in `handleTouchMove` to stop the browser from scrolling the page while the user is controlling the mouse.

#### Touch end
```
cancel long-press timer
if single touch, not moved, elapsed < 350ms, zoom == 1: left-click at start position
```

The long-press right-click fires via the `setTimeout` in touch start (at 600ms), not in touch end, so the right-click happens while the finger is still down — matching the native long-press feel.

#### Coordinate mapping (`getRatios`)

```tsx
if (forcedLandscape) {
  // coordinates are rotated 90° — swap and invert as needed
  ratioX = 1 - (clientY - rect.top)  / rect.height
  ratioY =     (clientX - rect.left) / rect.width
} else {
  const el2    = el.querySelector('.screen-frame') as HTMLElement | null;
  const bounds = el2 ? el2.getBoundingClientRect() : rect;
  ratioX = clamp((clientX - bounds.left) / bounds.width,  0, 1)
  ratioY = clamp((clientY - bounds.top)  / bounds.height, 0, 1)
}
```

The screen image/canvas is letterboxed inside the viewer div. Touching the black bar area would produce out-of-bounds coordinates. By measuring the `.screen-frame` element's actual bounding rect (not the container div), touch coordinates are measured within the content bounds and clamped to 0–1. `getBoundingClientRect` on the transformed element naturally accounts for the current zoom/pan transform.

#### Desktop mouse

For desktop browsers (or when testing from a PC):
- `onMouseMove` → `MouseMove` hub call
- `onMouseDown` / `onMouseUp` → `MouseButton` hub call (button 0/1/2 mapped from `e.button`)
- `onWheel` → `MouseScroll` with `delta = -Math.sign(e.deltaY) * 120` (sign flipped: browser wheel down → positive `deltaY` → negative scroll → hub receives negative = scroll down)
- `onContextMenu` → `e.preventDefault()` to suppress the browser's own context menu on right-click

`cursor: none` is set on the viewer when in control mode and a frame is loaded — the local cursor is hidden since the real cursor position is visible inside the stream.

### Keyboard bar

Toggled by the keyboard icon button in the toolbar (only enabled when in control mode). Opens a fixed bar below the stream.

**Special key buttons** send VK codes directly:

| Button | VK code | Purpose |
|---|---|---|
| Esc | 0x1B | Escape key |
| Tab | 0x09 | Tab key |
| ⌫ | 0x08 | Backspace |
| ← ↑ ↓ → | 0x25–0x28 | Arrow keys |
| ↵ | 0x0D | Enter |

Each button calls `sendVk(vk)` which invokes `KeyPress` on the hub then re-focuses the text input, keeping the keyboard open on mobile.

**Text input** is uncontrolled. On every `onChange`:
1. The current value is sent to `KeyType` hub method (types it on the PC via Unicode SendInput).
2. `e.target.value` is set to `''` immediately — the input stays visually empty.

This means each keystroke (including multi-character swipe input from phone keyboards) is sent to the PC and the field clears. The field appears empty at all times, which is intentional — the user is not composing in the field, they're sending directly to the PC.

`onKeyDown` intercepts Backspace, Enter, Tab, Escape, and arrow keys within the input and sends their VK codes instead of letting them modify the field value. This ensures special keys typed on a Bluetooth keyboard (if connected to the phone) are forwarded correctly.

---

## Styling (`index.css`)

A single CSS file with no external CSS framework. Uses CSS custom properties (variables) for the design system:

```css
:root {
  --bg:            #07070f;   /* page background */
  --surface:       #0f0f1c;   /* card/panel background */
  --surface-2:     #161626;   /* inputs, secondary surfaces */
  --accent:        #7c6ff7;   /* primary purple */
  --accent-2:      #5b7fff;   /* secondary blue */
  --accent-grad:   linear-gradient(135deg, #5b7fff 0%, #7c6ff7 100%);
  --text:          #9899b0;   /* body text */
  --text-heading:  #eeeef5;   /* headings, labels */
  --success:       #34d399;   /* green — connected state */
  --warning:       #fbbf24;   /* yellow — connecting state */
  --danger:        #f87171;   /* red — disconnected/error state */
}
```

### Layout approach

The app uses a full-viewport flex column:

```
#root / .app              height: 100svh, flex column
  .app-header             height: 56px, flex-shrink: 0
  main                    flex: 1, overflow: hidden, min-height: 0
    (active tab content)  flex: 1
```

`min-height: 0` on `main` is required because in a flex column, `flex: 1` children default to `min-height: auto` (their content size), which prevents them from shrinking below their content height. Setting `min-height: 0` allows the children to shrink to fill exactly the remaining viewport.

The same `min-height: 0` is applied to `.screen-panel` for the same reason — otherwise the screen viewer would overflow on mobile.

### Responsive breakpoints

| Breakpoint | Changes |
|---|---|
| Default (mobile) | Single column, compact padding, icon-only buttons |
| `640px+` | More padding on chat, files |
| `1024px+` | Chat constrained to 760px centered, files in 2-column grid |
| `1280px+` | Files in 3-column grid |
| `max-width: 480px` | App title hidden, device badge hidden, button labels hidden |

### Screen viewer specific styles

```css
.screen-viewer {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;        /* black letterbox bars */
}

.screen-frame {
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  display: block;
}
```

The image/canvas is centered in the viewer with letterboxing. `max-width/max-height: 100%` with `width/height: auto` lets it scale down to fit while maintaining aspect ratio. The viewer's black background fills the bars.

### H.264 quality button styles

```css
.screen-quality-btn { ... }           /* base style */
.screen-quality-btn.active { ... }    /* highlighted when H.264 mode is active */
```

The button is a fixed-size text button in the toolbar. The `.active` class applies the accent color to indicate H.264 mode is on. When disabled, the browser's default disabled styling applies.
