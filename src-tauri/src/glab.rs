//! Optional, explicit credential import. This is not a GitLab HTTP adapter.
use crate::dto::AppError;
use crate::native::normalize_instance;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use url::{Position, Url};
use yaml_rust2::parser::{Event, EventReceiver, Parser};
use yaml_rust2::{Yaml, YamlLoader};

const MAX_OUTPUT: usize = 4098; // 4096-byte token plus CRLF
const MAX_CONFIG: usize = 1024 * 1024;
const SAFE_ENV: &[&str] = &[
    "PATH",
    "SystemRoot",
    "WINDIR",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
    "XDG_CONFIG_HOME",
    "GLAB_CONFIG_DIR",
    "TEMP",
    "TMP",
];

fn missing_auth() -> AppError {
    AppError::new("AUTH_REQUIRED", "この接続先のglab認証情報を取得できません。glabでログインするか、トークンを直接入力してください。")
}

fn resolve_program() -> Result<PathBuf, AppError> {
    let name = if cfg!(windows) { "glab.exe" } else { "glab" };
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .filter(|directory| directory.is_absolute())
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
        .and_then(|path| path.canonicalize().ok())
        .ok_or_else(|| AppError::new("UNSUPPORTED", "glabが見つかりません。インストール済みglabをPATHへ追加するか、トークンを直接入力してください。"))
}

fn config_command(program: &Path, directory: &Path, host: &str, config_dir: &Path) -> Command {
    let mut command = Command::new(program);
    // No shell, no frontend-supplied executable/arguments, and no working-directory
    // executable lookup. Only explicitly named host configuration is requested.
    command.args(["config", "get", "token", "--host", host]);
    command.current_dir(directory).env_clear();
    for name in SAFE_ENV {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    // In particular, inherited GitLab tokens, CI auto-login, debug logging,
    // repository overrides and API-origin overrides never reach glab.
    command
        .env("GLAB_CONFIG_DIR", config_dir)
        .env("GLAB_CHECK_UPDATE", "false")
        .env("GLAB_SEND_TELEMETRY", "false")
        .env("GLAB_SHOW_WHATS_NEW", "false")
        .env("GLAB_DEBUG", "false")
        .env("GLAB_DEBUG_HTTP", "false")
        .env("GLAB_NO_PROMPT", "true")
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: credential import must not open a console window.
        command.creation_flags(0x0800_0000);
    }
    command
}

async fn capture(mut command: Command, timeout: Duration) -> Result<String, AppError> {
    tokio::time::timeout(timeout, async {
        let mut child = command.spawn().map_err(|_| missing_auth())?;
        let stdout = child.stdout.take().ok_or_else(missing_auth)?;
        let mut bytes = Vec::new();
        stdout
            .take((MAX_OUTPUT + 1) as u64)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| missing_auth())?;
        if bytes.len() > MAX_OUTPUT {
            return Err(AppError::new(
                "TOO_LARGE",
                "glabの認証情報が対応するサイズを超えています。",
            ));
        }
        let status = child.wait().await.map_err(|_| missing_auth())?;
        if !status.success() {
            return Err(missing_auth());
        }
        let output = String::from_utf8(bytes).map_err(|_| missing_auth())?;
        Ok(output.trim_end_matches(['\r', '\n']).to_owned())
    })
    .await
    .map_err(|_| AppError::new("TIMEOUT", "glabの認証情報取得がタイムアウトしました。"))?
}

fn check_scope(
    instance: &Url,
    api_host: &str,
    protocol: &str,
    subfolder: &str,
) -> Result<(), AppError> {
    if api_host.is_empty() || api_host.contains(['@', '?', '#', '\\']) || protocol != "https" {
        return Err(missing_auth());
    }
    // Older glab settings stored the subpath in api_host. Accept that form
    // only when the separate subfolder is empty, then compare the same URL.
    let (api_host, subfolder) = match api_host.split_once('/') {
        Some((host, path)) if subfolder.is_empty() => (host, path),
        Some(_) => return Err(missing_auth()),
        None => (api_host, subfolder),
    };
    if api_host.is_empty() {
        return Err(missing_auth());
    }
    let configured = normalize_instance(&format!(
        "https://{api_host}/{}",
        subfolder.trim_matches('/')
    ))
    .map_err(|_| missing_auth())?;
    if &configured != instance {
        return Err(AppError::new("AUTH_REQUIRED", "glabのAPI接続先と入力URLが一致しません。接続先URLを確認するか、トークンを直接入力してください。"));
    }
    Ok(())
}

