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
    /// Collapsed skin: "dot" | "orb" | "halo" | "wave" | "bar" | "time"
    pub notch: String,
    /// Dock shape: "icons" | "labels" | "minimal"
    pub dock: String,
}

pub const THEMES: [&str; 6] = ["dark", "ink", "slate", "sand", "light", "paper"];
pub const ACCENTS: [&str; 8] = [
    "amber", "blue", "mint", "rose", "violet", "coral", "cyan", "lime",
];
pub const NOTCHES: [&str; 6] = ["dot", "orb", "halo", "wave", "bar", "time"];
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

/// One saved place, so the weather panel does not ask for a city every launch.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WeatherPlace {
    pub name: String,
    pub region: String,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct WeatherData {
    pub place: Option<WeatherPlace>,
    /// "c" or "f". Anything else falls back to Celsius.
    pub unit: String,
}

impl Default for WeatherData {
    fn default() -> Self {
        Self {
            place: None,
            unit: "c".into(),
        }
    }
}

impl WeatherData {
    /// The panel posts this back, so coordinates come from outside the trust
    /// boundary; a bad one would make every forecast request fail.
    pub fn fix(&mut self) {
        if self.unit != "f" {
            self.unit = "c".into();
        }
        if let Some(p) = &self.place {
            if p.name.trim().is_empty()
                || !(-90.0..=90.0).contains(&p.lat)
                || !(-180.0..=180.0).contains(&p.lon)
            {
                self.place = None;
            }
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

pub fn save<T: Serialize>(name: &str, v: &T) {
    if let Ok(s) = serde_json::to_string(v) {
        let dir = data_dir();
        // Write-then-rename: a force-kill mid-write must not truncate the real
        // file, or the next load silently resets to empty.
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
    fn weather_rejects_bad_coordinates_and_units() {
        let mut w = WeatherData {
            place: Some(WeatherPlace {
                name: "Nowhere".into(),
                region: String::new(),
                lat: 91.0,
                lon: 0.0,
            }),
            unit: "kelvin".into(),
        };
        w.fix();
        assert!(w.place.is_none());
        assert_eq!(w.unit, "c");

        let mut ok = WeatherData {
            place: Some(WeatherPlace {
                name: "London".into(),
                region: "England".into(),
                lat: 51.5,
                lon: -0.12,
            }),
            unit: "f".into(),
        };
        ok.fix();
        assert!(ok.place.is_some());
        assert_eq!(ok.unit, "f");
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
}
