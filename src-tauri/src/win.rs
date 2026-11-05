#![allow(non_snake_case)]

use serde::Serialize;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, HGLOBAL, HWND};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, FILE_ATTRIBUTE_NORMAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
    OpenClipboard, RegisterClipboardFormatW,
};
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Registry::{
    RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, REG_SZ,
    RRF_RT_REG_SZ,
};
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::SystemInformation::{GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX};
use windows::Win32::System::Threading::{
    GetSystemTimes, OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
use windows::Win32::UI::WindowsAndMessaging::{
    DestroyIcon, DrawIconEx, GetForegroundWindow, GetWindowLongPtrW, GetWindowThreadProcessId,
    SetWindowLongPtrW, DI_NORMAL, GWL_EXSTYLE, WS_EX_NOACTIVATE,
};

const CF_UNICODETEXT: u32 = 13;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn ft(t: FILETIME) -> u64 {
    ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SysStats {
    pub cpu: f32,
    pub mem_used: u64,
    pub mem_total: u64,
    pub disk_used: u64,
    pub disk_total: u64,
    pub battery: Option<u8>,
    pub charging: bool,
    pub uptime_secs: u64,
}

/// Samples CPU between calls; first call returns 0 and seeds the baseline.
pub fn cpu_sample(prev: &mut Option<(u64, u64)>) -> f32 {
    unsafe {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_err() {
            return 0.0;
        }
        let idle = ft(idle);
        let total = ft(kernel) + ft(user);
        let cur = (total, idle);
        let out = match *prev {
            None => 0.0,
            Some((pt, pi)) => {
                let dt = total.saturating_sub(pt);
                let di = idle.saturating_sub(pi);
                if dt == 0 {
                    0.0
                } else {
                    (100.0 * (dt.saturating_sub(di)) as f64 / dt as f64) as f32
                }
            }
        };
        *prev = Some(cur);
        out
    }
}

pub fn sys_stats(cpu: f32) -> SysStats {
    unsafe {
        let mut m = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        let (mut mem_used, mut mem_total) = (0, 0);
        if GlobalMemoryStatusEx(&mut m).is_ok() {
            mem_total = m.ullTotalPhys;
            mem_used = m.ullTotalPhys - m.ullAvailPhys;
        }

        let (mut disk_used, mut disk_total) = (0, 0);
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
        let root = wide(&format!("{}\\", drive));
        let (mut free, mut total) = (0u64, 0u64);
        if GetDiskFreeSpaceExW(
            PCWSTR(root.as_ptr()),
            Some(&mut free),
            Some(&mut total),
            None,
        )
        .is_ok()
        {
            disk_total = total;
            disk_used = total.saturating_sub(free);
        }

        let mut ps = SYSTEM_POWER_STATUS::default();
        let (battery, charging) = if GetSystemPowerStatus(&mut ps).is_ok() {
            let pct = if ps.BatteryLifePercent == 255 {
                None
            } else {
                Some(ps.BatteryLifePercent)
            };
            (pct, ps.ACLineStatus == 1)
        } else {
            (None, true)
        };

        let uptime_secs = uptime();

        SysStats {
            cpu,
            mem_used,
            mem_total,
            disk_used,
            disk_total,
            battery,
            charging,
            uptime_secs,
        }
    }
}

fn uptime() -> u64 {
    unsafe { GetTickCount64() / 1000 }
}

/// True while the primary mouse button is held, anywhere on the desktop.
///
/// Used to wait out the OS window-move loop, which `start_dragging()` only
/// queues: without this the caller reads the window position before it moved.
pub fn left_button_down() -> bool {
    unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000 != 0 }
}

/// Executable file name of the current foreground window, e.g. "Code.exe".
pub fn foreground_exe() -> Option<String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        if ok.is_err() || len == 0 {
            return None;
        }
        let full = String::from_utf16_lossy(&buf[..len as usize]);
        Some(
            full.rsplit(['\\', '/'])
                .next()
                .unwrap_or(&full)
                .to_string(),
        )
    }
}

/// Sets/clears WS_EX_NOACTIVATE so the collapsed notch never steals focus.
pub fn set_no_activate(hwnd: isize, on: bool) {
    unsafe {
        let h = HWND(hwnd as *mut _);
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
        let next = if on {
            ex | WS_EX_NOACTIVATE.0 as isize
        } else {
            ex & !(WS_EX_NOACTIVATE.0 as isize)
        };
        if next != ex {
            SetWindowLongPtrW(h, GWL_EXSTYLE, next);
        }
    }
}

