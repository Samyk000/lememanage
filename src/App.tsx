import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api } from "./api";
import type {
  Accent,
  DockStyle,
  FocusState,
  NotchStyle,
  Placement,
  RingAnim,
  Settings,
  Theme,
  Tone,
} from "./api";
import { ringNotch } from "./ring";
import { playTone, unlockAudio } from "./sound";
import {
  ClipboardModule,
  FocusModule,
  HomeModule,
  MODULES,
  NotesModule,
  RemindersModule,
  ScreenModule,
  SystemModule,
} from "./modules";
import type { ModuleId } from "./modules";
import { Icon } from "./ui";

const THEMES: { id: Theme; label: string; bg: string; ink: string }[] = [
  { id: "dark", label: "Dark", bg: "#0b0b0e", ink: "#f4f4f6" },
  { id: "ink", label: "Ink", bg: "#0a0f18", ink: "#e9eef8" },
  { id: "slate", label: "Slate", bg: "#191b20", ink: "#f1f2f5" },
  { id: "sand", label: "Sand", bg: "#17130f", ink: "#f6efe6" },
  { id: "light", label: "Light", bg: "#fbfbfd", ink: "#17171c" },
  { id: "paper", label: "Paper", bg: "#f5f2ec", ink: "#221f1a" },
];

const ACCENTS: { id: Accent; label: string; hex: string }[] = [
  { id: "amber", label: "Amber", hex: "#f0b429" },
  { id: "blue", label: "Blue", hex: "#5aa7ff" },
  { id: "mint", label: "Mint", hex: "#2fe6a1" },
  { id: "rose", label: "Rose", hex: "#ff5f86" },
  { id: "violet", label: "Violet", hex: "#b18cff" },
  { id: "coral", label: "Coral", hex: "#ff7a52" },
  { id: "cyan", label: "Cyan", hex: "#2fdde8" },
  { id: "lime", label: "Lime", hex: "#b0f03a" },
];

const NOTCHES: { id: NotchStyle; label: string }[] = [
  { id: "dot", label: "Dot" },
  { id: "orb", label: "Ring" },
  { id: "bar", label: "Bar" },
  { id: "time", label: "Time" },
];

const DOCKS: { id: DockStyle; label: string }[] = [
  { id: "icons", label: "Icons" },
  { id: "labels", label: "Labels" },
  { id: "minimal", label: "Segmented" },
];

/** How long a drop stays put before a stray mouse-leave can tuck it away. */
const QUIET = 500;

/** The panel folds back into the notch for this long before the window shrinks.
 *  Must stay under the delay Rust uses before resizing the window. */
const CLOSE_MS = 170;

/** WebView2 anchors the old frame to the window's top-left while it resizes, so
 *  for one frame the pill replays at the panel's left edge. Blanking the notch
 *  first leaves nothing to anchor. Two frames: one to commit, one to paint. */
const nextPaint = () =>
  new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r()))
  );

