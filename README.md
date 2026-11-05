# LemeManage

A minimal notch for Windows. Seven tools, no licence, no account, no telemetry.

Built because Vayli does eighteen things and you use seven of them.

## What it does

| Module | What it shows |
|---|---|
| **Home** | Screen time today, CPU/RAM/Disk rings, last two clips, latest note |
| **Focus** | Pomodoro ring and reminders, in two tabs |
| **Weather** | Current conditions, next eight hours, four days, °C/°F, city search |
| **Notes** | Sidebar of notes, rich-text editor (bold, lists, headings, code), full-panel mode |
| **Clipboard** | Date-grouped cards, search, pin, read, and select-many delete |
| **Screen time** | Today's total, real app icons, per-app share, last seven days |
| **System** | CPU sparkline, memory, disk, battery, uptime |

Everything else — world clocks, currency, file transfer, file shelf, stopwatches,
hydration reminders, calendar, analytics, revenue, the pet — is deliberately absent.

## The interaction

- **Resting:** a 104 × 24 px notch, flush with the edge it is parked on, with the
  corners that are still on screen rounded. It reads as a notch, not a scrollbar
  or a nav bar.
- **Hover it for a moment, or click it:** expands to 560 × 360, growing down from
  the notch. Leaving tucks it back in.
- **Drag the notch, or the panel's top bar:** moves it anywhere.
- **Let go:** the nearest of the four screen edges wins, measured by perpendicular
  distance, and the notch glides there with an ease-out settle rather than
  snapping. The coordinate *along* that edge is kept exactly where you let go —
  drop two thirds down the left side and it parks two thirds down, not in a
  corner. Top and bottom drops keep their x, side drops keep their y. Nothing
  stays floating, so a drop always ends somewhere that reads as deliberate.
  A bottom drop hangs the pill upside down and opens the panel upward; a side drop
  stands it up as a vertical rail and the dock turns into a rail too.
- **`Ctrl + Shift + Space`:** opens from anywhere, and closes again.
- **`Esc`:** closes.
- **Tray icon:** show, hide, quit.

Closing is immediate: the panel unmounts and the window shrinks in the same
frame, then the notch fades in. There is no fade-out phase to wait through.

The window is resized to match its contents, so collapsed it occupies 104 × 24 px
(30 × 30 for the round orb) and does not block anything behind it. Position is
saved as a point on the chosen edge — centre-x for the top and bottom edges,
centre-y for the sides — so expanding, collapsing or changing skin can never
drift it along the edge.

## Appearance

Settings (gear, top right) is two cards — Appearance and System — so a control
never sits next to something unrelated.

- **Theme** — Dark, Ink, Slate, Sand, Light, Paper.
- **Accent** — Amber, Blue, Mint, Rose, Violet, Coral, Cyan, Lime.
- **Notch** — six skins, each shown as a live miniature in the picker:
  - **Dot** — a 5 px accent dot that stretches into a bar on hover.
  - **Orb** — a 30 × 30 circle with two accent gradients drifting inside it like
    smoke. The window itself is the circle, so it is round on every edge.
  - **Halo** — a thin accent ring with a lit core.
  - **Wave** — four bars that grow into an equaliser on hover.
  - **Bar** — a 34 px hairline that widens on hover.
  - **Time** — the time, tabular figures, vertical on a side rail.
- **Dock** — Icons, Labels, or Minimal (hairline ring only).
- **Frosted glass** — translucent panel instead of solid.

## Clipboard

History is grouped by day (Today, Yesterday, then dates), newest first, three
cards per row. A card shows the type icon (link, code, text), the time, and the
first two lines. **Clicking a card opens a reader** — the full text, its length,
pin, delete, and Copy — instead of copying on click, so a misclick can never
overwrite what you had on the clipboard. Pinned items get their own strip above
the dates. Search filters across every group.

The tick button beside the search count switches to selection: tap cards to
choose them, **All** takes the whole list, and **Delete** removes exactly what is
selected in a single write. **Cancel** returns to search without touching
anything.

## Notes

The list on the left is the sidebar; the arrow icon in the editor's top bar makes
the note fill the panel and folds the sidebar away, so long text gets the whole
width. The same icon brings the list back.

## Focus

A single pomodoro cycle: 25 minutes of work, a 5-minute break, and a tally of
completed work sessions. Start and pause keep the remaining time; Reset returns
to the first work phase. The 15/25/50 presets restart at that length, and the box
beside them takes any work length from 1 to 180 minutes (Enter or **Set**). The
ring fills as the phase counts down, and a finished phase stops on the next one
instead of rolling over on its own. The count survives a restart; the tally
starts again at midnight.

The **Reminders** tab is the other half of Focus. Type what you want nudging
about, pick a time, and press **Set**; a time already gone today means tomorrow.
Upcoming items sit above the ones that have fired, each with its day and clock
time. Delete removes one item.

Two small choices shape how a reminder arrives:

- **Sound** — *Chime*, *Bell* or *Bowl*. Each is a short WebAudio synth with a
  soft attack and a long tail; picking one plays it.
- **Notch** — the glow, pulse or ripple that runs on the collapsed notch. With
  the panel open, the dot beside the title carries the same cue. Picking one
  previews it.

Both choices and the list live in `reminders.json`. A reminder that came due
while the app was closed is marked done at launch instead of ringing late. The
app allows autoplay, so a due reminder can chime without a click.

## Weather