fn excluded() -> bool {
    unsafe {
        for name in [
            "ExcludeClipboardContentFromMonitorProcessing",
            "Clipboard Viewer Ignore",
            "CanIncludeInClipboardHistory",
        ] {
            let w = wide(name);
            let fmt = RegisterClipboardFormatW(PCWSTR(w.as_ptr()));
            if fmt != 0 && IsClipboardFormatAvailable(fmt).is_ok() {
                // CanIncludeInClipboardHistory present means "allow"; the other two mean "skip".
                if name == "CanIncludeInClipboardHistory" {
                    continue;
                }
                return true;
            }
        }
    }
    false
}

/// Bumps whenever anything writes to the clipboard, so the watcher can skip the
/// open/lock/read cycle on the ~99% of ticks where nothing changed.
pub fn clipboard_seq() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

/// Reads clipboard text, or None when empty / excluded by a password manager.
pub fn read_clipboard() -> Option<String> {
    unsafe {
        if OpenClipboard(None).is_err() {
            return None;
        }
        let out = (|| {
            if excluded() {
                return None;
            }
            if !IsClipboardFormatAvailable(CF_UNICODETEXT).is_ok() {
                return None;
            }
            let h = GetClipboardData(CF_UNICODETEXT).ok()?;
            if h.0.is_null() {
                return None;
            }
            let mem = HGLOBAL(h.0);
            let ptr = GlobalLock(mem);
            if ptr.is_null() {
                return None;
            }
            let size = GlobalSize(mem) / 2;
            let slice = std::slice::from_raw_parts(ptr as *const u16, size);
            let end = slice.iter().position(|&c| c == 0).unwrap_or(slice.len());
            let s = String::from_utf16_lossy(&slice[..end]);
            let _ = GlobalUnlock(mem);
            if s.trim().is_empty() {
                None
            } else {
                Some(s)
            }
        })();
        let _ = CloseClipboard();
        out
    }
}

// ---------- app icons ----------

/// Full image path for a pid, or None if it has already exited.
fn process_path(pid: u32) -> Option<String> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(h);
        if ok.is_err() || len == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// Full path of an exe: the running process first, then the shell's App Paths
/// registry entry. Screen time keeps names long after an app closes, so the
/// running-process lookup alone leaves most rows without an icon.
fn exe_path(name: &str) -> Option<String> {
    running_exe_path(name).or_else(|| app_paths(name))
}

/// Where the shell says an installed exe lives. One registry read per app, no
/// scan of Program Files.
fn app_paths(name: &str) -> Option<String> {
    unsafe {
        let sub = wide(&format!(
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{name}"
        ));
        let value = wide("");
        for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            let mut buf = [0u16; 512];
            let mut size = (buf.len() * 2) as u32;
            if RegGetValueW(
                root,
                PCWSTR(sub.as_ptr()),
                PCWSTR(value.as_ptr()),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr() as *mut _),
                Some(&mut size),
            )
            .is_ok()
            {
                let end = buf.iter().position(|&c| c == 0).unwrap_or(0);
                if end > 0 {
                    return Some(String::from_utf16_lossy(&buf[..end]));
                }
            }
        }
        None
    }
}

/// First running process whose exe file name matches, as a full path.
fn running_exe_path(name: &str) -> Option<String> {
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;
        let mut e = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        let mut out = None;
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                let end = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(0);
                if String::from_utf16_lossy(&e.szExeFile[..end]).eq_ignore_ascii_case(name) {
                    if let Some(p) = process_path(e.th32ProcessID) {
                        out = Some(p);
                        break;
                    }
                }
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
        out
    }
}

fn png_url(w: u32, h: u32, rgba: &[u8]) -> Option<String> {
    let mut buf = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut buf, w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    use base64::Engine;
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&buf)
    ))
}

/// Renders the shell icon of an exe into a PNG data URL.
fn icon_of_path(path: &str) -> Option<String> {
    const SIZE: u32 = 32;
    unsafe {
        let w = wide(path);
        let mut info = SHFILEINFOW::default();
        let r = SHGetFileInfoW(
            PCWSTR(w.as_ptr()),
            FILE_ATTRIBUTE_NORMAL,
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        );
        if r == 0 || info.hIcon.is_invalid() {
            return None;
        }

        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bmi.bmiHeader.biWidth = SIZE as i32;
        // Negative height = top-down rows, which is what PNG wants.
        bmi.bmiHeader.biHeight = -(SIZE as i32);
        bmi.bmiHeader.biPlanes = 1;
        bmi.bmiHeader.biBitCount = 32;
        bmi.bmiHeader.biCompression = BI_RGB.0;

        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let dib = CreateDIBSection(None, &bmi, DIB_RGB_COLORS, &mut bits, None, 0);
        let Ok(dib) = dib else {
            let _ = DestroyIcon(info.hIcon);
            return None;
        };
        if bits.is_null() {
            let _ = DeleteObject(dib);
            let _ = DestroyIcon(info.hIcon);
            return None;
        }

        let dc = CreateCompatibleDC(None);
        let old = SelectObject(dc, dib);
        let _ = DrawIconEx(dc, 0, 0, info.hIcon, SIZE as i32, SIZE as i32, 0, None, DI_NORMAL);
        SelectObject(dc, old);
        let _ = DeleteDC(dc);
        let _ = DestroyIcon(info.hIcon);

        let px = std::slice::from_raw_parts(bits as *const u8, (SIZE * SIZE * 4) as usize);
        // 16-colour icons come back with a zero alpha channel; fall back to
        // keying black out so they are not invisible.
        let has_alpha = px.chunks_exact(4).any(|p| p[3] != 0);
        let mut rgba = Vec::with_capacity(px.len());
        for p in px.chunks_exact(4) {
            let (b, g, r) = (p[0], p[1], p[2]);
            let a = if has_alpha {
                p[3]
            } else if (r | g | b) != 0 {
                255
            } else {
                0
            };
            rgba.extend_from_slice(&[r, g, b, a]);
        }
        let _ = DeleteObject(dib);
        png_url(SIZE, SIZE, &rgba)
    }
}

