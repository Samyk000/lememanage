#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod store;
mod win;

use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, State, WebviewWindow};

const COL_W: f64 = 104.0;
const COL_H: f64 = 24.0;
/// The orb skin is a circle, so its window is square whatever edge it hangs from.
const ORB: f64 = 30.0;
const EXP_W: f64 = 560.0;
const EXP_H: f64 = 360.0;
/// How long the panel takes to fold back into the notch before the window is
/// allowed to shrink. Kept just over the 170 ms the CSS uses.
const CLOSE_MS: u64 = 200;

/// Bumped by every programmatic move. A settle animation that sees a new value
/// knows something else owns the window now and stops instead of fighting it.
static GLIDE: AtomicU64 = AtomicU64::new(0);

pub struct AppState {
    clip: Mutex<Vec<store::ClipItem>>,
    notes: Mutex<Vec<store::Note>>,
    screen: Mutex<store::ScreenData>,
    timer: Mutex<store::TimerState>,
    reminders: Mutex<store::ReminderData>,
    settings: Mutex<store::Settings>,
    last_clip: Mutex<String>,
    expanded: AtomicBool,
    cpu_prev: Mutex<Option<(u64, u64)>>,
    icons: Mutex<std::collections::HashMap<String, Option<String>>>,
}

#[derive(Serialize, Clone)]
struct AppUse {
    name: String,
    secs: u64,
    icon: Option<String>,
}

#[derive(Serialize, Clone)]
struct DayUse {
    day: String,
    secs: u64,
}

#[derive(Serialize, Clone)]
struct ScreenSummary {
    today_secs: u64,
    apps: Vec<AppUse>,
    days: Vec<DayUse>,
}

#[derive(Serialize, Clone)]
struct ReminderDue {
    texts: Vec<String>,
    tone: String,
    anim: String,
}

#[derive(Serialize, Clone)]
struct Placement {
    /// The screen edge the notch hangs from: "top", "bottom", "left" or "right".
    side: String,
    /// The notch is touching an edge. A drop always settles on one, so this is
    /// true everywhere except the frame before the first layout.
    flush: bool,
}

#[derive(Serialize, Clone)]
struct ExpandedEvent {
    expanded: bool,
    side: String,
    flush: bool,
}

// ---------- layout ----------

fn screen_size(window: &WebviewWindow) -> (f64, f64) {
    match window.current_monitor().ok().flatten() {
        Some(m) => (
            m.size().width as f64 / m.scale_factor(),
            m.size().height as f64 / m.scale_factor(),
        ),
        None => (1920.0, 1080.0),
    }
}

/// Window size for a state. Top and bottom hang a wide pill; the left and right
/// edges get the same pill stood on end, so the notch always lies along the edge
/// it is attached to. The ring is square on every edge, and a running session
/// keeps the edge's own orientation — the digits stack on a side rail.
fn size_for(expanded: bool, side: &str, notch: &str, timer: bool) -> (f64, f64) {
    if expanded {
        return (EXP_W, EXP_H);
    }
    if notch == "orb" && !timer {
        return (ORB, ORB);
    }
    match side {
        "left" | "right" => (COL_H, COL_W),
        _ => (COL_W, COL_H),
    }
}

/// Top-left corner for an edge and an anchor.
///
/// The anchor is the point on the screen edge the notch is attached to: the
/// centre-x on the top and bottom edges, the centre-y on the left and right
/// ones. Keeping it in edge coordinates is what lets a drop stay where you put
/// it along that edge, and survive a resize to a rail or an orb.
fn target_of(side: &str, anchor: (f64, f64), (w, h): (f64, f64), (sw, sh): (f64, f64)) -> (f64, f64) {
    let (x, y) = match side {
        "left" => (0.0, anchor.1 - h / 2.0),
        "right" => (sw - w, anchor.1 - h / 2.0),
        "bottom" => (anchor.0 - w / 2.0, sh - h),
        _ => (anchor.0 - w / 2.0, 0.0),
    };
    (
        x.clamp(0.0, (sw - w).max(0.0)),
        y.clamp(0.0, (sh - h).max(0.0)),
    )
}

