# LemeManage

A minimal notch for Windows. Seven tools, no licence, no account, no telemetry.

Built because Vayli does eighteen things and you use seven of them.

## What it does

| Module | What it shows |
|---|---|
| **Home** | Screen time today, CPU/RAM/Disk rings, last two clips, latest note |
| **Focus** | Pomodoro ring, presets, custom length, today's tally |
| **Reminders** | One-shot reminders with a sound and a notch animation |
| **Notes** | Sidebar of notes, rich-text editor (bold, lists, headings, code), full-panel mode |
| **Clipboard** | Date-grouped cards, search, pin, read, and select-many delete |
| **Screen time** | Today's total, real app icons, per-app share, last seven days |
| **System** | CPU sparkline, memory, disk, battery, uptime |

Everything else — world clocks, currency, file transfer, file shelf, stopwatches,
hydration reminders, calendar, analytics, revenue, the pet — is deliberately absent.

## The interaction

- **Resting:** a 104 × 24 px pill on the top and bottom edges, a 24 × 104 px rail
  on the left and right — always lying along the edge it is parked on, flush, with
  the corners that are still on screen rounded and no rim: the fill alone
  separates it from the wallpaper. It reads as a notch, not a scrollbar or a nav
  bar.
- **Hover it for a moment, or click it:** the pill unfolds into a 560 × 360 panel.
  Leaving tucks it back into the same pill.
- **Drag the notch, or the panel's top bar:** moves it anywhere. Nothing opens
  while the button is held, and a click with a shaky hand is still a click.
- **Let go:** the nearest of the four screen edges wins, measured by perpendicular
  distance, and the notch glides there with an ease-out settle rather than
  snapping. The coordinate *along* that edge is kept exactly where you let go —
  drop two thirds down the left side and it parks two thirds down, not in a
  corner. Top and bottom drops keep their x, side drops keep their y. Nothing
  stays floating, so a drop always ends somewhere that reads as deliberate.
  The notch stands on end on a side edge; a bottom drop only turns the rounding
  around. A side drop opens the panel sideways and turns the dock into a rail,
  and the panel unfolds from the vertical bar it collapsed to.
- **`Ctrl + Shift + Space`:** opens from anywhere, and closes again.
- **`Esc`:** closes.
- **Tray icon:** show, hide, quit.

Closing is one move, not two: the panel folds back into the notch's own
rectangle over 170 ms, and the window shrinks onto the pill that was underneath
it all along. Opening runs the same shape backwards — the panel's content is
clipped out of the notch's rectangle over 280 ms with an ease-out curve, so
every label is at full opacity the whole way instead of arriving out of a grey
ghost.

While a pomodoro is running the resting notch shows `mm:ss` in the accent colour
(stacked top-to-bottom on a side rail), whatever skin is selected — the countdown
is the one thing worth reading without opening anything. Clicking expands as
usual; the panel has the full timer.

The window is resized to match its contents, so collapsed it occupies 104 × 24 px
on the top and bottom edges, 24 × 104 px on the sides, and 30 × 30 for the ring
on any edge, and it does not block anything behind it. The notch itself is a fixed box pinned to its
edge rather than a percentage of the window: Rust resizes the window before React
can unmount the notch, and a percentage-sized pill stretched into an oval for the
frames in between. Position is saved as a point on the chosen edge — centre-x for
the top and bottom edges, centre-y for the sides — so expanding, collapsing or
changing skin can never drift it along the edge.

## Appearance

Settings (gear, top right) is two cards — Appearance and System — so a control
never sits next to something unrelated.

