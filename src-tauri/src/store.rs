use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ClipItem {
    pub id: String,
    pub text: String,
    pub ts: i64,
    pub pinned: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub ts: i64,
    pub pinned: bool,
}

/// `default` on the whole struct so a settings file written by an older build
/// (no `side`, no `dock`) still loads instead of resetting every preference.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    pub anchor_x: Option<i32>,
    pub anchor_y: Option<i32>,
    /// Which edge the notch is parked on: "top" | "bottom" | "left" | "right".
    /// A top-corner anchor sits on an edge too, so the axis can no longer be
    /// inferred from the coordinates.
    pub side: String,
    /// Shown in Settings; the binding itself lives in the shortcut registration.
    pub hotkey: String,
    pub theme: String,
    pub accent: String,
    /// Frosted panel instead of solid.
    pub glass: bool,
    /// Collapsed skin: "dot" | "orb" | "bar" | "time"
    pub notch: String,
    /// Dock shape: "icons" | "labels" | "minimal"
    pub dock: String,
}

pub const THEMES: [&str; 6] = ["dark", "ink", "slate", "sand", "light", "paper"];
pub const ACCENTS: [&str; 8] = [
    "amber", "blue", "mint", "rose", "violet", "coral", "cyan", "lime",
];
pub const NOTCHES: [&str; 4] = ["dot", "orb", "bar", "time"];
pub const DOCKS: [&str; 3] = ["icons", "labels", "minimal"];
pub const SIDES: [&str; 4] = ["top", "bottom", "left", "right"];

impl Default for Settings {
    fn default() -> Self {
        Self {
            anchor_x: None,
            anchor_y: None,
            side: "top".into(),
            hotkey: "Ctrl+Shift+Space".into(),
            theme: "dark".into(),
            accent: "amber".into(),
            glass: false,
            notch: "dot".into(),
            dock: "icons".into(),
        }
    }
}

impl Settings {
    /// Older files can name a theme this build no longer ships ("midnight").
    /// Anything unrecognised falls back instead of leaving CSS variables unset.
    pub fn fix(&mut self) {
        if self.theme == "midnight" {
            self.theme = "ink".into();
        }
        if !THEMES.contains(&self.theme.as_str()) {
            self.theme = "dark".into();
        }
        if !ACCENTS.contains(&self.accent.as_str()) {
            self.accent = "amber".into();
        }
        if !NOTCHES.contains(&self.notch.as_str()) {
            self.notch = "dot".into();
        }
        if !DOCKS.contains(&self.dock.as_str()) {
            self.dock = "icons".into();
        }
        if !SIDES.contains(&self.side.as_str()) {
            self.side = "top".into();
        }
    }
}

pub fn load_settings() -> Settings {
    let mut s: Settings = load("settings.json");
    s.fix();
    s
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ScreenData {
    /// "YYYY-MM-DD" -> exe name -> seconds
    pub days: BTreeMap<String, BTreeMap<String, u64>>,
}

/// A one-shot reminder: the text to show, when it is due, and whether it fired.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Reminder {
    pub id: String,
    pub text: String,
    /// Local epoch milliseconds.
    pub at: i64,
    pub done: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct ReminderData {
    pub items: Vec<Reminder>,
    /// Which chime to play and which notch animation to run when one fires.
    pub tone: String,
    pub anim: String,
}

impl Default for ReminderData {
    fn default() -> Self {
        Self {
            items: Vec::new(),
            tone: "chime".into(),
            anim: "glow".into(),
        }
    }
}

impl ReminderData {
    pub fn fix(&mut self) {
        self.items
            .retain(|r| !r.text.trim().is_empty() && r.at > 0);
        for r in &mut self.items {
            r.text = r.text.trim().chars().take(200).collect();
        }
        // Soonest first, so the list reads as a schedule.
        self.items.sort_by_key(|r| r.at);
        self.items.truncate(50);
        if !matches!(self.tone.as_str(), "chime" | "bell" | "bowl") {
            self.tone = "chime".into();
        }
        if !matches!(self.anim.as_str(), "glow" | "pulse" | "ripple") {
            self.anim = "glow".into();
        }
    }
}

/// One pomodoro at a time: a work phase and a break phase, with a tally for today.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct TimerState {
    pub work_secs: u32,
    pub break_secs: u32,
    pub remaining: u32,
    pub running: bool,
    pub is_work: bool,
    pub sessions_today: u32,
    /// "YYYY-MM-DD" the tally belongs to.
    pub day: String,
}

impl Default for TimerState {
    fn default() -> Self {
        Self {
            work_secs: 1500,
            break_secs: 300,
            remaining: 1500,
            running: false,
            is_work: true,
            sessions_today: 0,
            day: String::new(),
        }
    }
}