/// True while a running session is showing on the resting notch. The panel is a
/// separate world: it has its own countdown, so this only matters collapsed.
fn timer_resting(state: &AppState, expanded: bool) -> bool {
    !expanded && state.timer.lock().running
}

/// Single place that positions and sizes the window for a state.
fn layout(
    window: &WebviewWindow,
    expanded: bool,
    anchor: (f64, f64),
    side: &str,
    notch: &str,
    timer: bool,
) {
    GLIDE.fetch_add(1, Ordering::SeqCst);
    let (sw, sh) = screen_size(window);
    let size = size_for(expanded, side, notch, timer);
    let (x, y) = target_of(side, anchor, size, (sw, sh));
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(size.0, size.1)));
    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
}

/// Slides the window to `to` with an ease-out cubic: quick off the drop, hanging
/// as it arrives. Only the position animates — tweening the size would reflow
/// the whole tree on every frame.
fn glide_to(window: &WebviewWindow, to: (f64, f64), dist: f64) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let Ok(p) = window.outer_position() else {
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(
            to.0, to.1,
        )));
        return;
    };
    let from = (p.x as f64 / scale, p.y as f64 / scale);
    if (from.0 - to.0).abs() < 0.5 && (from.1 - to.1).abs() < 0.5 {
        return;
    }

    let gen = GLIDE.fetch_add(1, Ordering::SeqCst) + 1;
    let win = window.clone();
    // 13ms per step keeps up with a 60Hz compositor without posting more moves
    // than it can paint; the cap keeps a settle inside the post-drag quiet time.
    let steps = ((150.0 + dist * 0.4).clamp(150.0, 320.0) / 13.0).round() as u32;
    std::thread::spawn(move || {
        for i in 1..=steps {
            if GLIDE.load(Ordering::SeqCst) != gen {
                return;
            }
            let t = i as f64 / steps as f64;
            let e = 1.0 - (1.0 - t).powi(3);
            let x = from.0 + (to.0 - from.0) * e;
            let y = from.1 + (to.1 - from.1) * e;
            let _ = win.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
            std::thread::sleep(std::time::Duration::from_millis(13));
        }
    });
}

fn anchor_of(state: &AppState, window: &WebviewWindow) -> (f64, f64) {
    let s = state.settings.lock();
    if let (Some(x), Some(y)) = (s.anchor_x, s.anchor_y) {
        return (x as f64, y as f64);
    }
    drop(s);
    let (sw, _) = screen_size(window);
    (sw / 2.0, 0.0)
}

fn placement_of(state: &AppState) -> Placement {
    let s = state.settings.lock();
    Placement {
        side: s.side.clone(),
        flush: true,
    }
}

// ---------- commands ----------

#[tauri::command(async)]
fn sys_stats(state: State<AppState>) -> win::SysStats {
    let mut prev = state.cpu_prev.lock();
    let cpu = win::cpu_sample(&mut prev);
    win::sys_stats(cpu)
}

#[tauri::command]
fn clip_list(state: State<AppState>) -> Vec<store::ClipItem> {
    state.clip.lock().clone()
}

#[tauri::command(async)]
fn clip_pin(state: State<AppState>, id: String) -> Vec<store::ClipItem> {
    let mut items = state.clip.lock();
    if let Some(it) = items.iter_mut().find(|i| i.id == id) {
        it.pinned = !it.pinned;
    }
    store::save("clipboard.json", &*items);
    items.clone()
}

#[tauri::command(async)]
fn clip_delete(state: State<AppState>, id: String) -> Vec<store::ClipItem> {
    let mut items = state.clip.lock();
    items.retain(|i| i.id != id);
    store::save("clipboard.json", &*items);
    items.clone()
}

#[tauri::command(async)]
fn clip_delete_many(state: State<AppState>, ids: Vec<String>) -> Vec<store::ClipItem> {
    let mut items = state.clip.lock();
    items.retain(|i| !ids.contains(&i.id));
    store::save("clipboard.json", &*items);
    items.clone()
}