fn check_token(token: String) -> Result<String, AppError> {
    if token.is_empty()
        || token.len() > 4096
        || !token.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err(missing_auth());
    }
    Ok(token)
}

// glab 1.107's --global is a no-op. Resolve its global file explicitly and
// select exactly hosts[authority], with no root/repository/environment fallback.
fn config_path() -> Result<PathBuf, AppError> {
    if let Some(directory) = std::env::var_os("GLAB_CONFIG_DIR").filter(|v| !v.is_empty()) {
        let directory = absolute_directory(Some(directory)).ok_or_else(|| {
            AppError::new(
                "AUTH_REQUIRED",
                "glab認証の取り込みにはGLAB_CONFIG_DIRを絶対パスで指定してください。",
            )
        })?;
        return Ok(directory.join("config.yml"));
    }
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE") {
        candidates.push(PathBuf::from(home).join(".config/glab-cli/config.yml"));
    }
    if let Some(home) = absolute_directory(std::env::var_os("XDG_CONFIG_HOME"))
        .or_else(|| absolute_directory(std::env::var_os("LOCALAPPDATA")))
    {
        candidates.push(home.join("glab-cli/config.yml"));
    }
    let mut directories = absolute_directories(std::env::var_os("XDG_CONFIG_DIRS"));
    if directories.is_empty() {
        for name in ["ProgramData", "APPDATA"] {
            if let Some(directory) = absolute_directory(std::env::var_os(name)) {
                directories.push(directory);
            }
        }
    }
    candidates.extend(
        directories
            .into_iter()
            .map(|path| path.join("glab-cli/config.yml")),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(missing_auth)
}

fn absolute_directory(value: Option<std::ffi::OsString>) -> Option<PathBuf> {
    value.map(PathBuf::from).filter(|path| path.is_absolute())
}

fn absolute_directories(value: Option<std::ffi::OsString>) -> Vec<PathBuf> {
    value
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .filter(|path| path.is_absolute())
        .collect()
}

enum Frame {
    Map {
        keys: HashSet<String>,
        next_key: bool,
    },
    Sequence,
}
#[derive(Default)]
struct ConfigPolicy {
    frames: Vec<Frame>,
    events: usize,
    invalid: bool,
}
impl EventReceiver for ConfigPolicy {
    fn on_event(&mut self, event: Event) {
        self.events += 1;
        if self.invalid || self.events > 10_000 {
            self.invalid = true;
            return;
        }
        match event {
            Event::Alias(_) => self.invalid = true,
            Event::Scalar(value, _, anchor, tag) => {
                // glab writes timestamps as !!str; this is an ordinary string,
                // not an alias or application-defined YAML type.
                let string_tag = tag
                    .as_ref()
                    .is_none_or(|tag| tag.handle == "tag:yaml.org,2002:" && tag.suffix == "str");
                if anchor != 0 || !string_tag {
                    self.invalid = true;
                }
                if let Some(Frame::Map { keys, next_key }) = self.frames.last_mut() {
                    if *next_key && !keys.insert(value) {
                        self.invalid = true;
                    }
                    *next_key = !*next_key;
                }
            }
            Event::MappingStart(anchor, ref tag) | Event::SequenceStart(anchor, ref tag) => {
                if anchor != 0 || tag.is_some() || self.frames.len() >= 32 {
                    self.invalid = true;
                    return;
                }
                if let Some(Frame::Map { next_key, .. }) = self.frames.last_mut() {
                    if *next_key {
                        self.invalid = true;
                        return;
                    }
                    *next_key = true;
                }
                if matches!(event, Event::MappingStart(..)) {
                    self.frames.push(Frame::Map {
                        keys: HashSet::new(),
                        next_key: true,
                    });
                } else {
                    self.frames.push(Frame::Sequence);
                }
            }
            Event::MappingEnd | Event::SequenceEnd => {
                self.frames.pop();
            }
            _ => (),
        }
    }
}

enum CredentialSource {
    Plaintext(String),
    Keyring,
}

