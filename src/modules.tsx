import { useEffect, useRef, useState } from "react";
import { api, ago, dayLabel, gb, secs, week } from "./api";
import type {
  ClipItem,
  FocusState,
  Note,
  ReminderData,
  RingAnim,
  ScreenSummary,
  SysStats,
  Tone,
} from "./api";
import { ringNotch } from "./ring";
import { playTone } from "./sound";
import { Bar, Icon, Ring, Spark } from "./ui";
import type { IconName } from "./ui";

export type ModuleId =
  | "home"
  | "focus"
  | "reminders"
  | "notes"
  | "clipboard"
  | "screen"
  | "system";

/** Dock order. `short` is what the "labels" dock style has room for. */
export const MODULES: { id: ModuleId; label: string; short: string; icon: IconName }[] = [
  { id: "home", label: "Home", short: "Home", icon: "home" },
  { id: "focus", label: "Timer", short: "Timer", icon: "timer" },
  { id: "reminders", label: "Reminders", short: "Remind", icon: "bell" },
  { id: "notes", label: "Notes", short: "Notes", icon: "notes" },
  { id: "clipboard", label: "Clipboard", short: "Clips", icon: "clipboard" },
  { id: "screen", label: "Screen time", short: "Time", icon: "screen" },
  { id: "system", label: "System", short: "System", icon: "system" },
];

export function usePoll<T>(fn: () => Promise<T>, ms: number): T | null {
  const [data, setData] = useState<T | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    const run = () => {
      fnRef
        .current()
        .then((v) => alive && setData(v))
        .catch(() => {});
    };
    run();
    const id = window.setInterval(run, ms);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [ms]);
  return data;
}

