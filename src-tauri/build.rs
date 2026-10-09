fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "runtime_info",
            "connect_gitlab",
            "list_glab_connections",
            "connect_gitlab_from_glab",
            "restore_session",
            "disconnect_gitlab",
            "query_gitlab",
            "mutate_gitlab",
            "clear_gitlab_cache",
            "cancel_gitlab_request",
            "open_gitlab_url",
            "get_gitlab_avatar",
            "get_local_draft",
            "set_local_draft",
            "clear_local_drafts",
            "get_pending_operation",
            "acknowledge_pending_operation",
            "set_window_close_guard",
            "close_app_window",
            "check_app_update",
            "install_app_update",
        ]),
    ))
    .expect("failed to build Tauri application metadata");
}