#[tauri::command(async)]
fn clip_clear(state: State<AppState>) -> Vec<store::ClipItem> {
    let mut items = state.clip.lock();
    items.retain(|i| i.pinned);
    store::save("clipboard.json", &*items);
    items.clone()
}

#[tauri::command(async)]
fn clip_copy(state: State<AppState>, id: String) -> bool {
    let items = state.clip.lock();
    let Some(it) = items.iter().find(|i| i.id == id) else {
        return false;
    };
    let ok = win::write_clipboard(&it.text);
    *state.last_clip.lock() = it.text.clone();
    ok
}

#[tauri::command]
fn notes_list(state: State<AppState>) -> Vec<store::Note> {
    state.notes.lock().clone()
}

#[tauri::command(async)]
fn notes_save(
    state: State<AppState>,
    id: Option<String>,
    title: String,
    body: String,
) -> Vec<store::Note> {
    let mut notes = state.notes.lock();
    let now = store::now_ms();
    match id {
        Some(id) => {
            if let Some(n) = notes.iter_mut().find(|n| n.id == id) {
                n.title = title;
                n.body = body;
                n.ts = now;
            }
        }
        None => notes.insert(
            0,
            store::Note {
                id: store::new_id(),
                title,
                body,
                ts: now,
                pinned: false,
            },
        ),
    }
    store::save("notes.json", &*notes);
    notes.clone()
}

#[tauri::command(async)]
fn notes_delete(state: State<AppState>, id: String) -> Vec<store::Note> {
    let mut notes = state.notes.lock();
    notes.retain(|n| n.id != id);
    store::save("notes.json", &*notes);
    notes.clone()
}

/// The app must never bill itself. Older recordings still carry the pre-rename name.
fn is_self(exe: &str) -> bool {
    exe.eq_ignore_ascii_case("lememanage.exe") || exe.eq_ignore_ascii_case("perch.exe")
}

#[tauri::command(async)]
fn screen_summary(state: State<AppState>) -> ScreenSummary {
    let sc = state.screen.lock();
    let today = store::today();
    let counted = |m: &std::collections::BTreeMap<String, u64>| -> u64 {
        m.iter()
            .filter(|(k, _)| !is_self(k))
            .map(|(_, v)| *v)
            .sum()
    };

    let mut icons = state.icons.lock();
    let mut apps: Vec<AppUse> = sc
        .days
        .get(&today)
        .map(|m| {
            m.iter()
                .filter(|(k, _)| !is_self(k))
                .map(|(k, v)| AppUse {
                    name: k.clone(),
                    secs: *v,
                    icon: icons
                        .entry(k.clone())
                        .or_insert_with(|| win::app_icon(k))
                        .clone(),
                })
                .collect()
        })
        .unwrap_or_default();
    apps.sort_by(|a, b| b.secs.cmp(&a.secs));
    let today_secs = sc.days.get(&today).map(&counted).unwrap_or(0);
    apps.truncate(6);

    let mut days: Vec<DayUse> = sc
        .days
        .iter()
        .map(|(k, v)| DayUse {
            day: k.clone(),
            secs: counted(v),
        })
        .collect();
    days.sort_by(|a, b| a.day.cmp(&b.day));
    if days.len() > 7 {
        days = days.split_off(days.len() - 7);
    }

    ScreenSummary {
        today_secs,
        apps,
        days,
    }
}

#[tauri::command(async)]
fn focus_get(state: State<AppState>) -> store::TimerState {
    let mut t = state.timer.lock();
    t.roll();
    t.fix();
    t.clone()
}

#[tauri::command(async)]
fn focus_toggle(app: tauri::AppHandle, state: State<AppState>) -> store::TimerState {
    let mut t = state.timer.lock();
    t.roll();
    // A phase that already ran out restarts instead of stopping on the same tick.
    if t.remaining == 0 {
        t.remaining = t.phase_secs();
    }
    t.running = !t.running;
    store::save("timers.json", &*t);
    let snap = t.clone();
    drop(t);
    let _ = app.emit("focus-updated", &snap);
    snap
}

