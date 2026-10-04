use serde::Serialize;
use tauri::Manager;

mod dto;
mod gitlab_api;
mod glab;
mod native;
mod storage;
mod updates;

use dto::{AppError, Session};
use native::{ConnectInput, MutationInput, NativeState, QueryInput};
use storage::Snapshot;

#[tauri::command]
async fn connect_gitlab(
    state: tauri::State<'_, NativeState>,
    input: ConnectInput,
) -> Result<Session, AppError> {
    state.connect(input).await
}
#[tauri::command]
async fn connect_gitlab_from_glab(
    state: tauri::State<'_, NativeState>,
    url: String,
) -> Result<Session, AppError> {
    state.connect_from_glab(url).await
}
#[tauri::command]
async fn restore_session(
    state: tauri::State<'_, NativeState>,
) -> Result<Option<Session>, AppError> {
    state.restore().await
}
#[tauri::command]
async fn disconnect_gitlab(
    state: tauri::State<'_, NativeState>,
    session_id: String,
) -> Result<(), AppError> {
    state.disconnect(session_id).await
}
#[tauri::command]
async fn query_gitlab(
    state: tauri::State<'_, NativeState>,
    input: QueryInput,
) -> Result<Option<Snapshot>, AppError> {
    state.query(input).await
}
#[tauri::command]
async fn mutate_gitlab(
    state: tauri::State<'_, NativeState>,
    input: MutationInput,
) -> Result<(), AppError> {
    state.mutate(input).await
}
#[tauri::command]
async fn clear_gitlab_cache(
    state: tauri::State<'_, NativeState>,
    session_id: String,
) -> Result<(), AppError> {
    state.clear_cache(session_id).await
}
#[tauri::command]
fn cancel_gitlab_request(
    state: tauri::State<'_, NativeState>,
    session_id: String,
    request_id: String,
) -> Result<(), AppError> {
    state.cancel_request(&session_id, &request_id)
}
#[tauri::command]
fn open_gitlab_url(
    state: tauri::State<'_, NativeState>,
    session_id: String,
    url: String,
) -> Result<(), AppError> {
    state.open_url(&session_id, &url)
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
        .manage(updates::UpdateState::default())
        .setup(|app| {
            if app.config().plugins.0.contains_key("updater") {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            let directory = app.path().app_data_dir()?;
            let state = NativeState::open(&directory).map_err(|_| {
                std::io::Error::other("Could not initialize local application storage")
            })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            runtime_info,
            connect_gitlab,
            connect_gitlab_from_glab,
            restore_session,
            disconnect_gitlab,
            query_gitlab,
            mutate_gitlab,
            clear_gitlab_cache,
            cancel_gitlab_request,
            open_gitlab_url,
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