const pretty = (exe: string) => {
  const n = exe.replace(/\.exe$/i, "");
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/**
 * Every app icon sits in the same square tile. Windows returns logos of wildly
 * different aspect ratios and internal padding, so sizing the raw image makes a
 * list look ragged; the tile fixes the footprint and the icon just fills it.
 */
function AppIcon({ src, name, size = 17 }: { src: string | null; name: string; size?: number }) {
  return (
    <span className="app-ico" style={{ width: size + 8, height: size + 8 }}>
      {src ? (
        <img src={src} alt="" draggable={false} style={{ width: size, height: size }} />
      ) : (
        <span className="app-ico-fb" style={{ fontSize: size * 0.55 }}>
          {pretty(name).charAt(0)}
        </span>
      )}
    </span>
  );
}

/* ---------------- Home ---------------- */

export function HomeModule({ onOpen }: { onOpen: (m: ModuleId) => void }) {
  const sys = usePoll<SysStats>(api.sysStats, 2000);
  const clips = usePoll<ClipItem[]>(api.clipList, 2000);
  const notes = usePoll<Note[]>(api.notesList, 4000);
  const screen = usePoll<ScreenSummary>(api.screenSummary, 8000);

  const memPct = sys && sys.mem_total ? (sys.mem_used / sys.mem_total) * 100 : 0;
  const diskPct = sys && sys.disk_total ? (sys.disk_used / sys.disk_total) * 100 : 0;
  const topApp = screen?.apps[0];
  const wk = week(screen?.days ?? []);
  const maxDay = Math.max(1, ...wk);
  const lastNote = notes?.[0];

  return (
    <div className="grid2">
      <button className="card" onClick={() => onOpen("notes")}>
        <div className="card-label">
          <Icon name="notes" size={11} /> Notes
        </div>
        {lastNote ? (
          <>
            <div className="note-title clamp1">{lastNote.title || "Untitled"}</div>
            <div className="card-sub clamp1">{plain(lastNote.body) || "Empty"}</div>
          </>
        ) : (
          <div className="empty-sm">No notes yet</div>
        )}
        <div className="card-sub faint">
          {notes?.length ?? 0} note{(notes?.length ?? 0) === 1 ? "" : "s"}
        </div>
      </button>

      <button className="card" onClick={() => onOpen("screen")}>
        <div className="card-label">
          <Icon name="screen" size={11} /> Screen time
        </div>
        <div className="hero">{secs(screen?.today_secs ?? 0)}</div>
        <div className="card-sub">
          {topApp ? (
            <>
              <AppIcon src={topApp.icon} name={topApp.name} size={14} />
              <span className="clamp1">
                {pretty(topApp.name)} · {secs(topApp.secs)}
              </span>
            </>
          ) : (
            "Gathering…"
          )}
        </div>
        <div className="weekbars">
          {wk.map((s, i) => (
            <div key={i} className="weekbar">
              <div
                className="weekbar-fill"
                style={{ height: s ? `${Math.max(8, (s / maxDay) * 100)}%` : 0 }}
              />
            </div>
          ))}
        </div>
      </button>

      <button className="card" onClick={() => onOpen("clipboard")}>
        <div className="card-label">
          <Icon name="clipboard" size={11} /> Clipboard
        </div>
        <div className="mini-list">
          {(clips ?? []).slice(0, 2).map((c) => (
            <div key={c.id} className="mini-row">
              <span className="mini-text">{c.text}</span>
              <span className="mini-time">{ago(c.ts)}</span>
            </div>
          ))}
          {!clips?.length && <div className="empty-sm">Nothing copied yet</div>}
        </div>
      </button>

      <button className="card" onClick={() => onOpen("system")}>
        <div className="card-label">
          <Icon name="system" size={11} /> System
        </div>
        <div className="ringrow">
          <Ring value={sys?.cpu ?? 0} label="CPU" size={44} tone="accent" />
          <Ring value={memPct} label="RAM" size={44} tone="white" />
          <Ring value={diskPct} label="DISK" size={44} tone="dim" />
        </div>
        <div className="card-sub clamp1">
          {sys?.battery != null
            ? `${sys.battery}% · ${sys.charging ? "plugged in" : "on battery"}`
            : `${gb(sys?.mem_used ?? 0)} / ${gb(sys?.mem_total ?? 0)} GB`}
        </div>
      </button>
    </div>
  );
}

/* ---------------- Focus ---------------- */

const PRESETS = [15, 25, 50];
const BREAK_MINS = 5;

const mmss = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.max(0, n) % 60).padStart(2, "0")}`;

export function FocusModule() {
  const [st, setSt] = useState<FocusState | null>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    let alive = true;
    const run = () =>
      api
        .focusGet()
        .then((v) => alive && setSt(v))
        .catch(() => {});
    run();
    const id = window.setInterval(run, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Commands return the new state, so the button lands on the next frame instead
  // of waiting for the poll.
  const act = (p: Promise<FocusState>) => void p.then(setSt);

  const work = st?.is_work ?? true;
  const running = st?.running ?? false;
  const total = st ? (work ? st.work_secs : st.break_secs) : 1500;
  const pct = total ? ((total - (st?.remaining ?? total)) / total) * 100 : 0;
  const sessions = st?.sessions_today ?? 0;

  // The backend clamps to 1..180, so only the blank / non-numeric case is ours.
  const applyCustom = () => {
    const n = Math.round(Number(custom));
    if (!Number.isFinite(n) || n < 1) return;
    act(api.focusConfig(n, BREAK_MINS));
    setCustom("");
  };

  return (
    <div className="focus">
      <div className="focus-hero">
        <Ring value={pct} label={work ? "Work" : "Break"} size={96} />
        <div className="focus-stack">
          <div className="card-label">
            {work
              ? running
                ? "Focusing"
                : "Ready to focus"
              : running
                ? "On a break"
                : "Break ready"}
          </div>
          <div className="hero-lg mono">{mmss(st?.remaining ?? total)}</div>
          <div className="card-sub faint">
            {sessions} session{sessions === 1 ? "" : "s"} today
          </div>
        </div>
      </div>

      <div className="focus-actions">
        <button className="btn-copy focus-btn" onClick={() => act(api.focusToggle())}>
          {running ? "Pause" : "Start"}
        </button>
        <button className="btn-ghost" onClick={() => act(api.focusReset())}>
          Reset
        </button>
      </div>

      <div className="focus-row">
        <div className="seg focus-presets">
          {PRESETS.map((m) => (
            <button
              key={m}
              className={`seg-btn${st && st.work_secs === m * 60 ? " on" : ""}`}
              onClick={() => act(api.focusConfig(m, BREAK_MINS))}
            >
              {m} min
            </button>
          ))}
        </div>
        <div className="focus-custom">
          <input
            type="number"
            min={1}
            max={180}
            placeholder="Custom"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applyCustom();
            }}
          />
          <button className="seg-btn" onClick={applyCustom} disabled={!custom}>
            Set
          </button>
        </div>
      </div>
    </div>
  );
}

const TONE_LABEL: Record<Tone, string> = { chime: "Chime", bell: "Bell", bowl: "Bowl" };
const ANIM_LABEL: Record<RingAnim, string> = { glow: "Glow", pulse: "Pulse", ripple: "Ripple" };

export function RemindersModule() {
  const [data, setData] = useState<ReminderData | null>(null);
  const [text, setText] = useState("");
  const [time, setTime] = useState("");

  useEffect(() => {
    let alive = true;
    const run = () =>
      api
        .remindersGet()
        .then((v) => alive && setData(v))
        .catch(() => {});
    run();
    // Two seconds: a fired item flips to done in the list without a reload.
    const id = window.setInterval(run, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const add = async () => {
    const t = text.trim();
    if (!t || !time) return;
    const [h, m] = time.split(":").map(Number);
    const at = new Date();
    at.setHours(h, m, 0, 0);
    // A time already gone today means tomorrow, not a reminder in the past.
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
    setData(await api.remind(t, at.getTime()));
    setText("");
    setTime("");
  };

  const pick = async (tone: Tone, anim: RingAnim) => {
    if (!data) return;
    setData(await api.reminderConfig(tone, anim));
    playTone(tone);
    ringNotch(anim);
  };

  const when = (at: number) => {
    const d = new Date(at);
    return {
      day: dayLabel(at),
      time: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
    };
  };

  const pending = data?.items.filter((r) => !r.done) ?? [];
  const fired = data?.items.filter((r) => r.done).reverse() ?? [];

  return (
    <div className="rem">
      <form
        className="rem-form"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="rem-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Remind me to…"
          maxLength={200}
        />
        <input
          className="rem-time"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          required
        />
        <button className="btn-copy rem-add" type="submit" disabled={!text.trim() || !time}>
          <Icon name="plus" size={10} stroke={2.6} />
          Set
        </button>
      </form>

      <div className="rem-opts">
        <div className="rem-opt">
          <span className="rem-lbl">Sound</span>
          <div className="seg rem-chips">
            {(Object.keys(TONE_LABEL) as Tone[]).map((t) => (
              <button
                key={t}
                className={`seg-btn${data?.tone === t ? " on" : ""}`}
                onClick={() => void pick(t, data?.anim ?? "glow")}
                title={`Preview the ${TONE_LABEL[t].toLowerCase()}`}
              >
                {TONE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <div className="rem-opt">
          <span className="rem-lbl">Notch</span>
          <div className="seg rem-chips">
            {(Object.keys(ANIM_LABEL) as RingAnim[]).map((a) => (
              <button
                key={a}
                className={`seg-btn${data?.anim === a ? " on" : ""}`}
                onClick={() => void pick(data?.tone ?? "chime", a)}
                title={`Preview the ${ANIM_LABEL[a].toLowerCase()}`}
              >
                {ANIM_LABEL[a]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rem-list">
        {!data ? null : pending.length === 0 && fired.length === 0 ? (
          <div className="rem-empty">
            <span className="rem-empty-mark">
              <Icon name="bell" size={16} />
            </span>
            <b>Nothing scheduled</b>
            <span>Anything you want a gentle nudge about.</span>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <div className="rem-head">
                Upcoming <span>{pending.length}</span>
              </div>
            )}
            {pending.map((r) => {
              const w = when(r.at);
              return (
                <div className="rem-item" key={r.id}>
                  <span className="rem-when">
                    <b>{w.time}</b>
                    <i>{w.day}</i>
                  </span>
                  <span className="rem-what">{r.text}</span>
                  <button
                    className="icon-btn rem-del"
                    onClick={() => void api.reminderDelete(r.id).then(setData)}
                    title="Delete"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              );
            })}
            {fired.length > 0 && (
              <div className="rem-head">
                Done <span>{fired.length}</span>
              </div>
            )}
            {fired.map((r) => {
              const w = when(r.at);
              return (
                <div className="rem-item done" key={r.id}>
                  <span className="rem-when">
                    <b>{w.time}</b>
                    <i>{w.day}</i>
                  </span>
                  <span className="rem-what">{r.text}</span>
                  <button
                    className="icon-btn rem-del"
                    onClick={() => void api.reminderDelete(r.id).then(setData)}
                    title="Delete"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- System ---------------- */

export function SystemModule() {
  const sys = usePoll<SysStats>(api.sysStats, 1000);
  // Seeded flat so the chart has geometry before the second CPU sample lands,
  // then filled with the first real reading: 59 zeros plus one sample draws a
  // flat line with a spike at the right edge, which reads as a broken chart.
  const [hist, setHist] = useState<number[]>(() => new Array(60).fill(0));
  useEffect(() => {
    if (!sys) return;
    setHist((h) => (h.every((v) => v === 0) ? new Array(60).fill(sys.cpu) : [...h.slice(-59), sys.cpu]));
  }, [sys]);

  const memPct = sys && sys.mem_total ? (sys.mem_used / sys.mem_total) * 100 : 0;
  const diskPct = sys && sys.disk_total ? (sys.disk_used / sys.disk_total) * 100 : 0;

  return (
    <div className="sys">
      <div className="sys-hero">
        <div className="sys-hero-top">
          <span className="card-label">CPU</span>
          <span className="sys-uptime">Up {secs(sys?.uptime_secs ?? 0)}</span>
        </div>
        <div className="sys-num">
          {sys ? Math.round(sys.cpu) : "—"}
          <span className="unit">%</span>
        </div>
        <Spark data={hist} max={100} height={84} />
      </div>

      <div className="sys-cols">
        <Stat
          label="Memory"
          pct={memPct}
          tone="white"
          detail={`${gb(sys?.mem_used ?? 0)} / ${gb(sys?.mem_total ?? 0)} GB`}
        />
        <Stat
          label="Disk"
          pct={diskPct}
          tone="dim"
          detail={`${gb(sys?.disk_used ?? 0)} / ${gb(sys?.disk_total ?? 0)} GB`}
        />
        <Stat
          label="Battery"
          pct={sys?.battery ?? null}
          tone="accent"
          detail={sys?.battery == null ? "No battery" : sys.charging ? "Plugged in" : "On battery"}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  pct,
  detail,
  tone,
}: {
  label: string;
  pct: number | null;
  detail: string;
  tone: string;
}) {
  return (
    <div className="stat">
      <div className="card-label">{label}</div>
      <div className="stat-num">
        {pct == null ? "—" : Math.round(pct)}
        {pct != null && <span className="unit">%</span>}
      </div>
      <Bar value={pct ?? 0} max={100} tone={tone} />
      <div className="stat-detail">{detail}</div>
    </div>
  );
}

/* ---------------- Clipboard ---------------- */

type Kind = "link" | "code" | "text";

const KIND_ICON: Record<Kind, IconName> = { link: "link", code: "code", text: "text" };

function kindOf(t: string): Kind {
  const s = t.trim();
  if (/^https?:\/\/\S+$/i.test(s)) return "link";
  // Prose wraps; only real code punctuation should earn the CODE chip.
  if (/(=>|[{};]|<\/?[a-z][\w-]*[^>]*>)/i.test(s)) return "code";
  return "text";
}

const clockOf = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Local calendar day, so grouping holds across midnight and DST. */
const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export function ClipboardModule() {
  const [items, setItems] = useState<ClipItem[]>([]);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    const run = () =>
      api
        .clipList()
        .then((v) => alive && setItems(v))
        .catch(() => {});
    run();
    inputRef.current?.focus();
    const id = window.setInterval(run, 2000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const copy = async (id: string) => {
    await api.clipCopy(id);
    setCopied(id);
    window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1100);
  };

  const togglePick = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const startPicking = () => {
    // The search row is replaced by the bar, so a leftover query would hide items
    // with no visible way to clear it.
    setQ("");
    setPicked([]);
    setPicking(true);
  };

  const stopPicking = () => {
    setPicking(false);
    setPicked([]);
    inputRef.current?.focus();
  };

  const removePicked = async () => {
    const ids = picked;
    stopPicking();
    setItems(await api.clipDeleteMany(ids));
  };

  // Read from the live list, so a delete or a Clear drops the reader instead of
  // leaving a stale copy on screen.
  const sel = selId ? items.find((i) => i.id === selId) ?? null : null;

  if (sel) {
    const kind = kindOf(sel.text);
    const isCopied = copied === sel.id;
    return (
      <div className="clip">
        <div className="read-head">
          <button className="icon-btn" onClick={() => setSelId(null)} title="Back">
            <Icon name="back" size={15} />
          </button>
          <span className={`chip chip-${kind}`}>
            <Icon name={KIND_ICON[kind]} size={9} stroke={1.9} />
            {kind}
          </span>
          <span className="clip-time">
            {dayLabel(sel.ts)} · {clockOf(sel.ts)}
          </span>
          <span className="read-len">{sel.text.length}</span>
          <div className="read-actions">
            <button
              className={`icon-btn${sel.pinned ? " on" : ""}`}
              onClick={() => void api.clipPin(sel.id).then(setItems)}
              title={sel.pinned ? "Unpin" : "Pin"}
            >
              <Icon name="pin" size={13} />
            </button>
            <button
              className="icon-btn"
              onClick={() =>
                void api.clipDelete(sel.id).then((v) => {
                  setItems(v);
                  setSelId(null);
                })
              }
              title="Delete"
            >
              <Icon name="trash" size={13} />
            </button>
            <button className={`btn-copy${isCopied ? " done" : ""}`} onClick={() => void copy(sel.id)}>
              <Icon name={isCopied ? "check" : "copy"} size={12} stroke={isCopied ? 2.4 : 1.6} />
              {isCopied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div className="read-body">{sel.text}</div>
      </div>
    );
  }

  const needle = q.trim().toLowerCase();
  const filtered = (needle ? items.filter((i) => i.text.toLowerCase().includes(needle)) : items)
    .slice()
    .sort((a, b) => b.ts - a.ts);

  // Pinned gets its own strip; everything else is newest-first inside its day.
  const pinned = filtered.filter((i) => i.pinned);
  const groups: { key: string; label: string; items: ClipItem[] }[] = [];
  for (const it of filtered) {
    if (it.pinned) continue;
    const key = dayKey(it.ts);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it);
    else groups.push({ key, label: dayLabel(it.ts), items: [it] });
  }

  const card = (c: ClipItem) => {
    const kind = kindOf(c.text);
    const on = picked.includes(c.id);
    return (
      <button
        key={c.id}
        className={`clip-card${c.pinned ? " pinned" : ""}${on ? " picked" : ""}`}
        onClick={() => (picking ? togglePick(c.id) : setSelId(c.id))}
        title={picking ? (on ? "Deselect" : "Select") : "Read"}
      >
        <span className="cc-top">
          <span className={`cc-ico k-${kind}`}>
            <Icon name={KIND_ICON[kind]} size={11} stroke={1.8} />
          </span>
          {c.pinned && <Icon name="pin" size={9} stroke={2} />}
          <span className="cc-time">{clockOf(c.ts)}</span>
          {picking && (
            <span className="clip-tick">
              <Icon name="check" size={8} stroke={3} />
            </span>
          )}
        </span>
        <span className="cc-text">{c.text}</span>
      </button>
    );
  };

  const allPicked = filtered.length > 0 && picked.length === filtered.length;

  return (
    <div className="clip">
      {picking ? (
        <div className="clip-bar">
          <button
            className="btn-ghost"
            onClick={() => setPicked(allPicked ? [] : filtered.map((i) => i.id))}
          >
            {allPicked ? "None" : "All"}
          </button>
          <span className="clip-bar-n">
            {picked.length} selected
          </span>
          <button className="btn-danger" disabled={!picked.length} onClick={() => void removePicked()}>
            Delete
          </button>
          <button className="btn-ghost" onClick={stopPicking}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="search">
          <Icon name="search" size={13} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clipboard…"
            spellCheck={false}
          />
          <span className="search-count">{filtered.length}</span>
          <button className="icon-btn" onClick={startPicking} title="Select items">
            <Icon name="select" size={13} />
          </button>
        </div>
      )}

      <div className="clip-list">
        {pinned.length > 0 && (
          <section className="clip-group">
            <div className="clip-day">
              <Icon name="pin" size={9} stroke={2.2} /> Pinned
            </div>
            <div className="clip-cards">{pinned.map(card)}</div>
          </section>
        )}
        {groups.map((g) => (
          <section key={g.key} className="clip-group">
            <div className="clip-day">{g.label}</div>
            <div className="clip-cards">{g.items.map(card)}</div>
          </section>
        ))}
        {!filtered.length && (
          <div className="empty">{needle ? "No match" : "Copy something and it lands here"}</div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Notes ---------------- */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Notes written before the editor existed are plain text. */
const toHtml = (b: string) => (/<[a-z][^>]*>/i.test(b) ? b : escapeHtml(b).replace(/\n/g, "<br>"));

function plain(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function NotesModule() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  // The editor fills the panel and the list steps aside.
  const [full, setFull] = useState(false);
  // The editor is keyed by this, not by `selId`: creating a note assigns it an id
  // mid-session, and remounting then would throw the caret away.
  const [gen, setGen] = useState(0);

  useEffect(() => {
    api
      .notesList()
      .then((list) => {
        setNotes(list);
        // Open the newest note rather than an empty editor: a notes module that
        // greets you with "Write it down…" while you have notes reads as lost data.
        if (list.length) {
          setSelId(list[0].id);
          setGen((g) => g + 1);
        }
      })
      .catch(() => {});
  }, []);

  const open = (id: string | null) => {
    setSelId(id);
    setGen((g) => g + 1);
  };

  const save = async (id: string | null, title: string, body: string) => {
    const list = await api.notesSave(id, title, body);
    setNotes(list);
    if (id) return id;
    const fresh = list[0]?.id ?? null;
    setSelId(fresh);
    return fresh;
  };

  const remove = async (id: string) => {
    setNotes(await api.notesDelete(id));
    if (selId === id) open(null);
  };

  const sel = notes.find((n) => n.id === selId) ?? null;

  return (
    <div className={`notes${full ? " full" : ""}`}>
      <aside className="notes-side">
        <div className="side-head">
          <span className="card-label">Notes</span>
          <button className="icon-btn" onClick={() => open(null)} title="New note">
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div className="side-list">
          {notes.map((n) => (
            <button
              key={n.id}
              className={`side-item${n.id === selId ? " on" : ""}`}
              onClick={() => open(n.id)}
            >
              <span className="side-top">
                <span className="side-title">{n.title || "Untitled"}</span>
                <span className="side-date">{dayLabel(n.ts)}</span>
              </span>
              <span className="side-prev">{plain(n.body) || "Empty note"}</span>
            </button>
          ))}
          {!notes.length && <div className="side-empty">No notes yet</div>}
        </div>
      </aside>

      <section className="notes-main">
        <NoteEditor
          key={gen}
          note={sel}
          full={full}
          onToggleFull={() => setFull((f) => !f)}
          onSave={save}
          onDelete={sel ? () => void remove(sel.id) : undefined}
        />
      </section>
    </div>
  );
}

function NoteEditor({
  note,
  full,
  onToggleFull,
  onSave,
  onDelete,
}: {
  note: Note | null;
  full: boolean;
  onToggleFull: () => void;
  onSave: (id: string | null, title: string, body: string) => Promise<string | null>;
  onDelete?: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<string | null>(note?.id ?? null);
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  // Mirrored on every keystroke: the unmount save runs after refs are detached,
  // so reading the DOM there would write an empty body over a real note.
  const latest = useRef({ title: note?.title ?? "", body: note?.body ?? "" });
  const [saved, setSaved] = useState(false);
  const [empty, setEmpty] = useState(!plain(note?.body ?? ""));
  const [marks, setMarks] = useState<Record<string, boolean>>({});

  // Mount only. Re-writing innerHTML whenever the notes list is replaced after
  // a save is what used to fling the caret back to the start.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = toHtml(note?.body ?? "");
    if (!note) titleRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pressed states for the toolbar, refreshed only while this editor has focus.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const sync = () => {
      if (document.activeElement !== el) return;
      const block = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
      const next = {
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strike: document.queryCommandState("strikeThrough"),
        bullet: document.queryCommandState("insertUnorderedList"),
        ordered: document.queryCommandState("insertOrderedList"),
        heading: block === "h2",
        code: block === "pre",
      };
      setMarks((m) =>
        Object.keys(next).every((k) => m[k] === next[k as keyof typeof next]) ? m : next
      );
    };
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, []);

  const doSave = async () => {
    if (!dirty.current) return;
    dirty.current = false;
    const { title, body } = latest.current;
    // An untouched blank note is not worth a row; a cleared one still is.
    if (!idRef.current && !title.trim() && !plain(body)) return;
    idRef.current = await saveRef.current(idRef.current, title.trim(), body);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 900);
  };

  const queue = () => {
    dirty.current = true;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void doSave(), 700);
  };

  // Collapsing the notch unmounts this editor; never lose the last keystrokes.
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      if (!dirty.current) return;
      dirty.current = false;
      const { title, body } = latest.current;
      if (!idRef.current && !title.trim() && !plain(body)) return;
      void saveRef.current(idRef.current, title.trim(), body);
    },
    []
  );

  /** Keeps the caret where it is: the toolbar's mousedown is prevented, so the
   *  selection is still live when execCommand runs. */
  const exec = (name: string, value?: string) => {
    document.execCommand(name, false, value);
    queue();
  };

  const block = (tag: "h2" | "pre") => {
    const cur = String(document.queryCommandValue("formatBlock") || "").toLowerCase();
    exec("formatBlock", cur === tag ? "<div>" : `<${tag}>`);
  };

  const tools: { icon: IconName; title: string; run: () => void }[] = [
    { icon: "bold", title: "Bold", run: () => exec("bold") },
    { icon: "italic", title: "Italic", run: () => exec("italic") },
    { icon: "underline", title: "Underline", run: () => exec("underline") },
    { icon: "strike", title: "Strikethrough", run: () => exec("strikeThrough") },
    { icon: "heading", title: "Heading", run: () => block("h2") },
    { icon: "bullet", title: "Bulleted list", run: () => exec("insertUnorderedList") },
    { icon: "ordered", title: "Numbered list", run: () => exec("insertOrderedList") },
    { icon: "code", title: "Code block", run: () => block("pre") },
    { icon: "erase", title: "Clear formatting", run: () => exec("removeFormat") },
  ];

  return (
    <div className="editor">
      <div className="ed-top">
        <input
          ref={titleRef}
          className="ed-title"
          defaultValue={note?.title ?? ""}
          placeholder="Title"
          spellCheck={false}
          onChange={(e) => {
            latest.current.title = e.target.value;
            queue();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              bodyRef.current?.focus();
            }
          }}
        />
        <span className={`ed-saved${saved ? " on" : ""}`}>Saved</span>
        <button
          className={`icon-btn${full ? " on" : ""}`}
          onClick={onToggleFull}
          title={full ? "Back to the list" : "Fill the panel"}
        >
          <Icon name="expand" size={13} />
        </button>
        {onDelete && (
          <button className="icon-btn" onClick={onDelete} title="Delete note">
            <Icon name="trash" size={13} />
          </button>
        )}
      </div>

      <div className="ed-tools">
        {tools.map((t) => (
          <button
            key={t.icon}
            className={`tool${marks[t.icon] ? " on" : ""}`}
            title={t.title}
            aria-pressed={!!marks[t.icon]}
            onMouseDown={(e) => e.preventDefault()}
            onClick={t.run}
          >
            <Icon name={t.icon} size={13} />
          </button>
        ))}
      </div>

      <div className="ed-wrap">
        <div
          ref={bodyRef}
          className="ed-body"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onInput={() => {
            const el = bodyRef.current;
            if (!el) return;
            latest.current.body = el.innerHTML;
            setEmpty(!el.textContent?.trim());
            queue();
          }}
          onBlur={() => void doSave()}
          onPaste={(e) => {
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
            queue();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              bodyRef.current?.blur();
            }
          }}
        />
        {empty && <span className="ed-ph">Write it down…</span>}
      </div>
    </div>
  );
}

/* ---------------- Screen time ---------------- */

export function ScreenModule() {
  const screen = usePoll<ScreenSummary>(api.screenSummary, 5000);
  const apps = screen?.apps ?? [];
  const maxApp = Math.max(1, ...apps.map((a) => a.secs));
  const total = Math.max(1, apps.reduce((n, a) => n + a.secs, 0));
  const wk = week(screen?.days ?? []);
  const maxDay = Math.max(1, ...wk);

  return (
    <div className="screen">
      <div className="screen-head">
        <div>
          <div className="card-label">Today</div>
          <div className="hero-lg">{secs(screen?.today_secs ?? 0)}</div>
        </div>
        <div className="daychart">
          {wk.map((s, i) => (
            <div key={i} className="weekbar" title={secs(s)}>
              <div
                className="weekbar-fill"
                style={{ height: s ? `${Math.max(8, (s / maxDay) * 100)}%` : 0 }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="app-list">
        {apps.slice(0, 6).map((a) => (
          <div key={a.name} className="app-row">
            <AppIcon src={a.icon} name={a.name} />
            <div className="app-mid">
              <div className="app-top">
                <span className="app-name">{pretty(a.name)}</span>
                <span className="app-time mono">{secs(a.secs)}</span>
              </div>
              <Bar value={a.secs} max={maxApp} tone="accent" />
            </div>
            <span className="app-pct mono">{Math.round((a.secs / total) * 100)}%</span>
          </div>
        ))}
        {!apps.length && <div className="empty">Nothing tracked yet today.</div>}
      </div>
    </div>
  );
}