#[tauri::command(async)]
fn focus_reset(app: tauri::AppHandle, state: State<AppState>) -> store::TimerState {
    let mut t = state.timer.lock();
    t.roll();
    t.running = false;
    t.is_work = true;
    t.remaining = t.work_secs;
    store::save("timers.json", &*t);
    let snap = t.clone();
    drop(t);
    let _ = app.emit("focus-updated", &snap);
    snap
}

#[tauri::command(async)]
fn focus_config(
    app: tauri::AppHandle,
    state: State<AppState>,
    work_mins: u32,
    break_mins: u32,
) -> store::TimerState {
    let mut t = state.timer.lock();
    t.roll();
    t.work_secs = work_mins.clamp(1, 180) * 60;
    t.break_secs = break_mins.clamp(1, 60) * 60;
    // Picking a length is a fresh start, not a resize of the running phase.
    t.running = false;
    t.is_work = true;
    t.remaining = t.work_secs;
    store::save("timers.json", &*t);
    let snap = t.clone();
    drop(t);
    let _ = app.emit("focus-updated", &snap);
    snap
}

#[tauri::command]
fn reminders_get(state: State<AppState>) -> store::ReminderData {
    state.reminders.lock().clone()
}

#[tauri::command(async)]
fn reminders_add(state: State<AppState>, text: String, at: i64) -> store::ReminderData {
    let mut data = state.reminders.lock();
    data.items.push(store::Reminder {
        id: store::new_id(),
        text,
        at,
        done: false,
    });
    data.fix();
    store::save("reminders.json", &*data);
    data.clone()
}

#[tauri::command(async)]
fn reminders_delete(state: State<AppState>, id: String) -> store::ReminderData {
    let mut data = state.reminders.lock();
    data.items.retain(|r| r.id != id);
    store::save("reminders.json", &*data);
    data.clone()
}

#[tauri::command(async)]
fn reminders_config(state: State<AppState>, tone: String, anim: String) -> store::ReminderData {
    let mut data = state.reminders.lock();
    data.tone = tone;
    data.anim = anim;
    data.fix();
    store::save("reminders.json", &*data);
    data.clone()
}

#[tauri::command]
fn settings_get(state: State<AppState>) -> store::Settings {
    state.settings.lock().clone()
}

#[tauri::command(async)]
fn settings_set(app: tauri::AppHandle, state: State<AppState>, mut settings: store::Settings) {
    let reshaped;
    {
        // Position belongs to the window code, not the UI. React's copy of it
        // goes stale the moment a drag settles, so a theme or dock click would
        // otherwise post the pre-drag anchor back and the next layout would
        // snap the notch to where it used to be.
        let cur = state.settings.lock();
        settings.anchor_x = cur.anchor_x;
        settings.anchor_y = cur.anchor_y;
        settings.side = cur.side.clone();
        reshaped = cur.notch != settings.notch;
    }
    settings.fix();
    *state.settings.lock() = settings.clone();
    store::save("settings.json", &settings);

    // The orb is a circle, so a skin change alters the window's footprint while
    // the notch is collapsed. Nothing else needs a relayout: themes and accents
    // are pure CSS.
    if reshaped {
        let Some(window) = app.get_webview_window("notch") else {
            return;
        };
        let expanded = state.expanded.load(Ordering::Relaxed);
        let anchor = anchor_of(&state, &window);
        layout(&window, expanded, anchor, &settings.side, &settings.notch, timer_resting(&state, expanded));
    }
}

