use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

const MIB: u64 = 1024 * 1024;
/// Free physical memory below which the system counts as short of memory. An amount rather
/// than a share in use: 85% in use leaves 1.2 GiB on an 8 GiB machine but 9.6 GiB on a 64 GiB one.
const CONSTRAINED_BELOW: u64 = 1536 * MIB;
/// Free physical memory above which it no longer does; the gap keeps the state from flapping.
const RELIEVED_ABOVE: u64 = 2560 * MIB;
/// How long the window stays minimized, or out of focus while memory is short, before the
/// WebView is asked to give memory back: a quick switch away and back keeps its pages in.
const LOW_AFTER: Duration = Duration::from_secs(30);

static CONSTRAINED: AtomicBool = AtomicBool::new(false);
/// Whether the shortage was already reported by `pressure_began`.
static PRESSURE_NOTED: AtomicBool = AtomicBool::new(false);
/// Whether the WebView was last asked to keep its memory low.
static WEBVIEW_LOW: AtomicBool = AtomicBool::new(false);
/// Whether a wait to lower the WebView's memory is running.
static LOW_PENDING: AtomicBool = AtomicBool::new(false);
/// Counts the window's returns, so a wait started before one no longer applies.
static LOW_SCHEDULE: AtomicU64 = AtomicU64::new(0);

/// Whether the system is short of physical memory, from the latest reading.
pub fn memory_constrained() -> bool {
    let Some(available) = available_memory() else {
        return false;
    };
    let constrained = next_constrained(CONSTRAINED.load(Ordering::Relaxed), available);
    CONSTRAINED.store(constrained, Ordering::Relaxed);
    constrained
}

fn next_constrained(was: bool, available: u64) -> bool {
    if was {
        available < RELIEVED_ABOVE
    } else {
        available < CONSTRAINED_BELOW
    }
}

/// Whether `constrained` is the first reading of a shortage, after memory was last plentiful.
pub fn pressure_began(constrained: bool) -> bool {
    let noted = PRESSURE_NOTED.swap(constrained, Ordering::Relaxed);
    constrained && !noted
}

/// While the window is minimized, or out of focus while memory is short, the WebView is
/// asked to give memory back once that has lasted `LOW_AFTER`; it uses its normal level
/// again as soon as the window is back.
pub fn update_webview_memory_target(window: &tauri::WebviewWindow) {
    if !wants_low_memory(window) {
        LOW_SCHEDULE.fetch_add(1, Ordering::Relaxed);
        LOW_PENDING.store(false, Ordering::Relaxed);
        if WEBVIEW_LOW.swap(false, Ordering::Relaxed) {
            set_webview_memory_target(window, false);
        }
        return;
    }
    if WEBVIEW_LOW.load(Ordering::Relaxed) || LOW_PENDING.swap(true, Ordering::Relaxed) {
        return;
    }
    let schedule = LOW_SCHEDULE.load(Ordering::Relaxed);
    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(LOW_AFTER).await;
        if LOW_SCHEDULE.load(Ordering::Relaxed) != schedule {
            return;
        }
        LOW_PENDING.store(false, Ordering::Relaxed);
        if wants_low_memory(&window) && !WEBVIEW_LOW.swap(true, Ordering::Relaxed) {
            set_webview_memory_target(&window, true);
        }
    });
}

fn wants_low_memory(window: &tauri::WebviewWindow) -> bool {
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(true);
    minimized || (!focused && memory_constrained())
}

#[cfg(windows)]
fn available_memory() -> Option<u64> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // SAFETY: `status` is a properly sized MEMORYSTATUSEX with dwLength set.
    unsafe { GlobalMemoryStatusEx(&mut status) }.ok()?;
    Some(status.ullAvailPhys)
}

#[cfg(not(windows))]
fn available_memory() -> Option<u64> {
    None
}

#[cfg(windows)]
fn set_webview_memory_target(window: &tauri::WebviewWindow, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    let level = if low {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    };
    // An older WebView2 runtime without ICoreWebView2_19 keeps its default level.
    let _ = window.with_webview(move |webview| {
        // SAFETY: runs on the WebView's thread with its live controller.
        unsafe {
            if let Ok(core) = webview.controller().CoreWebView2() {
                if let Ok(core) = core.cast::<ICoreWebView2_19>() {
                    let _ = core.SetMemoryUsageTargetLevel(level);
                }
            }
        }
    });
}

#[cfg(not(windows))]
fn set_webview_memory_target(_window: &tauri::WebviewWindow, _low: bool) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_pressure_starts_and_ends_at_separate_amounts_free() {
        assert!(!next_constrained(false, 1536 * MIB));
        assert!(next_constrained(false, 1536 * MIB - 1));
        assert!(next_constrained(true, 2560 * MIB - 1));
        assert!(!next_constrained(true, 2560 * MIB));
    }

    #[test]
    fn a_shortage_is_reported_once_until_memory_is_plentiful_again() {
        assert!(!pressure_began(false));
        assert!(pressure_began(true));
        assert!(!pressure_began(true));
        assert!(!pressure_began(false));
        assert!(pressure_began(true));
    }
}