impl TimerState {
    pub fn phase_secs(&self) -> u32 {
        if self.is_work {
            self.work_secs
        } else {
            self.break_secs
        }
    }

    /// Counts are per day. A timer left running overnight keeps running; only the
    /// tally starts again.
    pub fn roll(&mut self) {
        let day = today();
        if self.day != day {
            self.day = day;
            self.sessions_today = 0;
        }
    }

    /// A hand-edited or older file can hold nonsense; clamp it before the UI does
    /// arithmetic on it.
    pub fn fix(&mut self) {
        self.work_secs = self.work_secs.clamp(60, 180 * 60);
        self.break_secs = self.break_secs.clamp(60, 60 * 60);
        self.remaining = self.remaining.min(self.phase_secs());
        if self.remaining == 0 {
            self.remaining = self.phase_secs();
        }
    }
}

pub fn data_dir() -> PathBuf {
    let root = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let p = root.join("LemeManage");
    // One-time move from the pre-rename folder, so existing history is not orphaned.
    if !p.exists() {
        let _ = fs::rename(root.join("Perch"), &p);
    }
    let _ = fs::create_dir_all(&p);
    p
}

pub fn load<T>(name: &str) -> T
where
    T: for<'de> Deserialize<'de> + Default,
{
    fs::read_to_string(data_dir().join(name))
        .ok()
        // Notepad and PowerShell both like to add a BOM; serde rejects it, and a
        // rejected load resets the file to empty on the next save.
        .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

/// Call this while still holding the lock that owns `v`: a snapshot cloned
/// before a newer write would otherwise land after it and resurrect the older
/// state (a paused timer starting itself again).
pub fn save<T: Serialize>(name: &str, v: &T) {
    if let Ok(s) = serde_json::to_string(v) {
        let dir = data_dir();
        // Write-then-rename: a force-kill mid-write must not truncate the real
        // file, or the next load silently resets to empty.
        //
        // The tmp name is shared, so two saves of the same file must not overlap:
        // one `fs::write` truncating the other's half-written tmp and renaming it
        // into place would publish a torn document, which loads as empty and then
        // gets saved over. Separate commands, the clipboard watcher and the tick
        // threads all save, so this is reachable with a fast double click.
        static SAVE_LOCK: Mutex<()> = Mutex::new(());
        let _guard = SAVE_LOCK.lock();
        let tmp = dir.join(format!("{name}.tmp"));
        if fs::write(&tmp, s).is_ok() {
            let _ = fs::rename(&tmp, dir.join(name));
        }
    }
}

pub fn now_ms() -> i64 {
    chrono::Local::now().timestamp_millis()
}

pub fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

pub fn new_id() -> String {
    format!("{}-{}", now_ms(), rand_suffix())
}

fn rand_suffix() -> u32 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_fall_back_from_retired_skins() {
        // Halo and Wave were removed; a file that still names one must heal on
        // load instead of leaving the notch with no skin.
        let mut s = Settings {
            notch: "wave".into(),
            ..Settings::default()
        };
        s.fix();
        assert_eq!(s.notch, "dot");

        s.notch = "halo".into();
        s.fix();
        assert_eq!(s.notch, "dot");

        s.notch = "orb".into();
        s.fix();
        assert_eq!(s.notch, "orb");
    }

    #[test]
    fn timer_phase_and_midnight_roll() {
        let mut t = TimerState::default();
        assert_eq!(t.phase_secs(), 1500);
        t.is_work = false;
        t.remaining = 0;
        t.fix();
        assert_eq!(t.remaining, 300);

        t.day = "2000-01-01".into();
        t.sessions_today = 4;
        t.roll();
        assert_eq!(t.day, today());
        assert_eq!(t.sessions_today, 0);
    }

    #[test]
    fn reminders_sort_drop_junk_and_keep_known_tones() {
        let mut d = ReminderData::default();
        for (i, at) in [500, 100, 300].iter().enumerate() {
            d.items.push(Reminder {
                id: format!("r{i}"),
                text: format!("  n{i}  "),
                at: *at,
                done: false,
            });
        }
        d.items.push(Reminder {
            id: "blank".into(),
            text: "   ".into(),
            at: 400,
            done: false,
        });
        d.items.push(Reminder {
            id: "never".into(),
            text: "no time".into(),
            at: 0,
            done: false,
        });
        d.tone = "kazoo".into();
        d.anim = "explode".into();
        d.fix();

        assert_eq!(d.items.len(), 3);
        assert_eq!(d.items[0].text, "n1");
        assert!(d.items.windows(2).all(|w| w[0].at < w[1].at));
        assert_eq!((d.tone.as_str(), d.anim.as_str()), ("chime", "glow"));
    }
}