/// Single place that moves/resizes the window, so hover, Escape and the hotkey
/// can never disagree about the current state.
fn apply_expanded(app: &tauri::AppHandle, expanded: bool) {
    eprintln!("[lememanage] apply_expanded: expanded={}", expanded);
    let Some(window) = app.get_webview_window("notch") else {
        return;
    };
    let state = app.state::<AppState>();
    let was = state.expanded.swap(expanded, Ordering::Relaxed);

    if !expanded && was {
        // Closing is the one move that waits. React folds the panel back into
        // the notch over ~170 ms, and the notch has been sitting underneath the
        // panel the whole time, so the window can only shrink once that has
        // played — otherwise the panel is cut off by a window that is already a
        // 104 × 24 pill.
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(CLOSE_MS));
            let state = app.state::<AppState>();
            // Re-opened while we waited: this collapse lost, and resizing now
            // would guillotine the panel that is already back.
            if state.expanded.load(Ordering::Relaxed) {
                return;
            }
            let Some(window) = app.get_webview_window("notch") else {
                return;
            };
            let anchor = anchor_of(&state, &window);
            let (side, notch) = {
                let s = state.settings.lock();
                (s.side.clone(), s.notch.clone())
            };
            layout(&window, false, anchor, &side, &notch, timer_resting(&state, false));
            if let Ok(h) = window.hwnd() {
                win::set_no_activate(h.0 as isize, true);
            }
        });
        return;
    }

    let anchor = anchor_of(&state, &window);
    let (side, notch) = {
        let s = state.settings.lock();
        (s.side.clone(), s.notch.clone())
    };
    layout(&window, expanded, anchor, &side, &notch, timer_resting(&state, expanded));
    if let Ok(h) = window.hwnd() {
        win::set_no_activate(h.0 as isize, !expanded);
    }
    if expanded {
        // A tray "Hide" must not make the hotkey look broken.
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Tells React both the phase and the corner, so the dock can turn vertical.
fn emit_expanded(app: &tauri::AppHandle, expanded: bool) {
    let st = app.state::<AppState>();
    let p = placement_of(&st);
    let _ = app.emit(
        "expanded-changed",
        ExpandedEvent {
            expanded,
            side: p.side,
            flush: p.flush,
        },
    );
}

#[tauri::command]
fn set_expanded(app: tauri::AppHandle, expanded: bool) {
    apply_expanded(&app, expanded);
    // Keep React in step whatever moved the window (hover, Escape, hotkey).
    emit_expanded(&app, expanded);
}

#[tauri::command]
fn dock_side(state: State<AppState>) -> Placement {
    placement_of(&state)
}

#[tauri::command(async)]
fn autostart_get() -> bool {
    win::autostart_get()
}

#[tauri::command(async)]
fn autostart_set(on: bool) -> bool {
    win::autostart_set(on)
}

/// Starts the OS move loop and does not return until the button is released.
///
/// `start_dragging()` on Windows only queues the move to the event loop, so it
/// resolves before the window has moved an inch. Reading the position right
/// after it therefore returned the old spot, the settle was skipped as a "click",
/// and the next layout snapped the notch back. Waiting here fixes both.
#[tauri::command(async)]
fn begin_drag(window: WebviewWindow) {
    // A glide still in flight would fight the move loop for the window.
    GLIDE.fetch_add(1, Ordering::SeqCst);
    if window.start_dragging().is_err() {
        return;
    }
    // 12ms polls for at most 20s: a held button never strands this thread, and
    // the cost while dragging is one GetAsyncKeyState call per frame.
    for _ in 0..1600 {
        if !win::left_button_down() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(12));
    }
    // The move loop finishes on the message queue; one more frame lets the final
    // WM_MOVE land so the caller reads the position the user actually dropped at.
    std::thread::sleep(std::time::Duration::from_millis(60));
}

