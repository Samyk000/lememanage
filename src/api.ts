import { invoke } from "@tauri-apps/api/core";

export type ClipItem = { id: string; text: string; ts: number; pinned: boolean };
export type Note = { id: string; title: string; body: string; ts: number; pinned: boolean };

export type SysStats = {
  cpu: number;
  mem_used: number;
  mem_total: number;
  disk_used: number;
  disk_total: number;
  battery: number | null;
  charging: boolean;
  uptime_secs: number;
};

export type ScreenSummary = {
  today_secs: number;
  apps: { name: string; secs: number; icon: string | null }[];
  days: { day: string; secs: number }[];
};

export type FocusState = {
  work_secs: number;
  break_secs: number;
  remaining: number;
  running: boolean;
  is_work: boolean;
  sessions_today: number;
};

export type WeatherPlace = {
  name: string;
  region: string;
  lat: number;
  lon: number;
};

export type WeatherData = {
  place: WeatherPlace | null;
  unit: "c" | "f";
};

export type Tone = "chime" | "bell" | "bowl";
export type RingAnim = "glow" | "pulse" | "ripple";
export type Reminder = { id: string; text: string; at: number; done: boolean };
export type ReminderData = { items: Reminder[]; tone: Tone; anim: RingAnim };

export type Theme = "dark" | "ink" | "slate" | "sand" | "light" | "paper";
export type Accent =
  | "amber"
  | "blue"
  | "mint"
  | "rose"
  | "violet"
  | "coral"
  | "cyan"
  | "lime";
export type NotchStyle = "dot" | "orb" | "halo" | "wave" | "bar" | "time";
export type DockStyle = "icons" | "labels" | "minimal";
/** Which screen edge the notch hangs from. */
export type Side = "top" | "bottom" | "left" | "right";
export type Placement = { side: Side; flush: boolean };

export type Settings = {
  anchor_x: number | null;
  anchor_y: number | null;
  /** Which edge the notch is parked on; a side dock stands the pill up. */
  side: Side;
  hotkey: string;
  theme: Theme;
  accent: Accent;
  glass: boolean;
  notch: NotchStyle;
  dock: DockStyle;
};

export const api = {
  sysStats: () => invoke<SysStats>("sys_stats"),

  clipList: () => invoke<ClipItem[]>("clip_list"),
  clipPin: (id: string) => invoke<ClipItem[]>("clip_pin", { id }),
  clipDelete: (id: string) => invoke<ClipItem[]>("clip_delete", { id }),
  clipDeleteMany: (ids: string[]) => invoke<ClipItem[]>("clip_delete_many", { ids }),
  clipClear: () => invoke<ClipItem[]>("clip_clear"),
  clipCopy: (id: string) => invoke<boolean>("clip_copy", { id }),

  notesList: () => invoke<Note[]>("notes_list"),
  notesSave: (id: string | null, title: string, body: string) =>
    invoke<Note[]>("notes_save", { id, title, body }),
  notesDelete: (id: string) => invoke<Note[]>("notes_delete", { id }),

  screenSummary: () => invoke<ScreenSummary>("screen_summary"),

  focusGet: () => invoke<FocusState>("focus_get"),
  focusToggle: () => invoke<FocusState>("focus_toggle"),
  focusReset: () => invoke<FocusState>("focus_reset"),
  focusConfig: (workMins: number, breakMins: number) =>
    invoke<FocusState>("focus_config", { workMins, breakMins }),

  weatherGet: () => invoke<WeatherData>("weather_get"),
  weatherSave: (data: WeatherData) => invoke<WeatherData>("weather_save", { data }),

  remindersGet: () => invoke<ReminderData>("reminders_get"),
  remind: (text: string, at: number) => invoke<ReminderData>("reminders_add", { text, at }),
  reminderDelete: (id: string) => invoke<ReminderData>("reminders_delete", { id }),
  reminderConfig: (tone: Tone, anim: RingAnim) =>
    invoke<ReminderData>("reminders_config", { tone, anim }),

  settingsGet: () => invoke<Settings>("settings_get"),
  settingsSet: (settings: Settings) => invoke<void>("settings_set", { settings }),

  setExpanded: (expanded: boolean) => invoke<void>("set_expanded", { expanded }),
  /** Where the notch sits now — drives the corner radius and the dock's axis. */
  dockSide: () => invoke<Placement>("dock_side"),
  /** Runs the OS move loop and resolves only once the mouse is released. */
  beginDrag: () => invoke<void>("begin_drag"),
  /** Settles a finished drag: snaps to an edge, then reports the corner. */
  anchorAfterDrag: () => invoke<Placement>("anchor_after_drag"),
  resetPosition: () => invoke<void>("reset_position"),
  autostartGet: () => invoke<boolean>("autostart_get"),
  autostartSet: (on: boolean) => invoke<boolean>("autostart_set", { on }),
  quit: () => invoke<void>("quit"),
};

export function secs(n: number): string {
  if (n < 60) return `${Math.round(n)}s`;
  const m = Math.floor(n / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

export function ago(ts: number): string {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

/** Short date for note rows: today, yesterday, or a day number. */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (same(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

/** Last 7 local days as seconds, oldest first, so the chart is a week from day one. */
export function week(days: { day: string; secs: number }[]): number[] {
  const out: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    out.push(days.find((x) => x.day === key)?.secs ?? 0);
  }
  return out;
}
