use std::sync::atomic::{AtomicBool, Ordering};

/// Memory load (percent of physical memory in use) at which the system counts as short of memory.
const CONSTRAINED_AT: u32 = 85;
/// Memory load below which it no longer does; the gap keeps the state from flapping.
const RELIEVED_AT: u32 = 75;

static CONSTRAINED: AtomicBool = AtomicBool::new(false);
/// Whether the WebView was last asked to keep its memory low.
static WEBVIEW_LOW: AtomicBool = AtomicBool::new(false);

/// Whether the system is short of physical memory, from the latest reading.
pub fn memory_constrained() -> bool {
    let Some(load) = memory_load() else {
        return false;
    };
    let constrained = next_constrained(CONSTRAINED.load(Ordering::Relaxed), load);
    CONSTRAINED.store(constrained, Ordering::Relaxed);
    constrained
}

fn next_constrained(was: bool, load: u32) -> bool {
    if was {
        load > RELIEVED_AT
    } else {
        load >= CONSTRAINED_AT
    }
}

/// While the window is minimized, or out of focus while memory is short, the
/// WebView is asked to give memory back; it uses its normal level otherwise.
pub fn update_webview_memory_target(window: &tauri::WebviewWindow) {
    let minimized = window.is_minimized().unwrap_or(false);
    let focused = window.is_focused().unwrap_or(true);
    let low = minimized || (!focused && memory_constrained());
    if WEBVIEW_LOW.swap(low, Ordering::Relaxed) != low {
        set_webview_memory_target(window, low);
    }
}

#[cfg(windows)]
fn memory_load() -> Option<u32> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut status = MEMORYSTATUSEX {
        dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
        ..Default::default()
    };
    // SAFETY: `status` is a properly sized MEMORYSTATUSEX with dwLength set.
    unsafe { GlobalMemoryStatusEx(&mut status) }.ok()?;
    Some(status.dwMemoryLoad)
}

#[cfg(not(windows))]
fn memory_load() -> Option<u32> {
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
    fn memory_pressure_starts_and_ends_at_separate_loads() {
        assert!(!next_constrained(false, 84));
        assert!(next_constrained(false, 85));
        assert!(next_constrained(true, 76));
        assert!(!next_constrained(true, 75));
    }
}