/// Settles a finished drag: the nearest edge wins, then the window glides there.
///
/// The edge is chosen by perpendicular distance, and the coordinate *along* it
/// is kept exactly where you let go — drop two-thirds down the left side and it
/// parks two-thirds down, not in a corner. Top and bottom drops keep their x,
/// side drops keep their y. Nothing ever stays floating, so a drop always ends
/// somewhere that reads as deliberate.
#[tauri::command(async)]
fn anchor_after_drag(state: State<AppState>, window: WebviewWindow) -> Placement {
    let scale = window.scale_factor().unwrap_or(1.0);
    let Ok(p) = window.outer_position() else {
        return placement_of(&state);
    };
    let (sw, sh) = screen_size(&window);
    let expanded = state.expanded.load(Ordering::Relaxed);
    let (cur_side, notch) = {
        let s = state.settings.lock();
        (s.side.clone(), s.notch.clone())
    };
    // Measure with the rectangle the user actually sees, so the gaps are real.
    let (w, h) = size_for(expanded, &cur_side, &notch, timer_resting(&state, expanded));

    // A drag can end past an edge; clamp before measuring the gaps.
    let left = (p.x as f64 / scale).clamp(0.0, (sw - w).max(0.0));
    let top = (p.y as f64 / scale).clamp(0.0, (sh - h).max(0.0));

    let d_top = top;
    let d_bottom = (sh - (top + h)).max(0.0);
    let d_left = left;
    let d_right = (sw - (left + w)).max(0.0);

    let side = if d_top <= d_left && d_top <= d_right && d_top <= d_bottom {
        "top"
    } else if d_bottom <= d_left && d_bottom <= d_right {
        "bottom"
    } else if d_left <= d_right {
        "left"
    } else {
        "right"
    };

    // The anchor is a point on the chosen edge, in edge coordinates.
    let anchor = match side {
        "left" => (0.0, top + h / 2.0),
        "right" => (sw, top + h / 2.0),
        "bottom" => (left + w / 2.0, sh),
        _ => (left + w / 2.0, 0.0),
    };

    {
        let mut s = state.settings.lock();
        s.anchor_x = Some(anchor.0.round() as i32);
        s.anchor_y = Some(anchor.1.round() as i32);
        s.side = side.into();
        let snap = s.clone();
        drop(s);
        store::save("settings.json", &snap);
    }

    let size = size_for(expanded, side, &notch, timer_resting(&state, expanded));
    // One resize up front: the orientation flip is a single reflow, then only
    // the position animates. An expanded panel keeps its size and just slides.
    if !expanded {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(size.0, size.1)));
    }
    let (tx, ty) = target_of(side, anchor, size, (sw, sh));
    let dist = ((tx - left).powi(2) + (ty - top).powi(2)).sqrt();
    glide_to(&window, (tx, ty), dist);

    Placement {
        side: side.into(),
        flush: true,
    }
}

