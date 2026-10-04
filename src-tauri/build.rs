fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "runtime_info",
            "connect_gitlab",
            "restore_session",
            "disconnect_gitlab",
            "query_gitlab",
            "mutate_gitlab",
            "clear_gitlab_cache",
            "cancel_gitlab_request",
            "open_gitlab_url",
            "check_app_update",
            "install_app_update",
        ]),
    ))
    .expect("failed to build Tauri application metadata");
}