fn optional_string<'a>(node: &'a Yaml, key: &str, default: &'a str) -> Result<&'a str, AppError> {
    match &node[key] {
        Yaml::BadValue | Yaml::Null => Ok(default),
        Yaml::String(value) => Ok(value),
        _ => Err(missing_auth()),
    }
}
fn flag(node: &Yaml, key: &str) -> Result<bool, AppError> {
    match &node[key] {
        Yaml::BadValue | Yaml::Null => Ok(false),
        Yaml::Boolean(value) => Ok(*value),
        Yaml::String(value) if value == "true" => Ok(true),
        Yaml::String(value) if value == "false" => Ok(false),
        _ => Err(missing_auth()),
    }
}

fn parse_config(text: &str) -> Result<Yaml, AppError> {
    if text.len() > MAX_CONFIG {
        return Err(missing_auth());
    }
    // Preflight without constructing/expanding aliases. Bound tree depth and
    // nodes and reject duplicate keys before a second parse constructs the tree.
    let mut policy = ConfigPolicy::default();
    Parser::new_from_str(text)
        .load(&mut policy, true)
        .map_err(|_| missing_auth())?;
    if policy.invalid {
        return Err(missing_auth());
    }
    let documents = YamlLoader::load_from_str(text).map_err(|_| missing_auth())?;
    if documents.len() != 1 {
        return Err(missing_auth());
    }
    documents.into_iter().next().ok_or_else(missing_auth)
}

fn select_source(text: &str, instance: &Url) -> Result<CredentialSource, AppError> {
    let document = parse_config(text)?;
    let host = &instance[Position::BeforeHost..Position::AfterPort];
    let node = &document["hosts"][host];
    if node.as_hash().is_none() {
        return Err(missing_auth());
    }
    check_scope(
        instance,
        optional_string(node, "api_host", host)?,
        optional_string(node, "api_protocol", "https")?,
        optional_string(node, "subfolder", "")?,
    )?;
    if flag(node, "is_oauth2")? {
        let expiry = time::OffsetDateTime::parse(optional_string(node, "oauth2_expiry_date", "")?, &time::format_description::well_known::Rfc3339)
            .map_err(|_| AppError::new("AUTH_REQUIRED", "glabのOAuth有効期限を確認できません。glab側で認証を更新してから再度取り込んでください。"))?;
        if expiry.unix_timestamp() <= (crate::storage::now_ms() / 1000) as i64 + 60 {
            return Err(AppError::new("AUTH_REQUIRED", "glabのOAuth認証が期限切れ、または有効期限が近づいています。glab側で認証を更新してから再度取り込んでください。"));
        }
    }
    if flag(node, "use_keyring")? {
        return Ok(CredentialSource::Keyring);
    }
    let token = optional_string(node, "token", "")?;
    Ok(CredentialSource::Plaintext(check_token(token.to_owned())?))
}