#[tauri::command]
fn reset_position(state: State<AppState>, window: WebviewWindow) {
    let notch;
    {
        let mut s = state.settings.lock();
        s.anchor_x = None;
        s.anchor_y = None;
        s.side = "top".into();
        notch = s.notch.clone();
        let snap = s.clone();
        drop(s);
        store::save("settings.json", &snap);
    }
    let anchor = anchor_of(&state, &window);
    let expanded = state.expanded.load(Ordering::Relaxed);
    layout(&window, expanded, anchor, "top", &notch, timer_resting(&state, expanded));
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

// ---------- entry ----------

fn main() {
    if win::already_running() {
        eprintln!("[lememanage] another instance is already running; exiting immediately.");
        return;
    }

    // WebView2's GPU compositor paints nothing (blank white window) on machines with a
    // broken virtual display adapter. Software compositing costs nothing at this size.
    if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            // Autoplay is allowed so a reminder chime can play without a click.
            "--disable-gpu-compositing --autoplay-policy=no-user-gesture-required",
        );
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            clip: Mutex::new(store::load("clipboard.json")),
            notes: Mutex::new(store::load("notes.json")),
            screen: Mutex::new({
                let mut sc: store::ScreenData = store::load("screentime.json");
                sc.prune();
                sc
            }),
            timer: Mutex::new({
                let mut t: store::TimerState = store::load("timers.json");
                t.fix();
                t.roll();
                t
            }),
            reminders: Mutex::new({
                let mut r: store::ReminderData = store::load("reminders.json");
                r.fix();
                // Startup is silent: a reminder that came due while the app was
                // closed is marked done instead of ringing all at once.
                let now = store::now_ms();
                for it in &mut r.items {
                    if it.at <= now {
                        it.done = true;
                    }
                }
                r
            }),
            settings: Mutex::new(store::load_settings()),
            last_clip: Mutex::new(String::new()),
            expanded: AtomicBool::new(false),
            cpu_prev: Mutex::new(None),
            icons: Mutex::new(std::collections::HashMap::new()),
        })
        .invoke_handler(tauri::generate_handler![
            sys_stats,
            clip_list,
            clip_pin,
            clip_delete,
            clip_delete_many,
            clip_clear,
            clip_copy,
            notes_list,
            notes_save,
            notes_delete,
            screen_summary,
            focus_get,
            focus_toggle,
            focus_reset,
            focus_config,
            reminders_get,
            reminders_add,
            reminders_delete,
            reminders_config,
            settings_get,
            settings_set,
            set_expanded,
            dock_side,
            anchor_after_drag,
            reset_position,
            begin_drag,
            autostart_get,
            autostart_set,
            quit
        ])
        .setup(|app| {
            let window = app.get_webview_window("notch").unwrap();
            {
                let st = app.state::<AppState>();
                let anchor = anchor_of(&st, &window);
                let (side, notch) = {
                    let s = st.settings.lock();
                    (s.side.clone(), s.notch.clone())
                };
                eprintln!("[lememanage] setup layout: anchor={:?}, side={}, notch={}", anchor, side, notch);
                layout(&window, false, anchor, &side, &notch, timer_resting(&st, false));
                // Seed the CPU baseline so the first poll reports a real figure, not 0%.
                win::cpu_sample(&mut st.cpu_prev.lock());
            }
            let show_res = window.show();
            eprintln!("[lememanage] window.show(): {:?}", show_res);
            eprintln!("[lememanage] window.is_visible(): {:?}", window.is_visible());
            eprintln!("[lememanage] window.outer_position(): {:?}", window.outer_position());
            eprintln!("[lememanage] window.outer_size(): {:?}", window.outer_size());
            if let Ok(h) = window.hwnd() {
                win::set_no_activate(h.0 as isize, true);
            }

            // clipboard watcher. The sequence number is a single cheap call, so
            // the clipboard itself is only opened when its contents changed.
            let h1 = app.handle().clone();
            std::thread::spawn(move || {
                let mut seen = win::clipboard_seq();
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    let seq = win::clipboard_seq();
                    if seq == seen {
                        continue;
                    }
                    seen = seq;
                    let Some(text) = win::read_clipboard() else {
                        continue;
                    };
                    let st = h1.state::<AppState>();
                    {
                        let mut last = st.last_clip.lock();
                        if *last == text {
                            continue;
                        }
                        *last = text.clone();
                    }
                    let mut items = st.clip.lock();
                    items.retain(|i| i.text != text);
                    items.insert(
                        0,
                        store::ClipItem {
                            id: store::new_id(),
                            text,
                            ts: store::now_ms(),
                            pinned: false,
                        },
                    );
                    while items.iter().filter(|i| !i.pinned).count() > 200 {
                        match items.iter().rposition(|i| !i.pinned) {
                            Some(p) => {
                                items.remove(p);
                            }
                            None => break,
                        }
                    }
                    store::save("clipboard.json", &*items);
                    drop(items);
                    let _ = h1.emit("clip-updated", ());
                }
            });

            // screen time watcher
            let h2 = app.handle().clone();
            std::thread::spawn(move || {
                let mut tick: u32 = 0;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let st = h2.state::<AppState>();
                    if let Some(exe) = win::foreground_exe() {
                        // Never bill this app itself; the exe name casing varies by build path.
                        if !is_self(&exe) {
                            {
                                let mut sc = st.screen.lock();
                                let day = store::today();
                                *sc.days.entry(day).or_default().entry(exe.clone()).or_insert(0) += 1;
                            }
                            // Resolve the icon while the app is still running: once it
                            // exits, only App Paths can find it, and most apps do not
                            // register there. The screen lock is already released, so
                            // this can never cycle with screen_summary's lock order.
                            let mut icons = st.icons.lock();
                            if !icons.contains_key(&exe) {
                                icons.insert(exe.clone(), win::app_icon(&exe));
                            }
                        }
                    }
                    tick += 1;
                    if tick % 15 == 0 {
                        let mut sc = st.screen.lock();
                        sc.prune();
                        store::save("screentime.json", &*sc);
                        drop(sc);
                        let _ = h2.emit("screen-updated", ());
                    }
                }
            });

            // focus timer: one tick per second while running, saved on a phase end
            // and every ten seconds so a hard kill loses at most a few seconds.
            let h3 = app.handle().clone();
            std::thread::spawn(move || {
                let mut tick: u32 = 0;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let st = h3.state::<AppState>();
                    let mut t = st.timer.lock();
                    t.roll();
                    let mut ended = false;
                    let mut tick_state = None;
                    if t.running {
                        t.remaining = t.remaining.saturating_sub(1);
                        if t.remaining == 0 {
                            if t.is_work {
                                t.sessions_today += 1;
                            }
                            t.is_work = !t.is_work;
                            t.remaining = t.phase_secs();
                            // A finished phase stops; starting the next one is a click.
                            t.running = false;
                            ended = true;
                        }
                        tick_state = Some(t.clone());
                    }
                    tick += 1;
                    if ended || (t.running && tick % 10 == 0) {
                        store::save("timers.json", &*t);
                    }
                    drop(t);

                    if let Some(s) = tick_state {
                        let _ = h3.emit("focus-tick", s);
                    }
                    // The pill was only ever wide enough for the countdown, so
                    // the orb gets its circle back the moment the session stops.
                    if ended {
                        // Tell React the countdown is over before the window
                        // shrinks: its own poll is up to a second behind and
                        // would paint digits into a 30 px circle.
                        let _ = h3.emit("focus-updated", ());
                        if !st.expanded.load(Ordering::Relaxed) {
                            let orb = st.settings.lock().notch == "orb";
                            if orb {
                                apply_expanded(&h3, false);
                            }
                        }
                    }
                }
            });

            // reminders: a one-second tick. Only items that were pending and are now
            // due are collected, so a restart never replays old ones.
            let h4 = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let st = h4.state::<AppState>();
                let mut data = st.reminders.lock();
                let now = store::now_ms();
                let mut texts = Vec::new();
                for r in data.items.iter_mut() {
                    if !r.done && r.at <= now {
                        r.done = true;
                        texts.push(r.text.clone());
                    }
                }
                if texts.is_empty() {
                    continue;
                }
                let due = ReminderDue {
                    texts,
                    tone: data.tone.clone(),
                    anim: data.anim.clone(),
                };
                store::save("reminders.json", &*data);
                drop(data);
                let _ = h4.emit("reminder-due", due);
            });

            // tray
            let show = MenuItem::with_id(app, "show", "Show LemeManage", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit_item])?;
            if let Some(icon) = app.default_window_icon() {
                TrayIconBuilder::new()
                    .icon(icon.clone())
                    .tooltip("LemeManage")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            let next = !app.state::<AppState>().expanded.load(Ordering::Relaxed);
                            apply_expanded(app, next);
                            emit_expanded(app, next);
                        }
                    })
                    .on_menu_event(|app, ev| match ev.id().as_ref() {
                        "show" => {
                            apply_expanded(app, true);
                            emit_expanded(app, true);
                        }
                        "hide" => {
                            apply_expanded(app, false);
                            emit_expanded(app, false);
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .build(app)?;
            }

            // global hotkey: toggle from anywhere. Rust owns the toggle so the
            // hotkey and the hover path can never disagree; React mirrors the event.
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };
                let sc = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
                let _ = app.global_shortcut().on_shortcut(sc, |app, _, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let next = !app
                        .state::<AppState>()
                        .expanded
                        .load(std::sync::atomic::Ordering::Relaxed);
                    apply_expanded(app, next);
                    emit_expanded(app, next);
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running lememanage");
}