- **Theme** — Dark, Ink, Slate, Sand, Light, Paper.
- **Accent** — Amber, Blue, Mint, Rose, Violet, Coral, Cyan, Lime.
- **Notch** — four skins, each a live miniature above its name in the picker:
  - **Dot** — a 5 px accent dot that stretches into a bar on hover (it grows
    down the rail on a side edge).
  - **Ring** — a 28 px disc in a 30 px window with a 3 px rim: a comet arc and a
    small dot circulate around the track at different speeds and in opposite
    directions. The disc sits 1 px inside the window on every edge, so both sides
    of the circle rasterise identically. Both movers are a fixed gradient rotated
    by a transform, so the compositor moves them without repainting; the loops
    pause while the panel is open and are off under reduced motion. It is the one
    skin that keeps moving at rest — the others are static.
  - **Bar** — a 34 px hairline that widens on hover.
  - **Time** — the time in the foreground colour, tabular figures; the digits
    stack vertically on a side rail.
- **Dock** — Icons, Labels, or Segmented (one capsule, the current module a filled
  segment).
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

## Reminders

Type what you want nudging about, pick a time, and press **Set**; a time already
gone today means tomorrow. Upcoming items sit above the ones that have fired, each
with its day and clock time. Delete removes one item.

Two small choices shape how a reminder arrives:

- **Sound** — *Chime*, *Bell* or *Bowl*. Each is a short WebAudio synth with a
  soft attack and a long tail; picking one plays it.
- **Notch** — the glow, pulse or ripple that runs on the collapsed notch. With
  the panel open, the dot beside the title carries the same cue. Picking one
  previews it.

Both choices and the list live in `reminders.json`. A reminder that came due
while the app was closed is marked done at launch instead of ringing late. The
app allows autoplay, so a due reminder can chime without a click.

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
- `settings.json` — position (`anchor_x`, `anchor_y`, `side`), theme, accent, notch
  and dock style

Writes go to a `.tmp` file and are renamed into place, so a force-kill mid-write
cannot truncate the real file. A UTF-8 BOM is tolerated on load: an editor that
adds one would otherwise make the whole file read as empty and get overwritten.
Saves themselves are serialised, because a second save truncating the shared temp
file would publish a half-written document the same way. Each save also happens
while the lock that owns the value is still held: a snapshot cloned before a newer
write would otherwise land after it and resurrect the older state — observed as a
paused timer starting itself again.

Only one copy runs at a time — a second launch exits on a named mutex. Two
instances would each hold their own snapshot of the clipboard, and whichever
saved last would drop the other's items.

No telemetry and no network calls. Everything stays on the machine.

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
dark    bg #0B0B0E   surface #16161B   surface-2 #202027
ink     bg #0A0F18   surface #131B2B   surface-2 #1C2637
slate   bg #191B20   surface #24272E   surface-2 #2F333B
sand    bg #17130F   surface #221C15   surface-2 #2D251C
light   bg #FBFBFD   surface #F2F2F6   surface-2 #FFFFFF
paper   bg #F5F2EC   surface #EBE7DF   surface-2 #FBF9F5
text #F2F2F5  dim #A6A6B2  faint #777783   (light: #17171C / #54545F / #7F7F8A)
accents amber #F0B429  blue #5AA7FF  mint #2FE6A1  rose #FF5F86
        violet #B18CFF coral #FF7A52 cyan #2FDDE8  lime #B0F03A
```

Type: Segoe UI Variable. Hero numerals 26–34 px at weight 600 with tabular
figures; micro-labels 9.5 px uppercase at 0.1em tracking.

Motion: one spring curve, `cubic-bezier(0.16, 1, 0.3, 1)`. The panel's shape, not
the window, animates: the window resizes in a single frame and a `clip-path` runs
from the notch's rectangle to the full panel, because tweening the window size
reflows the whole tree every frame and looks like a stutter. Every skin is
static at rest except Ring, whose two movers are transform-only on a 30 × 30
layer; it pauses while the panel is open, and nothing animates at all under
reduced motion. A looping paint (a blurred shadow, a gradient that changes per
frame) is what costs a core — measured on this machine, an always-on 60 fps
repaint in the 30 px window took 13–17 % of one core, so nothing here repaints
while it moves.

## Deliberately not built

- Clipboard is text only — images and files are skipped.
- No fullscreen suppression: LemeManage stays on top over games and videos.
- The shortcut is fixed at `Ctrl + Shift + Space`; the Settings row shows it
  but does not rebind it.
