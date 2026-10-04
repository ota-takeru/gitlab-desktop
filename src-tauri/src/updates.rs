use crate::dto::AppError;
use serde::Serialize;
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    operation: Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    configured: bool,
    version: Option<String>,
    notes: Option<String>,
}

fn is_configured(app: &tauri::AppHandle) -> bool {
    app.config().plugins.0.get("updater").is_some_and(|config| {
        config["pubkey"].as_str().is_some_and(|key| !key.is_empty())
            && config["endpoints"]
                .as_array()
                .is_some_and(|urls| !urls.is_empty())
    })
}

#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<UpdateInfo, AppError> {
    if !is_configured(&app) || cfg!(debug_assertions) {
        return Ok(UpdateInfo {
            configured: false,
            version: None,
            notes: None,
        });
    }
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| AppError::new("CANCELLED", "更新の確認またはインストールを実行中です。"))?;
    let updater = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| AppError::new("UNSUPPORTED", "自動更新の設定が正しくありません。"))?;
    let update = updater.check().await.map_err(|_| {
        AppError::new(
            "NETWORK",
            "更新を確認できませんでした。現在のバージョンは引き続き使用できます。",
        )
    })?;
    let info = UpdateInfo {
        configured: true,
        version: update.as_ref().map(|u| u.version.clone()),
        notes: update.as_ref().and_then(|u| u.body.clone()),
    };
    *state.pending.lock().await = update;
    Ok(info)
}

#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), AppError> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| AppError::new("CANCELLED", "更新を実行中です。"))?;
    let update = state
        .pending
        .lock()
        .await
        .take()
        .ok_or_else(|| AppError::new("INVALID_INPUT", "先に更新を確認してください。"))?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| {
            AppError::new(
                "NETWORK",
                "署名付き更新をインストールできませんでした。再度更新を確認してください。",
            )
        })?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use base64::Engine;

    #[test]
    #[ignore = "Requires a locally signed NSIS bundle and generated public release configuration"]
    fn verifies_signed_installer_and_rejects_tampering() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let config: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("tauri.release.conf.json")).unwrap())
                .unwrap();
        let key = base64::engine::general_purpose::STANDARD
            .decode(config["plugins"]["updater"]["pubkey"].as_str().unwrap())
            .unwrap();
        let key = minisign_verify::PublicKey::decode(std::str::from_utf8(&key).unwrap()).unwrap();
        let name = format!("GitLab Desktop_{}_x64-setup.exe", env!("CARGO_PKG_VERSION"));
        let path = root.join("target/release/bundle/nsis").join(&name);
        let mut bytes = std::fs::read(&path).unwrap();
        let signature =
            std::fs::read_to_string(path.with_file_name(format!("{name}.sig"))).unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(signature.trim())
            .unwrap();
        let signature =
            minisign_verify::Signature::decode(std::str::from_utf8(&decoded).unwrap()).unwrap();
        key.verify(&bytes, &signature, true).unwrap();
        let middle = bytes.len() / 2;
        bytes[middle] ^= 1;
        assert!(key.verify(&bytes, &signature, true).is_err());
    }
}