/** "24:59" — the resting notch has room for minutes and seconds, nothing more. */
const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function App() {
  const [open, setOpen] = useState(false);
  const [module, setModule] = useState<ModuleId>("home");
  const [settings, setSettings] = useState(false);
  const [st, setSt] = useState<Settings | null>(null);
  const [place, setPlace] = useState<Placement>({ side: "top", flush: true });
  const [clock, setClock] = useState("");
  const [focus, setFocus] = useState<FocusState | null>(null);
  // `open` keeps the panel mounted; `closing` plays its fold-back first.
  const [closing, setClosing] = useState(false);
  // Hides the notch for the two frames around a window grow, so the resize has
  // nothing stale to show.
  const [prep, setPrep] = useState(false);

  const leaveTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const dragging = useRef(false);
  const openRef = useRef(false);
  const hadFocus = useRef(false);
  const quietUntil = useRef(0);
  const dockRef = useRef<HTMLElement>(null);
  const [pill, setPill] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const notch = st?.notch ?? "dot";
  // A running session owns the resting notch: it is the one thing you want to
  // read without opening anything.
  const left = focus?.running ? focus.remaining : 0;

  useEffect(() => {
    api.settingsGet().then(setSt).catch(() => {});
    api.dockSide().then(setPlace).catch(() => {});
  }, []);

  // Audio has to be unlocked by a gesture the first time; after that the context
  // stays live and a reminder can play while the window is idle.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Theme/accent/dock live on <html> so plain CSS variables do the work.
  // Layout effect, not a plain one: the dock marker measures button geometry in
  // its own layout effect and must see the new `data-dock` sizes, and painting
  // one frame of transitions before the swap guard lands looks like a stutter.
  useLayoutEffect(() => {
    const r = document.documentElement;
    r.dataset.swap = "";
    r.dataset.theme = st?.theme ?? "dark";
    r.dataset.accent = st?.accent ?? "amber";
    r.dataset.dock = st?.dock ?? "icons";
    r.dataset.glass = st?.glass ? "on" : "off";
    const t = window.setTimeout(() => delete r.dataset.swap, 120);
    return () => window.clearTimeout(t);
  }, [st?.theme, st?.accent, st?.dock, st?.glass]);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(
        `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
      );
    };
    tick();
    const id = window.setInterval(tick, 10000);
    return () => window.clearInterval(id);
  }, []);

  // Only while collapsed: the Focus module polls the same command when the panel
  // is open, and the resting notch is where a running countdown belongs.
  useEffect(() => {
    if (open) return;
    let alive = true;
    const tick = () => {
      api
        .focusGet()
        .then((s) => alive && setFocus(s))
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [open]);

  // Grow the window first: the panel mounts into a window that already fits it,
  // so the entrance animation never plays inside a 104×24 viewport.
  const expand = useCallback(async () => {
    if (openRef.current) return;
    openRef.current = true;
    // Re-entering during the fold-back cancels it; the panel just replays its
    // opening, which is what the eye expects from "you came back".
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setClosing(false);
    // Blank the pill before the window grows: WebView2 paints one frame of the
    // old surface at the new window's top-left, which showed the pill 228px to
    // the left for a frame — the "it jumps left before opening" flick.
    setPrep(true);
    await nextPaint();
    try {
      await api.setExpanded(true);
      // A collapse that landed while we were waiting wins.
      if (!openRef.current) return;
      setSettings(false);
      setOpen(true);
    } catch {
      openRef.current = false;
      setClosing(false);
      setOpen(false);
    } finally {
      setPrep(false);
    }
  }, []);

  // The local half of closing: the panel folds back into the notch. Split out
  // because a close started by Rust (hotkey, tray) must not echo `setExpanded`
  // back — a second close looks like a no-op to Rust and shrinks the window on
  // the spot, cutting the fold off.
  const fold = useCallback(() => {
    if (!openRef.current) return;
    openRef.current = false;
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setClosing(true);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setClosing(false);
      setOpen(false);
    }, CLOSE_MS);
  }, []);

  // Close in two steps: the panel folds back into the notch, then the window
  // shrinks onto the pill that was underneath it all along. Both halves are
  // invisible on their own, which is what makes the whole thing read as one
  // smooth move instead of a panel vanishing and a notch popping in.
  const collapse = useCallback(() => {
    if (!openRef.current) return;
    fold();
    void api.setExpanded(false);
  }, [fold]);

  const enter = () => {
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  };

  const leave = () => {
    if (dragging.current) return;
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    const wait = Math.max(240, quietUntil.current - Date.now());
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      collapse();
    }, wait);
  };

  const hoverStop = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  // A 240ms dwell keeps a stray mouse pass from yanking the panel open, while
  // still leaving enough time to grab the notch and drag it. Also called on
  // mousemove: landing on the notch while the window is still shrinking can
  // swallow the mouseenter, and any movement afterwards should recover it.
  const hoverStart = () => {
    // A held drag owns the mouse until it settles: the OS move loop keeps
    // delivering mousemove, and opening the panel mid-drag is the one thing that
    // must never happen.
    if (dragging.current || openRef.current || Date.now() < quietUntil.current || hoverTimer.current)
      return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      // The drag can start between arming this timer and it firing.
      if (dragging.current) return;
      void expand();
    }, 240);
  };

  // Rust already resized the window, so mirror its decision instead of asking again.
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<{ expanded: boolean; side: Placement["side"]; flush: boolean }>(
      "expanded-changed",
      (e) => {
        setPlace({ side: e.payload.side, flush: e.payload.flush });
        if (e.payload.expanded) {
          openRef.current = true;
          setClosing(false);
          setOpen(true);
        } else if (openRef.current) {
          // A close we did not start (hotkey, tray): play the same fold-back.
          fold();
        }
      }
    )
      .then((f) => (un = f))
      .catch(() => {});
    return () => un?.();
  }, [fold]);

  // Rust ends a phase on its own tick, so the notch hears about it immediately
  // instead of waiting for the next poll with a stale countdown.
  useEffect(() => {
    let un: (() => void) | undefined;
    listen("focus-updated", () => {
      api
        .focusGet()
        .then(setFocus)
        .catch(() => {});
    })
      .then((f) => (un = f))
      .catch(() => {});
    return () => un?.();
  }, []);

  // A reminder rings on the resting notch and in the panel header, so it is
  // visible whichever state the window is in.
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<{ texts: string[]; tone: Tone; anim: RingAnim }>("reminder-due", (e) => {
      playTone(e.payload.tone);
      ringNotch(e.payload.anim);
    })
      .then((f) => (un = f))
      .catch(() => {});
    return () => un?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    // Clicking any other window is an unambiguous "I'm done here" — but only if
    // this window actually had focus. Windows can refuse SetForegroundWindow
    // when LemeManage is in the background, and the blur that follows is not the
    // user leaving: treating it as such closed the panel the moment it opened.
    const onFocus = () => {
      hadFocus.current = true;
    };
    const onBlur = () => {
      if (!hadFocus.current) return;
      hadFocus.current = false;
      if (openRef.current) collapse();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [collapse]);

  /** One drag path for the notch and the header: the OS move loop, then settle.
   *  `dragging` is set by the mousedown handlers before they get here and is
   *  only cleared once the drop has settled, so nothing can open the panel
   *  while the mouse is held or while the notch is snapping back. */
  const dragWindow = async () => {
    const win = getCurrentWindow();
    const before = await win.outerPosition().catch(() => null);
    try {
      // Rust waits for the mouse to come up. `startDragging()` alone returns
      // before the OS move loop runs, so the "after" read below would be the
      // position we started from and the settle would be skipped as a click.
      await api.beginDrag();
    } catch {
      dragging.current = false;
      return;
    }
    const after = await win.outerPosition().catch(() => null);
    // A 2px dead zone: a click with a shaky hand is still a click.
    const moved =
      !!before && !!after && (Math.abs(after.x - before.x) > 2 || Math.abs(after.y - before.y) > 2);
    if (!moved) {
      dragging.current = false;
      if (!openRef.current) void expand();
      return;
    }
    quietUntil.current = Date.now() + QUIET;
    try {
      setPlace(await api.anchorAfterDrag());
    } finally {
      dragging.current = false;
    }
  };

  const drag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    hoverStop();
    dragging.current = true;
    void dragWindow();
  };

  const notchDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    hoverStop();
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    dragging.current = true;
    void dragWindow();
  };

  const patch = (p: Partial<Settings>) => {
    if (!st) return;
    const next = { ...st, ...p };
    setSt(next);
    void api.settingsSet(next);
  };

  // The sliding dock marker follows whatever button is actually active, so it
  // keeps working when the dock turns into a rail or grows labels.
  // `open` is a dependency because the whole panel (dock included) unmounts on
  // collapse; without it the marker would stay unmeasured after reopening.
  useLayoutEffect(() => {
    const btn = dockRef.current?.querySelector<HTMLElement>(".dock-btn.active");
    if (!btn) {
      setPill(null);
      return;
    }
    setPill({ x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight });
  }, [open, module, settings, place.side, st?.dock]);

  const label = settings ? "Settings" : MODULES.find((m) => m.id === module)?.label ?? "LemeManage";
  const sideClass = place.side === "top" ? "" : ` side-${place.side}`;

  return (
    <div
      className="shell"
      data-notch={left > 0 ? "pill" : notch}
      data-side={place.side}
      data-prep={prep || undefined}
      data-open={(open || closing) || undefined}
    >
      {(open || closing) && (
        <div
          className={`panel${place.flush ? " flush" : ""}${sideClass}${closing ? " closing" : ""}`}
          onMouseEnter={enter}
          onMouseLeave={leave}
        >
          <header className="hdr" onMouseDown={drag}>
            <div className="hdr-left">
              <span className="mark" />
              <span className="hdr-title">{label}</span>
            </div>
            <div className="hdr-right" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className={`icon-btn${settings ? " on" : ""}`}
                onClick={() => setSettings((s) => !s)}
                title="Settings"
              >
                <Icon name="settings" size={15} />
              </button>
              <button className="icon-btn" onClick={collapse} title="Close">
                <Icon name="close" size={15} />
              </button>
            </div>
          </header>

          <main className="body">
            <div className="view" key={settings ? "settings" : module}>
              {settings ? (
                <SettingsPanel
                  st={st}
                  patch={patch}
                  onDone={() => setSettings(false)}
                  onReset={async () => {
                    await api.resetPosition();
                    // The side went back to "top", so the pill has to lie down.
                    setPlace(await api.dockSide());
                  }}
                />
              ) : module === "home" ? (
                <HomeModule onOpen={setModule} />
              ) : module === "focus" ? (
                <FocusModule />
              ) : module === "reminders" ? (
                <RemindersModule />
              ) : module === "notes" ? (
                <NotesModule />
              ) : module === "clipboard" ? (
                <ClipboardModule />
              ) : module === "screen" ? (
                <ScreenModule />
              ) : (
                <SystemModule />
              )}
            </div>
          </main>

          <nav className="dock" ref={dockRef}>
            <span
              className="dock-pill"
              aria-hidden
              style={
                pill
                  ? {
                      transform: `translate(${pill.x}px, ${pill.y}px)`,
                      width: pill.w,
                      height: pill.h,
                    }
                  : { opacity: 0 }
              }
            />
            {MODULES.map((m) => (
              <button
                key={m.id}
                className={`dock-btn${module === m.id && !settings ? " active" : ""}`}
                onClick={() => {
                  setModule(m.id);
                  setSettings(false);
                }}
                title={m.label}
              >
                <Icon name={m.icon} size={17} />
                <span className="dock-label">{m.short}</span>
                <span className="dock-dot" />
              </button>
            ))}
          </nav>
        </div>
      )}

      {/* The notch never unmounts. It is what the panel opens out of and folds
          back into, and keeping it in place means the window can be resized
          afterwards without the pill moving a pixel. While the panel is up it
          simply sits underneath it. */}
      <div className="notch-wrap">
        <div
          // A running session keeps the edge's orientation: the pill on top or
          // bottom, the rail on a side.
          className={`notch ${left > 0 ? "" : `notch-${notch}`}${
            place.flush ? " flush" : " floating"
          }${place.side === "top" ? "" : ` at-${place.side}`}`}
          onMouseDown={notchDown}
          onMouseEnter={hoverStart}
          onMouseMove={hoverStart}
          onMouseLeave={hoverStop}
          title="LemeManage"
        >
          {left > 0 ? (
            <span className="notch-timer">{mmss(left)}</span>
          ) : notch === "time" ? (
            <span className="notch-time">{clock}</span>
          ) : notch === "orb" ? (
            // The circle is the window itself; the core is painted in CSS.
            null
          ) : (
            <span className="notch-pip" />
          )}
          <span className="notch-ring" aria-hidden />
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  st,
  patch,
  onDone,
  onReset,
}: {
  st: Settings | null;
  patch: (p: Partial<Settings>) => void;
  onDone: () => void;
  onReset: () => Promise<void>;
}) {
  const [auto, setAuto] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    api.autostartGet().then(setAuto).catch(() => {});
  }, []);

  const flash = (m: string) => {
    setNote(m);
    window.setTimeout(() => setNote(""), 1600);
  };

  const toggleAuto = async () => {
    const next = await api.autostartSet(!auto);
    setAuto(next);
    flash(next ? "Starts with Windows" : "Removed from startup");
  };

  return (
    <div className="settings">
      <section className="set-card">
        <div className="set-group">
          <Icon name="settings" size={11} />
          Appearance
        </div>

        <div className="nchips">
          {NOTCHES.map((n) => (
            <button
              key={n.id}
              className={`nchip${st?.notch === n.id ? " on" : ""}`}
              onClick={() => patch({ notch: n.id })}
              title={n.label}
              aria-label={n.label}
            >
              <span className={`nprev nprev-${n.id}`}>
                {n.id === "time" ? <b>9:41</b> : null}
              </span>
              <span className="nchip-label">{n.label}</span>
            </button>
          ))}
        </div>

        <div className="set-row wide">
          <div className="set-line">
            <span>Theme</span>
            <span className="set-val">{THEMES.find((t) => t.id === st?.theme)?.label}</span>
          </div>
          <div className="tchips">
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`tchip${st?.theme === t.id ? " on" : ""}`}
                style={{ "--t": t.bg, "--ti": t.ink } as React.CSSProperties}
                onClick={() => patch({ theme: t.id })}
                title={t.label}
                aria-label={t.label}
              >
                {st?.theme === t.id && <Icon name="check" size={11} stroke={2.6} />}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row wide">
          <div className="set-line">
            <span>Accent</span>
            <span className="set-val">{ACCENTS.find((a) => a.id === st?.accent)?.label}</span>
          </div>
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                className={`swatch${st?.accent === a.id ? " on" : ""}`}
                style={{ "--sw": a.hex } as React.CSSProperties}
                onClick={() => patch({ accent: a.id })}
                title={a.label}
                aria-label={a.label}
              >
                {st?.accent === a.id && <Icon name="check" size={13} stroke={2.6} />}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <span>Dock</span>
          <div className="seg">
            {DOCKS.map((d) => (
              <button
                key={d.id}
                className={`seg-btn${st?.dock === d.id ? " on" : ""}`}
                onClick={() => patch({ dock: d.id })}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="set-row">
          <span>Frosted glass</span>
          <button
            className={`switch${st?.glass ? " on" : ""}`}
            onClick={() => patch({ glass: !st?.glass })}
            aria-pressed={!!st?.glass}
          >
            <span />
          </button>
        </div>
      </section>

      <section className="set-card">
        <div className="set-group">
          <Icon name="system" size={11} />
          System
        </div>

        <div className="set-sub">Startup</div>

        <div className="set-row">
          <span>Start with Windows</span>
          <button
            className={`switch${auto ? " on" : ""}`}
            onClick={() => void toggleAuto()}
            aria-pressed={auto}
          >
            <span />
          </button>
        </div>

        <div className="set-row">
          <span>Shortcut</span>
          <kbd>{st?.hotkey ?? "Ctrl+Shift+Space"}</kbd>
        </div>

        <div className="set-sub">Maintenance</div>

        <div className="set-row">
          <span>Position</span>
          <button
            className="btn-ghost"
            onClick={async () => {
              await onReset();
              flash("Back to top centre");
            }}
          >
            Reset
          </button>
        </div>

        <div className="set-row">
          <span>Clipboard history</span>
          <button
            className="btn-ghost"
            onClick={async () => {
              await api.clipClear();
              flash("Unpinned items cleared");
            }}
          >
            Clear
          </button>
        </div>

        <div className="set-foot">
          <span className="faint clamp1">{note || "Drag the top bar to move"}</span>
          <div className="set-actions">
            <button className="btn-ghost set-done" onClick={onDone}>
              Done
            </button>
            <button className="btn-danger" onClick={() => void api.quit()}>
              Quit
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
