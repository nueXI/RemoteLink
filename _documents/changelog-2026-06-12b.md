# RemoteLink — Changelog
_Date: 2026-06-12 (session 2)_

---

## Remote Control — Phone → PC

Added the ability to control the PC (mouse + keyboard) directly from the phone browser.

### New files

| File | Purpose |
|---|---|
| `RemoteLink.Api/Services/RemoteInputService.cs` | Wraps `SendInput` P/Invoke; handles mouse move, buttons, scroll, Unicode text typing, and virtual-key presses |

### Modified files

- `RemoteLink.Api/Hubs/ScreenHub.cs` — injected `RemoteInputService`; added five hub methods (`MouseMove`, `MouseButton`, `MouseScroll`, `KeyType`, `KeyPress`)
- `RemoteLink.Api/Program.cs` — registered `RemoteInputService` as singleton
- `RemoteLink.Client/src/components/Screen.tsx` — added touch gesture handling and keyboard bar
- `RemoteLink.Client/src/index.css` — added `.screen-keyboard-bar`, `.screen-kb-btn`, `.screen-keyboard-input`, `.screen-btn.active` styles

---

### How mouse control works

The screen viewer (`<div class="screen-viewer">`) now captures all pointer and touch events. Touch coordinates are measured against the rendered `<img>` element's bounding box (letterbox-aware) and converted to a 0–1 ratio before being sent to the hub.

```
Touch / mouse event
  → getRatios(clientX, clientY)   ← relative to rendered image, clamped 0–1
  → hub.invoke('MouseMove', ratioX, ratioY)
  → RemoteInputService.MoveMouse(ratioX, ratioY, screenIndex)
      → Screen.AllScreens[screenIndex].Bounds
      → physX = bounds.X + ratioX * bounds.Width
      → physY = bounds.Y + ratioY * bounds.Height
      → Normalize to virtual-screen 0–65535 using GetSystemMetrics SM_[XY]VIRTUALSCREEN
      → SendInput(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK)
```

`MOUSEEVENTF_VIRTUALDESK` is required for correct absolute positioning on multi-monitor setups; without it, absolute coordinates are only meaningful for the primary monitor.

### Touch gestures

| Gesture | Action |
|---|---|
| Tap (< 350ms, < 6px movement) | Left click at that position |
| Long press (600ms, no movement) | Right click at that position |
| Drag (1 finger) | Move mouse cursor |
| 2-finger vertical swipe | Mouse wheel scroll |

Mouse move events are throttled to ~60 fps (16ms minimum interval).

Desktop browsers also work: `onMouseMove`, `onMouseDown`, `onMouseUp`, `onWheel`, and `onContextMenu` (suppressed to avoid the browser menu stealing right-clicks).

The `<img>` element has `draggable={false}` to prevent accidental browser drag-and-drop. The viewer div has `touchAction: 'none'` (CSS `touch-action: none`) to stop browser scroll and pinch-zoom interfering with touch events. `cursor: none` hides the browser cursor when a frame is displayed — the real cursor is already drawn into the JPEG stream.

### Keyboard bar

A keyboard icon button in the screen toolbar toggles the keyboard bar. The bar contains:

- **Esc**, **Tab**, **⌫ Backspace**, **←**, **↑**, **↓**, **→** — each sends the corresponding Windows virtual key code via `KeyPress`
- **Text input** — uncontrolled input that sends its value via `KeyType` (Unicode `SendInput`) on every change and immediately clears, so the phone keyboard types directly into whatever app has focus on the PC
- **↵ Enter** button — sends VK `0x0D`

`onKeyDown` inside the text input also intercepts Backspace, Enter, Escape, Arrow keys, and Delete so those can be typed if the phone keyboard emits them as key events.

### SendInput implementation

All input is simulated via `user32.dll!SendInput`. Unicode text uses `KEYEVENTF_UNICODE` with `wScan` set to the character codepoint (no virtual key needed). Special keys use virtual key codes with `wVk`. Mouse absolute coordinates use `MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK` mapped to the virtual screen's 0–65535 range.

Multi-monitor absolute positioning:
```
normX = (physX - SM_XVIRTUALSCREEN) * 65535 / SM_CXVIRTUALSCREEN
normY = (physY - SM_YVIRTUALSCREEN) * 65535 / SM_CYVIRTUALSCREEN
```