/// Cached-by-caller lookup: exe file name -> PNG data URL.
pub fn app_icon(name: &str) -> Option<String> {
    icon_of_path(&exe_path(name)?)
}

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const RUN_NAME: &str = "LemeManage";
/// Pre-rename Run value. Cleared on every write, or an upgrade would keep
/// launching a binary that no longer exists.
const RUN_NAME_LEGACY: &str = "Perch";

/// Read straight from HKCU instead of shelling out to `reg.exe`. A windowless
/// app spawning a console program makes Windows hand focus to that console,
/// which the panel reads as a click outside and collapses on.
pub fn autostart_get() -> bool {
    unsafe {
        let key = wide(RUN_KEY);
        let name = wide(RUN_NAME);
        RegGetValueW(
            HKEY_CURRENT_USER,
            PCWSTR(key.as_ptr()),
            PCWSTR(name.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            None,
            None,
        )
        .is_ok()
    }
}

/// Adds or removes the HKCU Run entry. HKCU needs no elevation.
pub fn autostart_set(on: bool) -> bool {
    unsafe {
        let key = wide(RUN_KEY);
        let legacy = wide(RUN_NAME_LEGACY);
        let _ = RegDeleteKeyValueW(
            HKEY_CURRENT_USER,
            PCWSTR(key.as_ptr()),
            PCWSTR(legacy.as_ptr()),
        );
        let name = wide(RUN_NAME);
        if on {
            let Ok(exe) = std::env::current_exe() else {
                return false;
            };
            let data = wide(&format!("\"{}\"", exe.display()));
            let _ = RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PCWSTR(key.as_ptr()),
                PCWSTR(name.as_ptr()),
                REG_SZ.0,
                Some(data.as_ptr() as *const _),
                (data.len() * 2) as u32,
            );
        } else {
            let _ = RegDeleteKeyValueW(
                HKEY_CURRENT_USER,
                PCWSTR(key.as_ptr()),
                PCWSTR(name.as_ptr()),
            );
        }
    }
    autostart_get()
}

/// Writes text back to the clipboard.
pub fn write_clipboard(text: &str) -> bool {
    use windows::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GMEM_MOVEABLE};
    unsafe {
        if OpenClipboard(None).is_err() {
            return false;
        }
        let ok = (|| {
            let _ = EmptyClipboard();
            let units: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes = units.len() * 2;
            let h = GlobalAlloc(GMEM_MOVEABLE, bytes).ok()?;
            let ptr = GlobalLock(h);
            if ptr.is_null() {
                return None;
            }
            std::ptr::copy_nonoverlapping(units.as_ptr() as *const u8, ptr as *mut u8, bytes);
            let _ = GlobalUnlock(h);
            SetClipboardData(CF_UNICODETEXT, HANDLE(h.0)).ok()
        })();
        let _ = CloseClipboard();
        ok.is_some()
    }
}

/// One copy only. Two instances each hold a full snapshot of the clipboard and
/// the last save wins, which silently drops the other instance's items.
pub fn already_running() -> bool {
    use windows::Win32::Foundation::{
        GetLastError, SetLastError, ERROR_ALREADY_EXISTS, WIN32_ERROR,
    };
    use windows::Win32::System::Threading::CreateMutexW;

    let name: Vec<u16> = "Local\\LemeManage.Notch\0".encode_utf16().collect();
    // A fresh mutex leaves the last error untouched, so it has to be cleared or a
    // stale ERROR_ALREADY_EXISTS from any earlier call would look like a copy.
    unsafe { SetLastError(WIN32_ERROR(0)) };
    match unsafe { CreateMutexW(None, false, PCWSTR(name.as_ptr())) } {
        Ok(h) => {
            let taken = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
            // Hold the handle for the process lifetime; dropping it would let a
            // second copy in.
            std::mem::forget(h);
            taken
        }
        Err(_) => false,
    }
}
