use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

mod dto;
mod gitlab_api;
mod glab;
mod native;
mod storage;
mod updates;

use dto::{AppError, Session};
use native::{ConnectInput, MutationInput, NativeState, PendingOperation, QueryInput};
use storage::{LocalDraft, Snapshot};

// A damaged/newer database must leave a usable error screen instead of
// aborting the process or silently replacing private data with an empty DB.
struct ApplicationState(Result<NativeState, AppError>);
impl ApplicationState {
    fn native(&self) -> Result<&NativeState, AppError> {
        self.0.as_ref().map_err(Clone::clone)
    }
}
#[derive(Default)]
struct CloseGuard {
    active: AtomicBool,
    unsafe_to_close: AtomicBool,
    closing: AtomicBool,
}

#[tauri::command]
async fn connect_gitlab(
    state: tauri::State<'_, ApplicationState>,
    input: ConnectInput,
) -> Result<Session, AppError> {
    state.native()?.connect(input).await
}
#[tauri::command]
async fn list_glab_connections() -> Result<Vec<String>, AppError> {
    tauri::async_runtime::spawn_blocking(glab::list_connections)
        .await
        .map_err(|_| AppError::new("AUTH_REQUIRED", "glabの接続先を読み取れませんでした。"))?
}

#[tauri::command]
async fn connect_gitlab_from_glab(
    state: tauri::State<'_, ApplicationState>,
    url: String,
) -> Result<Session, AppError> {
    state.native()?.connect_from_glab(url).await
}
#[tauri::command]
async fn restore_session(
    state: tauri::State<'_, ApplicationState>,
) -> Result<Option<Session>, AppError> {
    state.native()?.restore().await
}
#[tauri::command]
async fn disconnect_gitlab(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
) -> Result<(), AppError> {
    state.native()?.disconnect(session_id).await
}
#[tauri::command]
async fn query_gitlab(
    state: tauri::State<'_, ApplicationState>,
    input: QueryInput,
) -> Result<Option<Snapshot>, AppError> {
    state.native()?.query(input).await
}
#[tauri::command]
async fn mutate_gitlab(
    state: tauri::State<'_, ApplicationState>,
    input: MutationInput,
) -> Result<(), AppError> {
    state.native()?.mutate(input).await
}
#[tauri::command]
async fn clear_gitlab_cache(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
) -> Result<(), AppError> {
    state.native()?.clear_cache(session_id).await
}
#[tauri::command]
fn cancel_gitlab_request(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
    request_id: String,
) -> Result<(), AppError> {
    state.native()?.cancel_request(&session_id, &request_id)
}
#[tauri::command]
async fn get_gitlab_avatar(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
    url: String,
) -> Result<Option<String>, AppError> {
    state.native()?.avatar(session_id, url).await
}
#[tauri::command]
fn open_gitlab_url(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
    url: String,
) -> Result<(), AppError> {
    state.native()?.open_url(&session_id, &url)
}

#[tauri::command]
async fn get_local_draft(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
    key: String,
) -> Result<Option<LocalDraft>, AppError> {
    state.native()?.local_draft(session_id, key).await
}
#[tauri::command]
async fn set_local_draft(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
    key: String,
    body: String,
) -> Result<(), AppError> {
    state
        .native()?
        .save_local_draft(session_id, key, body)
        .await
}
#[tauri::command]
async fn clear_local_drafts(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
) -> Result<(), AppError> {
    state.native()?.clear_local_drafts(session_id).await
}
#[tauri::command]
async fn get_pending_operation(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
    project_id: String,
    iid: String,
) -> Result<Option<PendingOperation>, AppError> {
    state
        .native()?
        .pending_operation(session_id, project_id, iid)
        .await
}
#[tauri::command]
async fn acknowledge_pending_operation(
    state: tauri::State<'_, ApplicationState>,
    session_id: String,
    project_id: String,
    iid: String,
    receipt_id: String,
) -> Result<(), AppError> {
    state
        .native()?
        .acknowledge_pending_operation(session_id, project_id, iid, receipt_id)
        .await
}
#[tauri::command]
fn set_window_close_guard(state: tauri::State<'_, CloseGuard>, unsafe_to_close: bool) {
    state
        .unsafe_to_close
        .store(unsafe_to_close, Ordering::SeqCst);
    // Once the frontend listener is ready, every close flushes pending local
    // saves. This also covers the short interval before a dirty-state IPC.
    state.active.store(true, Ordering::SeqCst);
}
#[tauri::command]
fn close_app_window(
    window: tauri::Window,
    state: tauri::State<'_, CloseGuard>,
) -> Result<(), AppError> {
    state.closing.store(true, Ordering::SeqCst);
    if window.close().is_err() {
        state.closing.store(false, Ordering::SeqCst);
        return Err(AppError::new(
            "UNSUPPORTED",
            "アプリを終了できませんでした。",
        ));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeInfo {
    app_version: &'static str,
    os: &'static str,
    arch: &'static str,
}

// Intentionally exposes no filesystem paths, environment variables or credentials.
#[tauri::command]
fn runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        app_version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(updates::UpdateState::default())
        .manage(CloseGuard::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let guard = window.state::<CloseGuard>();
                if guard.active.load(Ordering::SeqCst) && !guard.closing.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit(
                        "app-close-blocked",
                        guard.unsafe_to_close.load(Ordering::SeqCst),
                    );
                }
            }
        })
        .setup(|app| {
            if app.config().plugins.0.contains_key("updater") {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            let state = app
                .path()
                .app_data_dir()
                .map_err(|_| storage::storage_error())
                .and_then(|directory| NativeState::open(&directory));
            app.manage(ApplicationState(state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            connect_gitlab,
            list_glab_connections,
            connect_gitlab_from_glab,
            restore_session,
            disconnect_gitlab,
            query_gitlab,
            mutate_gitlab,
            clear_gitlab_cache,
            cancel_gitlab_request,
            open_gitlab_url,
            get_gitlab_avatar,
            get_local_draft,
            set_local_draft,
            clear_local_drafts,
            get_pending_operation,
            acknowledge_pending_operation,
            set_window_close_guard,
            close_app_window,
            updates::check_app_update,
            updates::install_app_update
        ])
        .run(tauri::generate_context!())
        .expect("failed to run GitLab Desktop");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_startup_failure_remains_a_command_error() {
        let state = ApplicationState(Err(storage::storage_error()));
        let error = match state.native() {
            Ok(_) => panic!("failed database must not become usable"),
            Err(error) => error,
        };
        assert_eq!(error.code, "STORAGE");
        assert_eq!(state.native().err().unwrap().code, "STORAGE");
    }

    #[test]
    fn runtime_info_matches_the_frontend_contract() {
        let value = serde_json::to_value(runtime_info()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "appVersion": env!("CARGO_PKG_VERSION"),
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
            })
        );
    }
}
