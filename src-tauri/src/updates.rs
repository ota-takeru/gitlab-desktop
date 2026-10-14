use crate::dto::AppError;
use serde::Serialize;
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

/// The one update found by the last check, with its signed package once it
/// has been downloaded and verified. A newer check replaces it, so at most one
/// package is ever kept in memory.
struct Pending<U> {
    update: U,
    bytes: Option<Vec<u8>>,
}

#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Pending<Update>>>,
    operation: Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    configured: bool,
    version: Option<String>,
    notes: Option<String>,
    /// The package of `version` is already downloaded and verified.
    downloaded: bool,
}

fn is_configured(app: &tauri::AppHandle) -> bool {
    app.config().plugins.0.get("updater").is_some_and(|config| {
        config["pubkey"].as_str().is_some_and(|key| !key.is_empty())
            && config["endpoints"]
                .as_array()
                .is_some_and(|urls| !urls.is_empty())
    })
}

/// Keeps a downloaded package while a new check still announces its version;
/// any other result drops it.
fn replace_pending<U>(
    previous: Option<Pending<U>>,
    next: Option<U>,
    same_version: impl Fn(&U, &U) -> bool,
) -> Option<Pending<U>> {
    match (previous, next) {
        (Some(previous), Some(next)) if same_version(&previous.update, &next) => Some(previous),
        (_, next) => next.map(|update| Pending {
            update,
            bytes: None,
        }),
    }
}

/// Downloads the package once; `download` checks the signature before it
/// returns the bytes.
async fn ensure_downloaded(entry: &mut Pending<Update>) -> Result<(), AppError> {
    if entry.bytes.is_none() {
        let bytes = entry
            .update
            .download(|_, _| {}, || {})
            .await
            .map_err(|_| {
                AppError::new(
                    "NETWORK",
                    "署名付き更新をダウンロードできませんでした。現在のバージョンは引き続き使用できます。",
                )
            })?;
        entry.bytes = Some(bytes);
    }
    Ok(())
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
            downloaded: false,
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
    let mut pending = state.pending.lock().await;
    *pending = replace_pending(pending.take(), update, |left, right| {
        left.version == right.version
    });
    Ok(UpdateInfo {
        configured: true,
        version: pending.as_ref().map(|p| p.update.version.clone()),
        notes: pending.as_ref().and_then(|p| p.update.body.clone()),
        downloaded: pending.as_ref().is_some_and(|p| p.bytes.is_some()),
    })
}

/// Downloads and verifies the update found by the last check, in the
/// background. It never installs; that stays the user's explicit action.
#[tauri::command]
pub async fn download_app_update(state: tauri::State<'_, UpdateState>) -> Result<(), AppError> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| AppError::new("CANCELLED", "更新の確認またはインストールを実行中です。"))?;
    let mut pending = state.pending.lock().await;
    let entry = pending
        .as_mut()
        .ok_or_else(|| AppError::new("INVALID_INPUT", "先に更新を確認してください。"))?;
    ensure_downloaded(entry).await
}

/// Applies the downloaded update and restarts; downloads it first when the
/// background download has not finished or failed.
#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<(), AppError> {
    // Waits for a running background download instead of starting a second one.
    let _operation = state.operation.lock().await;
    let mut pending = state.pending.lock().await;
    let entry = pending
        .as_mut()
        .ok_or_else(|| AppError::new("INVALID_INPUT", "先に更新を確認してください。"))?;
    ensure_downloaded(entry).await?;
    let bytes = entry.bytes.as_deref().unwrap_or_default();
    entry.update.install(bytes).map_err(|_| {
        AppError::new(
            "NETWORK",
            "署名付き更新をインストールできませんでした。再度更新を確認してください。",
        )
    })?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::{replace_pending, Pending};
    use base64::Engine;

    #[test]
    fn keeps_one_downloaded_package_only_while_its_version_is_announced() {
        let same = |left: &&str, right: &&str| left == right;
        let downloaded = || {
            Some(Pending {
                update: "0.2.0",
                bytes: Some(vec![1, 2, 3]),
            })
        };

        let kept = replace_pending(downloaded(), Some("0.2.0"), same).unwrap();
        assert_eq!(kept.bytes.as_deref(), Some(&[1, 2, 3][..]));

        let newer = replace_pending(downloaded(), Some("0.3.0"), same).unwrap();
        assert_eq!(newer.update, "0.3.0");
        assert!(newer.bytes.is_none());

        assert!(replace_pending(downloaded(), None, same).is_none());
        assert!(replace_pending(None, Some("0.2.0"), same)
            .unwrap()
            .bytes
            .is_none());
    }

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