Pick a city once and the panel fetches a forecast from Open-Meteo, a keyless
public API. It shows the current temperature, what it feels like, the next eight
hours, and four days. The unit toggle (°C/°F) is remembered. Nothing else is
sent: the request carries the coordinates you chose and nothing about you.
Search needs the network too; without it the panel keeps the last forecast and
says so.

## Why it is small

| | Vayli | LemeManage |
|---|---|---|
| Modules | 18 | 7 |
| File-transfer host | 104.9 MB ASP.NET | none |
| Licence check | phones home | none |
| Trial | 3 days, device hash | free |

## Run it

```sh
cd perch
npm install
npm run tauri dev      # development
npm run tauri build    # release + installer
```

Or run the built binary directly: `src-tauri/target/release/lememanage.exe`

`cargo build --release` alone also works: the `custom-protocol` feature is on by
default, so it embeds `dist/` — run `npm run build` first. The trade-off is that
`npm run tauri dev` serves the built assets too; drop `custom-protocol` from
`Cargo.toml` when you want Vite HMR.

## Settings

- **Theme / accent / notch skin / dock style / frosted glass** — appearance.
- **Start with Windows** — writes `HKCU\...\Run` through the registry API, no
  elevation and no `reg.exe` process.
- **Reset position** — back to top centre.
- **Clear clipboard** — drops everything unpinned.
- **Quit** — exits; the tray icon stays until then.

## Data

Plain JSON in `%APPDATA%\LemeManage\`:

- `clipboard.json` — capped at 200 unpinned items
- `notes.json` — note bodies are HTML (from the editor)
- `screentime.json` — per app, per day, in seconds
- `timers.json` — pomodoro lengths, the running phase, and today's completed sessions
- `reminders.json` — reminder items plus the chosen sound and notch animation
- `weather.json` — the saved city and the °C/°F choice
- `settings.json` — position (`anchor_x`, `anchor_y`, `side`), theme, accent, notch
  and dock style

Writes go to a `.tmp` file and are renamed into place, so a force-kill mid-write
cannot truncate the real file. A UTF-8 BOM is tolerated on load: an editor that
adds one would otherwise make the whole file read as empty and get overwritten.
Saves themselves are serialised, because a second save truncating the shared temp
file would publish a half-written document the same way.

Only one copy runs at a time — a second launch exits on a named mutex. Two
instances would each hold their own snapshot of the clipboard, and whichever
saved last would drop the other's items.

No telemetry. The weather panel's Open-Meteo lookup is the only network call, and
it only happens for a city you added. Everything else stays on the machine.

## Privacy behaviour kept on purpose

- Clipboard reads honour `Clipboard Viewer Ignore`,
  `ExcludeClipboardContentFromMonitorProcessing` and
  `CanIncludeInClipboardHistory`, so password managers are skipped.
- Screen time records process names only — no keystrokes, no window titles,
  no screenshots. LemeManage never bills its own window. App icons are read from the
  exe with `SHGetFileInfoW` and cached in memory; the path is never stored. The
  icon is resolved the first time an app comes to the foreground, and falls back
  to the shell's `App Paths` registry entry for apps that ran before LemeManage
  started, so a closed app still shows its real icon.
- Note paste is forced to plain text, so copied markup cannot inject into a note.
- The collapsed window is `WS_EX_NOACTIVATE`, so hovering never steals focus
  from what you are typing in.

## One Windows quirk worth knowing

WebView2's GPU compositor paints **nothing** — a blank white window — on
machines with a display adapter in an error state. `main.rs` sets
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu-compositing` unless you
already set it yourself, which keeps GPU rasterization but composites on the
CPU. At 560 × 352 the cost is invisible; the alternative is an app that shows
a white rectangle on some machines.

## Design tokens

Six themes, one accent at a time, three dock styles. Everything is a CSS variable
on `<html>`, so switching is a single `data-theme` / `data-accent` / `data-dock`
attribute write.

```
dark    bg #0B0B0E   surface #131317   text #F2F2F5
ink     bg #0A0F18   surface #101725   text #E9EEF8
slate   bg #191B20   surface #202329   text #F1F2F5
sand    bg #17130F   surface #1E1913   text #F6EFE6
light   bg #FBFBFD   surface #F2F2F6   text #17171C
paper   bg #F5F2EC   surface #EBE7DF   text #221F1A
accents amber #F0B429  blue #4C9AFF  mint #3DDC97  rose #FF6B8B
        violet #A78BFA coral #FF7A59 cyan #38D6E0  lime #A3E635
```

Type: Segoe UI Variable. Hero numerals 26–34 px at weight 600 with tabular
figures; micro-labels 9.5 px uppercase at 0.1em tracking.

Motion: one spring curve, `cubic-bezier(0.16, 1, 0.3, 1)`. The window resizes in
a single frame and the panel animates inside it — tweening the window size
reflows the whole tree every frame and looks like a stutter. Nothing loops while
the notch rests: an infinite keyframe keeps the compositor awake all day.
Measured on this machine, an always-on 60 fps animation in the 30 px orb window
cost 13–17 % of one core, so the fog is `animation-play-state: paused` and only
runs while the cursor is on it — resting cost is 0.00 % of a core.

## Deliberately not built

- Clipboard is text only — images and files are skipped.
- No fullscreen suppression: LemeManage stays on top over games and videos.
- The shortcut is fixed at `Ctrl + Shift + Space`; the Settings row shows it
  but does not rebind it.