fn read_config_text() -> Result<String, AppError> {
    let file = std::fs::File::open(config_path()?).map_err(|_| missing_auth())?;
    let mut bytes = Vec::new();
    file.take((MAX_CONFIG + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| missing_auth())?;
    String::from_utf8(bytes).map_err(|_| missing_auth())
}

fn load_source(instance: &Url) -> Result<CredentialSource, AppError> {
    select_source(&read_config_text()?, instance)
}

fn configured_connections(text: &str) -> Result<Vec<String>, AppError> {
    let document = parse_config(text)?;
    let Some(hosts) = document["hosts"].as_hash() else {
        return Ok(Vec::new());
    };
    let mut connections = Vec::new();
    for (key, node) in hosts {
        let Some(host) = key.as_str() else { continue };
        let candidate = (|| -> Result<Url, AppError> {
            let api_host = optional_string(node, "api_host", host)?;
            let protocol = optional_string(node, "api_protocol", "https")?;
            let subfolder = optional_string(node, "subfolder", "")?;
            let instance = normalize_instance(&format!(
                "https://{api_host}/{}",
                subfolder.trim_matches('/')
            ))?;
            // A configured API override must never redirect another host's credential.
            if &instance[Position::BeforeHost..Position::AfterPort] != host {
                return Err(missing_auth());
            }
            check_scope(&instance, api_host, protocol, subfolder)?;
            if !flag(node, "use_keyring")? {
                check_token(optional_string(node, "token", "")?.to_owned())?;
            }
            Ok(instance)
        })();
        if let Ok(instance) = candidate {
            connections.push(instance.as_str().trim_end_matches('/').to_owned());
        }
    }
    Ok(connections)
}

/// Lists only connection URLs. Keyring reads and authentication happen after selection.
pub fn list_connections() -> Result<Vec<String>, AppError> {
    if !cfg!(windows) {
        return Err(AppError::new(
            "UNSUPPORTED",
            "glab認証情報の取り込みはWindows版のみ対応しています。",
        ));
    }
    configured_connections(&read_config_text()?)
}

struct TemporaryConfig {
    directory: PathBuf,
}
impl TemporaryConfig {
    fn create(base: &Path, host: &str) -> Result<Self, AppError> {
        let directory = base.join(format!("glab-import-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).map_err(|_| missing_auth())?;
        let config = Self { directory };
        // JSON is valid YAML. Only host metadata is written, never credentials.
        let metadata = serde_json::json!({ "hosts": { host: { "use_keyring": "true" } } });
        std::fs::write(
            config.directory.join("config.yml"),
            serde_json::to_vec(&metadata).map_err(|_| missing_auth())?,
        )
        .map_err(|_| missing_auth())?;
        Ok(config)
    }
}
impl Drop for TemporaryConfig {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(self.directory.join("config.yml"));
        let _ = std::fs::remove_dir(&self.directory);
    }
}

pub async fn read_token(instance: &Url, directory: &Path) -> Result<String, AppError> {
    if !cfg!(windows) {
        return Err(AppError::new(
            "UNSUPPORTED",
            "glab認証情報の取り込みはWindows版のみ対応しています。",
        ));
    }
    let requested = instance.clone();
    let source = tauri::async_runtime::spawn_blocking(move || load_source(&requested))
        .await
        .map_err(|_| missing_auth())??;
    match source {
        CredentialSource::Plaintext(token) => Ok(token),
        CredentialSource::Keyring => {
            let program = resolve_program()?;
            let host = &instance[Position::BeforeHost..Position::AfterPort];
            let config = TemporaryConfig::create(directory, host)?;
            // Explicit keyring=true returns an error if the host key is absent.
            // The isolated configuration contains no root/local/other-host token.
            check_token(
                capture(
                    config_command(&program, directory, host, &config.directory),
                    Duration::from_secs(5),
                )
                .await?,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_glab_standard_string_tags_without_enabling_other_yaml_types() {
        for token in ["fake-host-token", "!!str fake-host-token"] {
            let text = format!("last_update_check_timestamp: !!str 2026-10-08T00:00:00Z\nhosts:\n  gitlab.example.com:\n    api_protocol: https\n    token: {token}\n");
            let instance = normalize_instance("https://gitlab.example.com").unwrap();
            assert!(
                matches!(select_source(&text, &instance).unwrap(), CredentialSource::Plaintext(token) if token == "fake-host-token")
            );
            assert_eq!(
                configured_connections(&text).unwrap(),
                vec!["https://gitlab.example.com"]
            );
        }
    }

    #[test]
    fn lists_saved_https_connections_without_credentials_or_empty_hosts() {
        let text = serde_json::json!({
            "token": "fake-root-secret",
            "host": "gitlab.com",
            "hosts": {
                "gitlab.com": { "token": "" },
                "gitlab.example.com": { "token": "fake-private-secret", "api_host": "gitlab.example.com", "api_protocol": "https" },
                "keyring.example.com": { "use_keyring": true },
                "http.example.com": { "token": "fake-http-secret", "api_protocol": "http" },
                "override.example.com": { "token": "fake-override-secret", "api_host": "other.example.com" }
            }
        }).to_string();
        let mut connections = configured_connections(&text).unwrap();
        connections.sort();
        assert_eq!(
            connections,
            vec!["https://gitlab.example.com", "https://keyring.example.com"]
        );
        assert!(!serde_json::to_string(&connections)
            .unwrap()
            .contains("secret"));
    }

    #[test]
    fn lists_subpath_connections_with_the_same_scope_used_for_import() {
        for fields in [
            serde_json::json!({ "token": "fake-token", "subfolder": "Team/GitLab" }),
            serde_json::json!({ "token": "fake-token", "api_host": "gitlab.example.com:8443/Team/GitLab" }),
        ] {
            let text =
                serde_json::json!({ "hosts": { "gitlab.example.com:8443": fields } }).to_string();
            let connections = configured_connections(&text).unwrap();
            assert_eq!(
                connections,
                vec!["https://gitlab.example.com:8443/Team/GitLab"]
            );
            assert!(select_source(&text, &normalize_instance(&connections[0]).unwrap()).is_ok());
        }
    }

    fn fixture(host: &str, fields: serde_json::Value) -> String {
        serde_json::json!({ "token": "fake-root-token", "hosts": { host: fields, "other.invalid": { "token": "fake-other-token" } } }).to_string()
    }

    #[test]
    fn only_exact_host_credentials_are_selected_without_root_fallback() {
        let instance = normalize_instance("https://gitlab.com").unwrap();
        let text = fixture(
            "gitlab.com",
            serde_json::json!({ "token": "fake-host-token" }),
        );
        assert!(
            matches!(select_source(&text, &instance).unwrap(), CredentialSource::Plaintext(token) if token == "fake-host-token")
        );
        for fields in [
            serde_json::json!({}),
            serde_json::json!({"token": ""}),
            serde_json::json!({"token": null}),
        ] {
            assert!(select_source(&fixture("gitlab.com", fields), &instance).is_err());
        }
        assert!(select_source(
            &fixture(
                "different.invalid",
                serde_json::json!({"token": "fake-token"})
            ),
            &instance
        )
        .is_err());
        assert!(select_source(
            &text,
            &normalize_instance("https://gitlab.com:8443").unwrap()
        )
        .is_err());
    }

    #[test]
    fn api_overrides_and_subpath_are_bound_before_credentials_are_selected() {
        let instance = normalize_instance("https://gitlab.example.com:8443/Team/GitLab").unwrap();
        let valid = serde_json::json!({"token": "fake-token", "api_host": "gitlab.example.com:8443", "api_protocol": "https", "subfolder": "Team/GitLab"});
        assert!(select_source(
            &fixture("gitlab.example.com:8443", valid.clone()),
            &instance
        )
        .is_ok());
        for (key, value) in [
            ("api_host", "other.invalid"),
            ("api_protocol", "http"),
            ("subfolder", "team/gitlab"),
        ] {
            let mut invalid = valid.clone();
            invalid[key] = value.into();
            assert!(
                select_source(&fixture("gitlab.example.com:8443", invalid), &instance).is_err()
            );
        }
    }

    #[test]
    fn oauth_requires_known_future_expiry_and_never_uses_refresh_tokens() {
        let instance = normalize_instance("https://gitlab.com").unwrap();
        let fields = serde_json::json!({ "token": "fake-access-token", "is_oauth2": "true", "oauth2_expiry_date": "2099-01-01T00:00:00Z", "oauth2_refresh_token": "fake-refresh-token" });
        assert!(
            matches!(select_source(&fixture("gitlab.com", fields.clone()), &instance).unwrap(), CredentialSource::Plaintext(token) if token == "fake-access-token")
        );
        for expiry in ["2000-01-01T00:00:00Z", "", "invalid", "01 Jan 99 00:00 UTC"] {
            let mut expired = fields.clone();
            expired["oauth2_expiry_date"] = expiry.into();
            let error = select_source(&fixture("gitlab.com", expired), &instance)
                .err()
                .unwrap();
            assert_eq!(error.code, "AUTH_REQUIRED");
            assert!(error.message.contains("OAuth"));
            assert!(!error.message.contains("fake"));
        }
        let mut no_access_token = fields;
        no_access_token.as_object_mut().unwrap().remove("token");
        assert!(select_source(&fixture("gitlab.com", no_access_token), &instance).is_err());
    }

    #[test]
    fn only_explicit_valid_keyring_flag_enables_keyring_access() {
        let instance = normalize_instance("https://gitlab.com").unwrap();
        for flag in [serde_json::json!(true), serde_json::json!("true")] {
            assert!(matches!(
                select_source(
                    &fixture(
                        "gitlab.com",
                        serde_json::json!({"use_keyring": flag, "token": "fake-stale-token"})
                    ),
                    &instance
                )
                .unwrap(),
                CredentialSource::Keyring
            ));
        }
        for key in ["use_keyring", "is_oauth2"] {
            for flag in [
                serde_json::json!(1),
                serde_json::json!([]),
                serde_json::json!("yes"),
            ] {
                assert!(select_source(
                    &fixture(
                        "gitlab.com",
                        serde_json::json!({key: flag, "token": "fake-token"})
                    ),
                    &instance
                )
                .is_err());
            }
        }
    }

    #[test]
    fn ambiguous_or_unbounded_yaml_is_rejected_without_echoing_secrets() {
        let instance = normalize_instance("https://gitlab.com").unwrap();
        let samples = [
            "hosts:\n  gitlab.com:\n    token: fake-one\n    token: fake-two\n",
            "hosts: {gitlab.com: {token: &secret fake-token}, other.invalid: {token: *secret}}",
            "hosts: {gitlab.com: {token: !secret fake-token}}",
            "hosts: {gitlab.com: {token: !!int 123}}",
            "hosts: {gitlab.com: {token: fake-token}}\n---\nhosts: {}",
            "hosts: {gitlab.com: {token: [fake-token]}}",
            "? [complex, key]\n: fake-token",
            "hosts: [unterminated",
        ];
        for text in samples {
            assert!(configured_connections(text)
                .map(|connections| connections.is_empty())
                .unwrap_or(true));
            let error = select_source(text, &instance).err().unwrap();
            assert_eq!(error.code, "AUTH_REQUIRED");
            assert!(!error.message.contains("fake"));
        }
        assert!(select_source(&"x".repeat(MAX_CONFIG + 1), &instance).is_err());
        assert!(select_source(
            &format!("{}fake-token{}", "[".repeat(40), "]".repeat(40)),
            &instance
        )
        .is_err());
        assert!(select_source(&format!("[{}]", "x,".repeat(10_001)), &instance).is_err());
    }

    #[test]
    fn isolated_keyring_config_contains_only_target_host_and_is_removed() {
        let base =
            std::env::temp_dir().join(format!("gitlab-glab-fixture-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&base).unwrap();
        let path;
        {
            let config = TemporaryConfig::create(&base, "gitlab.com:8443").unwrap();
            path = config.directory.clone();
            let text = std::fs::read_to_string(path.join("config.yml")).unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert_eq!(
                parsed,
                serde_json::json!({"hosts": {"gitlab.com:8443": {"use_keyring": "true"}}})
            );
            assert!(!text.contains("token"));
        }
        assert!(!path.exists());
        std::fs::remove_dir(base).unwrap();
    }

    #[test]
    fn binds_credentials_to_https_host_port_and_case_sensitive_subpath() {
        let cloud = normalize_instance("https://gitlab.com").unwrap();
        assert!(check_scope(&cloud, "gitlab.com", "https", "").is_ok());
        assert!(check_scope(&cloud, "other.invalid", "https", "").is_err());
        assert!(check_scope(&cloud, "gitlab.com", "http", "").is_err());
        assert!(check_scope(&cloud, "", "https", "").is_err());
        let managed = normalize_instance("https://gitlab.example.com:8443/Team/GitLab").unwrap();
        assert!(check_scope(
            &managed,
            "gitlab.example.com:8443",
            "https",
            "/Team/GitLab/"
        )
        .is_ok());
        assert!(check_scope(&managed, "gitlab.example.com", "https", "Team/GitLab").is_err());
        assert!(check_scope(&managed, "gitlab.example.com:8443", "https", "team/gitlab").is_err());
        assert!(check_scope(&managed, "gitlab.example.com:8443/Team/GitLab", "https", "").is_ok());
        assert!(check_scope(&managed, "other.invalid/Team/GitLab", "https", "").is_err());
        assert!(check_scope(&managed, "gitlab.example.com:8443/team/gitlab", "https", "").is_err());
        assert!(check_scope(
            &managed,
            "gitlab.example.com:8443/Team/GitLab",
            "https",
            "other"
        )
        .is_err());
        assert!(check_scope(
            &managed,
            "user@gitlab.example.com:8443",
            "https",
            "Team/GitLab"
        )
        .is_err());
    }

    #[test]
    fn relative_config_directories_are_never_selected() {
        let absolute = std::env::temp_dir();
        assert_eq!(
            absolute_directory(Some(absolute.clone().into_os_string())),
            Some(absolute.clone())
        );
        assert!(absolute_directory(Some("relative/config".into())).is_none());
        assert!(absolute_directory(Some("".into())).is_none());
        let paths =
            std::env::join_paths([absolute.clone(), PathBuf::from("relative/config")]).unwrap();
        assert_eq!(absolute_directories(Some(paths)), vec![absolute]);
        assert!(absolute_directories(Some("relative/config".into())).is_empty());
    }

    #[test]
    fn only_fixed_config_command_and_safe_environment_are_exposed() {
        let command = config_command(
            Path::new("C:/tools/glab.exe"),
            Path::new("C:/data"),
            "gitlab.com:8443",
            Path::new("C:/isolated-config"),
        );
        let arguments: Vec<_> = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_str().unwrap())
            .collect();
        assert_eq!(
            arguments,
            ["config", "get", "token", "--host", "gitlab.com:8443"]
        );
        let environment: Vec<_> = command
            .as_std()
            .get_envs()
            .map(|(key, _)| key.to_str().unwrap())
            .collect();
        assert!(!environment.contains(&"GITLAB_TOKEN"));
        assert!(!environment.contains(&"OAUTH_TOKEN"));
        assert!(!environment.contains(&"GITLAB_API_HOST"));
        assert!(!environment.contains(&"CI_JOB_TOKEN"));
        assert!(!environment.contains(&"GIT_DIR"));
        let config_dir = command
            .as_std()
            .get_envs()
            .find(|(key, _)| *key == "GLAB_CONFIG_DIR")
            .unwrap()
            .1
            .unwrap();
        assert_eq!(config_dir, Path::new("C:/isolated-config"));
    }

    #[test]
    fn invalid_token_output_is_rejected_without_echoing_it() {
        for token in ["", "fake secret", "fake\nsecret", "fake\u{001b}secret"] {
            let error = check_token(token.into()).unwrap_err();
            assert_eq!(error.code, "AUTH_REQUIRED");
            assert!(!error.message.contains("fake"));
        }
        assert!(check_token("fake-test-token-only".into()).is_ok());
        assert!(check_token("x".repeat(4097)).is_err());
    }

    #[cfg(windows)]
    fn test_command(script: &str) -> Command {
        let mut command = Command::new("cmd.exe");
        command
            .args(["/d", "/c", script])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .creation_flags(0x0800_0000);
        command
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn child_capture_is_bounded_and_errors_do_not_include_stdout_or_stderr() {
        let output = capture(
            test_command("echo fake-test-token-only"),
            Duration::from_secs(2),
        )
        .await
        .unwrap();
        assert_eq!(output, "fake-test-token-only");
        let error = capture(
            test_command("echo fake-secret& echo private-error 1>&2& exit /b 1"),
            Duration::from_secs(2),
        )
        .await
        .unwrap_err();
        assert!(!error.message.contains("fake-secret"));
        assert!(!error.message.contains("private-error"));
        let error = capture(
            test_command("for /l %i in (1,1,5000) do @echo x"),
            Duration::from_secs(2),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, "TOO_LARGE");
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn long_running_child_times_out() {
        let mut command = Command::new("powershell.exe");
        command
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 10",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .creation_flags(0x0800_0000);
        let error = capture(command, Duration::from_millis(50))
            .await
            .unwrap_err();
        assert_eq!(error.code, "TIMEOUT");
    }

    #[tokio::test]
    #[ignore = "Explicit local glab credential read; accepts valid credentials or safely rejects expired OAuth without displaying secrets"]
    async fn installed_glab_credentials_are_read_or_expired_oauth_is_rejected() {
        let instance = normalize_instance("https://gitlab.com").unwrap();
        match read_token(&instance, &std::env::temp_dir()).await {
            Ok(token) => assert!(!token.is_empty()),
            Err(error) => {
                assert_eq!(error.code, "AUTH_REQUIRED");
                assert!(error.message.contains("OAuth"));
            }
        }
    }

    #[test]
    #[ignore = "Explicit local configuration check; GLAB_TEST_URL selects the saved host without networking"]
    fn selected_saved_connection_is_discoverable() {
        let url = std::env::var("GLAB_TEST_URL")
            .expect("Set GLAB_TEST_URL for the intended saved glab instance");
        let instance = normalize_instance(&url).unwrap();
        let text = read_config_text().expect("Could not read the selected glab config file");
        let document = parse_config(&text).expect("Could not parse the selected glab config file");
        let host = &instance[Position::BeforeHost..Position::AfterPort];
        assert!(
            document["hosts"][host].as_hash().is_some(),
            "Requested host missing from selected config"
        );
        assert!(
            configured_connections(&text).unwrap().contains(&url),
            "Saved host was not listed"
        );
        assert!(
            select_source(&text, &instance).is_ok(),
            "Saved host credential could not be selected"
        );
    }
}
