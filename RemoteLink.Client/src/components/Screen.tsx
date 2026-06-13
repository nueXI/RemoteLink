import { useEffect, useRef, useState } from 'react';
import * as signalR from '@microsoft/signalr';
import { createScreenConnection, getMonitors, type Monitor, type MonitorsResult } from '../api/screen';

const VK: Record<string, number> = {
  Backspace: 0x08, Tab: 0x09, Enter: 0x0D, Escape: 0x1B,
  ArrowLeft: 0x25, ArrowUp: 0x26, ArrowRight: 0x27, ArrowDown: 0x28,
  Delete: 0x2E,
};

export default function Screen() {
  const [frame, setFrame]               = useState<string | null>(null);
  const [status, setStatus]             = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [monitors, setMonitors]         = useState<Monitor[]>([]);
  const [activeScreen, setActiveScreen] = useState(0);
  const [fps, setFps]                   = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [forcedLandscape, setForcedLandscape] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [controlMode, setControlMode]   = useState<'view' | 'control'>('view');
  const [zoom, setZoom]                 = useState(1);
  const [pan, setPan]                   = useState({ x: 0, y: 0 });
  const [streamMode, setStreamMode]     = useState<'jpeg' | 'h264'>('jpeg');
  const [h264Available, setH264Available] = useState(false);
  const [h264HasFrame, setH264HasFrame] = useState(false);
  const [decoderVersion, setDecoderVersion] = useState(0);

  // stable computed once — no setter needed
  const [supportsH264]  = useState(() => typeof VideoDecoder !== 'undefined');

  const connectionRef    = useRef<signalR.HubConnection | null>(null);
  const viewerRef        = useRef<HTMLDivElement>(null);
  const kbInputRef       = useRef<HTMLInputElement>(null);
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const decoderRef       = useRef<VideoDecoder | null>(null);
  const frameCountRef    = useRef(0);
  const lastFpsRef       = useRef(Date.now());

  // Refs that mirror state for stale-closure-safe use inside setTimeout / SignalR handlers
  const controlModeRef   = useRef<'view' | 'control'>('view');
  const activeScreenRef  = useRef(0);
  const zoomRef          = useRef(1);
  const panRef           = useRef({ x: 0, y: 0 });
  const streamModeRef    = useRef<'jpeg' | 'h264'>('jpeg');

  // Touch state
  const touchRef    = useRef<{ x: number; y: number; time: number; moved: boolean } | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMoveRef  = useRef(0);
  const pinchRef    = useRef<{ dist: number; midX: number; midY: number } | null>(null);

  useEffect(() => { controlModeRef.current = controlMode; },  [controlMode]);
  useEffect(() => { activeScreenRef.current = activeScreen; }, [activeScreen]);
  useEffect(() => { zoomRef.current = zoom; },               [zoom]);
  useEffect(() => { panRef.current = pan; },                 [pan]);
  useEffect(() => { streamModeRef.current = streamMode; },   [streamMode]);

  useEffect(() => {
    getMonitors().then(({ monitors: mons, currentIndex, h264Available: avail }: MonitorsResult) => {
      setMonitors(mons);
      setActiveScreen(currentIndex);
      activeScreenRef.current = currentIndex;
      setH264Available(avail);
    }).catch(() => {});
  }, []);

  // ── SignalR connection ────────────────────────────────────────────────────

  useEffect(() => {
    const connection = createScreenConnection();
    connectionRef.current = connection;
    let h264Ts = 0;

    connection.on('ReceiveFrame', (data: string) => {
      setFrame(data);
      frameCountRef.current++;
      const now = Date.now();
      if (now - lastFpsRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFpsRef.current = now;
      }
    });

    connection.on('ReceiveH264Frame', (base64: string, isKeyFrame: boolean, codecStr: string | null) => {
      frameCountRef.current++;
      const nowH = Date.now();
      if (nowH - lastFpsRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFpsRef.current = nowH;
      }

      const decoder = decoderRef.current;
      if (!decoder || decoder.state === 'closed') return;

      if (isKeyFrame && codecStr && decoder.state === 'unconfigured') {
        decoder.configure({ codec: codecStr, optimizeForLatency: true });
      }
      if (decoder.state !== 'configured') return;

      // Queue growing means we're falling behind — reset cleanly and re-request a keyframe.
      // Unlike silently dropping delta frames (which corrupts decoder state), reset() is safe.
      if (decoder.decodeQueueSize > 2) {
        decoder.reset();
        connectionRef.current?.invoke('SelectMode', 'h264').catch(() => {});
        return;
      }

      const binary = atob(base64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      decoder.decode(new EncodedVideoChunk({
        type:      isKeyFrame ? 'key' : 'delta',
        data:      bytes,
        timestamp: h264Ts++,
      }));
    });

    connection.onreconnecting(() => setStatus('connecting'));

    connection.onreconnected(() => {
      setStatus('connected');
      connection.invoke('SelectScreen', activeScreenRef.current).catch(() => {});
      if (streamModeRef.current === 'h264') {
        connection.invoke('SelectMode', 'h264').catch(() => {});
        setDecoderVersion(v => v + 1); // recreate decoder; old one is stale
      }
    });

    connection.onclose(() => setStatus('disconnected'));

    connection.start()
      .then(() => {
        setStatus('connected');
        connection.invoke('SelectScreen', activeScreenRef.current).catch(() => {});
      })
      .catch(() => setStatus('disconnected'));

    return () => { connection.stop(); };
  }, []);

  // ── VideoDecoder lifecycle ────────────────────────────────────────────────

  useEffect(() => {
    if (streamMode !== 'h264' || !supportsH264) {
      decoderRef.current = null;
      return;
    }

    setH264HasFrame(false);

    const decoder = new VideoDecoder({
      output: (videoFrame: VideoFrame) => {
        const canvas = canvasRef.current;
        try {
          if (canvas) {
            if (canvas.width  !== videoFrame.displayWidth ||
                canvas.height !== videoFrame.displayHeight) {
              canvas.width  = videoFrame.displayWidth;
              canvas.height = videoFrame.displayHeight;
            }
            canvas.getContext('2d')?.drawImage(videoFrame, 0, 0);
            setH264HasFrame(true);
          }
        } finally {
          videoFrame.close();
        }
      },
      error: (err: DOMException) => {
        console.error('VideoDecoder error', err);
      },
    });

    decoderRef.current = decoder;
    return () => {
      decoderRef.current = null;
      if (decoder.state !== 'closed') decoder.close();
    };
  }, [streamMode, decoderVersion, supportsH264]);

  // ── Fullscreen change ─────────────────────────────────────────────────────

  useEffect(() => {
    const handler = () => {
      const active = !!document.fullscreenElement;
      setIsFullscreen(active);
      if (!active) {
        setForcedLandscape(false);
        resetZoomPan();
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── Zoom / pan ────────────────────────────────────────────────────────────

  function resetZoomPan() {
    zoomRef.current = 1;
    panRef.current  = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function clampedPan(x: number, y: number, z: number) {
    const viewer = viewerRef.current;
    if (!viewer || z <= 1) return { x: 0, y: 0 };
    const maxX = viewer.clientWidth  * (z - 1) / 2;
    const maxY = viewer.clientHeight * (z - 1) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }

  // ── Screen / mode selection ───────────────────────────────────────────────

  function selectScreen(index: number) {
    setActiveScreen(index);
    connectionRef.current?.invoke('SelectScreen', index);
  }

  function toggleStreamMode() {
    const newMode = streamMode === 'jpeg' ? 'h264' : 'jpeg';
    setStreamMode(newMode);
    streamModeRef.current = newMode;
    connectionRef.current?.invoke('SelectMode', newMode).catch(() => {});
    if (newMode === 'jpeg') setH264HasFrame(false);
  }

  // ── Fullscreen ────────────────────────────────────────────────────────────

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await viewerRef.current?.requestFullscreen();
      try {
        await screen.orientation.lock('landscape');
      } catch {
        // Firefox/iOS don't support orientation lock; rotate content via CSS instead
        resetZoomPan();
        setForcedLandscape(true);
      }
    } else {
      try { screen.orientation.unlock(); } catch { /* ignore */ }
      setForcedLandscape(false);
      resetZoomPan();
      document.exitFullscreen();
    }
  }

  // ── Mouse / coordinate helpers ────────────────────────────────────────────

  function getRatios(clientX: number, clientY: number): { ratioX: number; ratioY: number } | null {
    const el = viewerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();

    if (forcedLandscape) {
      const ratioX = Math.max(0, Math.min(1, 1 - (clientY - rect.top)  / rect.height));
      const ratioY = Math.max(0, Math.min(1,     (clientX - rect.left) / rect.width));
      return { ratioX, ratioY };
    }

    // getBoundingClientRect on the img/canvas accounts for scale/pan transform naturally
    const el2    = el.querySelector('.screen-frame') as HTMLElement | null;
    const bounds = el2 ? el2.getBoundingClientRect() : rect;
    const ratioX = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    const ratioY = Math.max(0, Math.min(1, (clientY - bounds.top)  / bounds.height));
    return { ratioX, ratioY };
  }

  function sendMouseMove(clientX: number, clientY: number) {
    if (controlModeRef.current !== 'control') return;
    const ratios = getRatios(clientX, clientY);
    if (ratios) connectionRef.current?.invoke('MouseMove', ratios.ratioX, ratios.ratioY);
  }

  function sendClick(clientX: number, clientY: number, button: number) {
    if (controlModeRef.current !== 'control') return;
    const ratios = getRatios(clientX, clientY);
    if (!ratios) return;
    const conn = connectionRef.current;
    conn?.invoke('MouseMove', ratios.ratioX, ratios.ratioY);
    conn?.invoke('MouseButton', button, true);
    setTimeout(() => conn?.invoke('MouseButton', button, false), 50);
  }

  // ── Touch helpers ─────────────────────────────────────────────────────────

  function getDist(t1: React.Touch, t2: React.Touch) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ── Touch handlers ────────────────────────────────────────────────────────

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
      touchRef.current = null;
      const [t1, t2] = [e.touches[0], e.touches[1]];
      pinchRef.current = {
        dist: getDist(t1, t2),
        midX: (t1.clientX + t2.clientX) / 2,
        midY: (t1.clientY + t2.clientY) / 2,
      };
      return;
    }
    if (e.touches.length !== 1) return;

    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now(), moved: false };

    longPressRef.current = setTimeout(() => {
      if (touchRef.current && !touchRef.current.moved) {
        sendClick(touchRef.current.x, touchRef.current.y, 1);
        touchRef.current = null;
      }
    }, 600);
  }

  function handleTouchMove(e: React.TouchEvent) {
    e.preventDefault();

    if (e.touches.length === 2) {
      const [t1, t2] = [e.touches[0], e.touches[1]];
      const newDist = getDist(t1, t2);
      const newMidX = (t1.clientX + t2.clientX) / 2;
      const newMidY = (t1.clientY + t2.clientY) / 2;

      if (pinchRef.current && !forcedLandscape) {
        const newZoom = Math.max(1, Math.min(5, zoomRef.current * (newDist / pinchRef.current.dist)));
        const dx = newMidX - pinchRef.current.midX;
        const dy = newMidY - pinchRef.current.midY;
        const newPan = clampedPan(panRef.current.x + dx, panRef.current.y + dy, newZoom);
        zoomRef.current = newZoom;
        panRef.current  = newPan;
        setZoom(newZoom);
        setPan(newPan);
        pinchRef.current = { dist: newDist, midX: newMidX, midY: newMidY };
      }
      return;
    }

    if (!touchRef.current || e.touches.length !== 1) return;
    const t  = e.touches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;

    if (!touchRef.current.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      touchRef.current.moved = true;
      if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    }

    if (zoomRef.current > 1 && !forcedLandscape) {
      const newPan = clampedPan(panRef.current.x + dx, panRef.current.y + dy, zoomRef.current);
      panRef.current = newPan;
      touchRef.current = { ...touchRef.current, x: t.clientX, y: t.clientY };
      setPan(newPan);
      return;
    }

    const now = Date.now();
    if (now - lastMoveRef.current > 16) {
      lastMoveRef.current = now;
      sendMouseMove(t.clientX, t.clientY);
    }
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    if (e.touches.length < 2) pinchRef.current = null;

    const state = touchRef.current;
    touchRef.current = null;
    if (!state) return;
    const elapsed = Date.now() - state.time;
    if (!state.moved && elapsed < 350 && zoomRef.current === 1) {
      sendClick(state.x, state.y, 0);
    }
    void e;
  }

  // ── Desktop mouse ─────────────────────────────────────────────────────────

  function handleMouseMove(e: React.MouseEvent) {
    if (controlModeRef.current !== 'control') return;
    sendMouseMove(e.clientX, e.clientY);
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (controlModeRef.current !== 'control') return;
    const button = e.button === 2 ? 1 : e.button === 1 ? 2 : 0;
    const ratios = getRatios(e.clientX, e.clientY);
    if (ratios) connectionRef.current?.invoke('MouseButton', button, true);
  }

  function handleMouseUp(e: React.MouseEvent) {
    if (controlModeRef.current !== 'control') return;
    const button = e.button === 2 ? 1 : e.button === 1 ? 2 : 0;
    const ratios = getRatios(e.clientX, e.clientY);
    if (ratios) connectionRef.current?.invoke('MouseButton', button, false);
  }

  function handleWheel(e: React.WheelEvent) {
    if (controlModeRef.current !== 'control') return;
    e.preventDefault();
    const delta = -Math.sign(e.deltaY) * 120;
    connectionRef.current?.invoke('MouseScroll', delta);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
  }

  // ── Keyboard bar ──────────────────────────────────────────────────────────

  function handleKbChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (controlModeRef.current !== 'control') { e.target.value = ''; return; }
    const text = e.target.value;
    if (text) {
      connectionRef.current?.invoke('KeyType', text);
      e.target.value = '';
    }
  }

  function handleKbKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (controlModeRef.current !== 'control') return;
    const vk = VK[e.key];
    if (vk) {
      e.preventDefault();
      connectionRef.current?.invoke('KeyPress', vk);
    }
  }

  function sendVk(vk: number) {
    if (controlModeRef.current !== 'control') return;
    connectionRef.current?.invoke('KeyPress', vk);
    kbInputRef.current?.focus();
  }

  // ─────────────────────────────────────────────────────────────────────────

  const statusLabel =
    status === 'connected'  ? 'Live' :
    status === 'connecting' ? 'Connecting…' : 'Disconnected';

  const isControl    = controlMode === 'control';
  const isH264Mode   = streamMode === 'h264' && supportsH264;
  const hasAnyFrame  = isH264Mode ? h264HasFrame : !!frame;
  const qualityDisabled = !h264Available || !supportsH264;

  const viewerCursor =
    isControl && hasAnyFrame ? 'none' :
    zoom > 1                 ? 'grab' : undefined;

  const innerStyle = forcedLandscape ? undefined : {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
  };

  return (
    <div className="screen-panel">
      <div className="screen-toolbar">
        <div className="screen-status" data-status={status}>
          <span className="status-dot" />
          {statusLabel}
        </div>

        {monitors.length > 1 && (
          <select
            className="screen-monitor-select"
            value={activeScreen}
            onChange={(e) => selectScreen(Number(e.target.value))}
          >
            {monitors.map((m) => (
              <option key={m.index} value={m.index}>
                {m.name}{m.primary ? ' ●' : ''}
              </option>
            ))}
          </select>
        )}

        <div className="screen-toolbar-right">
          {status === 'connected' && hasAnyFrame && (
            <span className="screen-fps">{fps} fps</span>
          )}

          {zoom > 1 && (
            <button className="screen-btn" onClick={resetZoomPan} title="Reset zoom">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
            </button>
          )}

          <button
            className={`screen-btn screen-quality-btn${isH264Mode ? ' active' : ''}`}
            onClick={toggleStreamMode}
            disabled={qualityDisabled}
            title={qualityDisabled
              ? (!supportsH264 ? 'H.264 requires WebCodecs (use Chrome)' : 'H.264 encoder not available on server')
              : (isH264Mode ? 'Switch to JPEG' : 'Switch to H.264')}
          >
            {qualityDisabled
              ? (!supportsH264 ? 'H.264 ✗' : 'H.264 ?')
              : 'H.264'}
          </button>

          <button
            className={`screen-btn screen-mode-btn${isControl ? ' active' : ''}`}
            onClick={() => setControlMode(m => m === 'view' ? 'control' : 'view')}
            title={isControl ? 'Switch to View mode' : 'Switch to Control mode'}
          >
            {isControl ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 9l4 4 10-10" />
                <rect x="2" y="2" width="20" height="20" rx="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>

          <button
            className={`screen-btn${showKeyboard ? ' active' : ''}`}
            onClick={() => { setShowKeyboard(v => !v); setTimeout(() => kbInputRef.current?.focus(), 50); }}
            title="Keyboard"
            disabled={!isControl}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
            </svg>
          </button>

          <button
            className="screen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="8 3 3 3 3 8" />
                <polyline points="21 8 21 3 16 3" />
                <polyline points="3 16 3 21 8 21" />
                <polyline points="16 21 21 21 21 16" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {!isControl && (
        <div className="screen-view-banner">View only — tap the eye icon to take control</div>
      )}

      <div
        className="screen-viewer"
        ref={viewerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        style={{ touchAction: 'none', cursor: viewerCursor }}
      >
        <div
          className={`screen-inner${forcedLandscape ? ' forced-landscape' : ''}`}
          style={innerStyle}
        >
          {isH264Mode ? (
            <>
              <canvas
                ref={canvasRef}
                className="screen-frame"
                style={{ display: h264HasFrame ? 'block' : 'none' }}
              />
              {!h264HasFrame && (
                <div className="screen-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8M12 17v4" />
                  </svg>
                  <p>{status === 'connecting' ? 'Connecting to stream…' : 'Waiting for H.264 keyframe…'}</p>
                </div>
              )}
            </>
          ) : frame ? (
            <img
              className="screen-frame"
              src={`data:image/jpeg;base64,${frame}`}
              alt="PC Screen"
              draggable={false}
            />
          ) : (
            <div className="screen-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              <p>
                {status === 'connecting' ? 'Connecting to stream…' :
                 status === 'connected'  ? 'Waiting for first frame…' :
                 'Stream unavailable'}
              </p>
              {status === 'disconnected' && (
                <small>Set the Task Scheduler task to run in your user session (not elevated).</small>
              )}
            </div>
          )}
        </div>
      </div>

      {showKeyboard && isControl && (
        <div className="screen-keyboard-bar">
          <button className="screen-kb-btn" onClick={() => sendVk(VK.Escape)}    title="Esc">Esc</button>
          <button className="screen-kb-btn" onClick={() => sendVk(VK.Tab)}       title="Tab">Tab</button>
          <button className="screen-kb-btn" onClick={() => sendVk(VK.Backspace)} title="Backspace">⌫</button>
          <button className="screen-kb-btn" onClick={() => sendVk(VK.ArrowLeft)}  title="Left">←</button>
          <button className="screen-kb-btn" onClick={() => sendVk(VK.ArrowUp)}    title="Up">↑</button>
          <button className="screen-kb-btn" onClick={() => sendVk(VK.ArrowDown)}  title="Down">↓</button>
          <button className="screen-kb-btn" onClick={() => sendVk(VK.ArrowRight)} title="Right">→</button>
          <input
            ref={kbInputRef}
            type="text"
            className="screen-keyboard-input"
            placeholder="Type here…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={handleKbChange}
            onKeyDown={handleKbKeyDown}
          />
          <button className="screen-kb-btn" onClick={() => sendVk(VK.Enter)} title="Enter">↵</button>
        </div>
      )}
    </div>
  );
}
