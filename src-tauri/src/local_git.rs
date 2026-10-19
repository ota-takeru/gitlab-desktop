//! Read-only access to the user's own clone of a project, to show how its
//! working tree differs from the MR head. Nothing here fetches, checks out,
//! commits or writes the index: only read commands of the installed `git` run,
//! in the folder the user linked, with a bounded output and time.
use crate::dto::AppError;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;
use url::Url;

const MAX_DIFF_BYTES: usize = 16 * 1024 * 1024;
const MAX_SMALL_OUTPUT: usize = 64 * 1024;
const MAX_UNTRACKED_BYTES: usize = 1024 * 1024;
/// Untracked files shown as new files; more are only counted.
const MAX_UNTRACKED_FILES: usize = 300;
/// One working-tree file read for a new-file diff or the whole-file view.
pub const MAX_FILE_BYTES: u64 = 1024 * 1024;
const MAX_ERROR_OUTPUT: usize = 8 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
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
    "TEMP",
    "TMP",
];

fn git_failed() -> AppError {
    AppError::new(
        "UNSUPPORTED",
        "ローカルリポジトリをgitで読み取れませんでした。",
    )
}

fn resolve_program() -> Result<PathBuf, AppError> {
    let name = if cfg!(windows) { "git.exe" } else { "git" };
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .filter(|directory| directory.is_absolute())
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
        .ok_or_else(|| {
            AppError::new(
                "UNSUPPORTED",
                "gitが見つかりません。Git for WindowsをインストールしてPATHへ追加してください。",
            )
        })
}

struct Output {
    stdout: Vec<u8>,
    /// More than the limit was written; `stdout` holds only the limit.
    truncated: bool,
    success: bool,
    stderr: String,
}

async fn read_limited(
    mut reader: impl AsyncRead + Unpin,
    limit: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    let mut bytes = Vec::new();
    (&mut reader)
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .await?;
    let truncated = bytes.len() > limit;
    bytes.truncate(limit);
    Ok((bytes, truncated))
}

/// Runs one read command in `repository`. The executable and every argument
/// come from this module; the frontend only chooses the folder.
async fn run(
    program: &Path,
    repository: &Path,
    args: &[&str],
    limit: usize,
) -> Result<Output, AppError> {
    let mut command = Command::new(program);
    command
        .arg("-C")
        .arg(repository)
        // A file-system monitor configured for the clone would start a process;
        // paths are shown as written, without octal escapes.
        .args(["-c", "core.fsmonitor=false", "-c", "core.quotepath=off"])
        .args(["-c", "color.ui=false", "--no-pager"])
        .args(args)
        .env_clear();
    for name in SAFE_ENV {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    // Inherited GIT_DIR/GIT_WORK_TREE and similar never redirect the command.
    // Optional locks off: reading the status does not rewrite the index.
    command
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: reading the clone must not open a console window.
        command.creation_flags(0x0800_0000);
    }
    tokio::time::timeout(TIMEOUT, async {
        let mut child = command.spawn().map_err(|_| git_failed())?;
        let stdout = child.stdout.take().ok_or_else(git_failed)?;
        let stderr = child.stderr.take().ok_or_else(git_failed)?;
        let (out, err) = tokio::join!(
            read_limited(stdout, limit),
            read_limited(stderr, MAX_ERROR_OUTPUT)
        );
        let (stdout, truncated) = out.map_err(|_| git_failed())?;
        let (stderr, _) = err.map_err(|_| git_failed())?;
        if truncated {
            // The rest is not read; the process is stopped instead of blocking on a full pipe.
            let _ = child.start_kill();
        }
        let status = child.wait().await.map_err(|_| git_failed())?;
        Ok(Output {
            stdout,
            truncated,
            success: status.success(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
        })
    })
    .await
    .map_err(|_| {
        AppError::new(
            "TIMEOUT",
            "ローカルリポジトリの読み取りがタイムアウトしました。",
        )
    })?
}

/// git's own message is not shown: it can hold paths and configuration. Only
/// the causes the user can act on are named.
fn explain(output: &Output) -> AppError {
    let message = output.stderr.to_ascii_lowercase();
    if message.contains("dubious ownership") || message.contains("safe.directory") {
        AppError::new("FORBIDDEN", "gitがこのフォルダの所有者を信頼していないため読み取れません。git config --global --add safe.directory でこのフォルダを登録してください。")
    } else if message.contains("not a git repository") {
        AppError::new(
            "INVALID_INPUT",
            "このフォルダはgitリポジトリではありません。",
        )
    } else {
        git_failed()
    }
}

fn single_line(output: &Output) -> Option<String> {
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.trim_end_matches(['\r', '\n']);
    (output.success && !line.is_empty() && !line.contains('\n')).then(|| line.to_owned())
}

/// The top folder of the work tree that contains `input`, as git names it.
pub async fn repository_root(input: &str) -> Result<PathBuf, AppError> {
    // Explorer's "Copy as path" wraps the path in quotes.
    let trimmed = input.trim().trim_matches('"').trim();
    let path = PathBuf::from(trimmed);
    if trimmed.is_empty() || trimmed.chars().any(char::is_control) || !path.is_absolute() {
        return Err(AppError::new(
            "INVALID_INPUT",
            "ローカルリポジトリのフォルダを絶対パスで指定してください。",
        ));
    }
    if !path.is_dir() {
        return Err(AppError::new(
            "NOT_FOUND",
            "指定したフォルダが見つかりません。",
        ));
    }
    let program = resolve_program()?;
    let output = run(
        &program,
        &path,
        &["rev-parse", "--show-toplevel"],
        MAX_SMALL_OUTPUT,
    )
    .await?;
    let root = single_line(&output).ok_or_else(|| explain(&output))?;
    Ok(PathBuf::from(root))
}

/// The fetch URLs of the clone's remotes.
pub async fn remote_urls(root: &Path) -> Result<Vec<String>, AppError> {
    let program = resolve_program()?;
    let output = run(
        &program,
        root,
        &["config", "--get-regexp", r"^remote\..*\.url$"],
        MAX_SMALL_OUTPUT,
    )
    .await?;
    // Exit code 1 means no remote is configured.
    if !output.success && !output.stderr.trim().is_empty() {
        return Err(explain(&output));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.split_once(' ').map(|(_, url)| url.trim().to_owned()))
        .filter(|url| !url.is_empty())
        .collect())
}

/// Whether a remote URL names `project_path` on the connected instance, over
/// HTTPS (with the instance's own subpath) or SSH.
pub fn remote_matches(remote: &str, instance: &Url, project_path: &str) -> bool {
    let Some(host) = instance.host_str() else {
        return false;
    };
    let (remote_host, path) = if remote.contains("://") {
        let Ok(url) = Url::parse(remote) else {
            return false;
        };
        let path = match url.scheme() {
            "https" | "http" => {
                if url.port_or_known_default() != instance.port_or_known_default() {
                    return false;
                }
                let prefix = instance.path().trim_end_matches('/');
                match url.path().strip_prefix(prefix) {
                    Some(rest) if rest.starts_with('/') => rest.to_owned(),
                    _ => return false,
                }
            }
            "ssh" => url.path().to_owned(),
            _ => return false,
        };
        (url.host_str().unwrap_or_default().to_owned(), path)
    } else {
        // scp-like: [user@]host:group/project.git
        let Some((authority, path)) = remote.split_once(':') else {
            return false;
        };
        let host = authority.rsplit('@').next().unwrap_or_default();
        (host.to_owned(), path.to_owned())
    };
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    remote_host.eq_ignore_ascii_case(host) && path.eq_ignore_ascii_case(project_path)
}

fn valid_sha(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// The working tree of `root` against `head_sha`, with the facts needed to
/// read it truthfully: the local branch and HEAD, whether HEAD contains the MR
/// head, and how many untracked files could be added as new files.
pub async fn local_changes(root: &Path, head_sha: &str) -> Result<Value, AppError> {
    if !valid_sha(head_sha) {
        return Err(AppError::new(
            "INVALID_INPUT",
            "MRの最新コミットが正しくありません。",
        ));
    }
    if !root.is_dir() {
        return Err(AppError::new(
            "NOT_FOUND",
            "紐付けたローカルリポジトリのフォルダが見つかりません。紐付けをやり直してください。",
        ));
    }
    let program = resolve_program()?;
    let commit = format!("{head_sha}^{{commit}}");
    let present = run(
        &program,
        root,
        &["cat-file", "-e", &commit],
        MAX_SMALL_OUTPUT,
    )
    .await?;
    if !present.success {
        if !present.stderr.trim().is_empty() && !present.stderr.contains(head_sha) {
            let error = explain(&present);
            if error.code != "UNSUPPORTED" {
                return Err(error);
            }
        }
        return Err(AppError::new(
            "NOT_FOUND",
            &format!(
                "MRの最新コミット {} がローカルにありません。git fetchしてから再読み込みしてください。",
                &head_sha[..8]
            ),
        ));
    }
    let local_head = single_line(
        &run(
            &program,
            root,
            &["rev-parse", "--verify", "-q", "HEAD"],
            MAX_SMALL_OUTPUT,
        )
        .await?,
    );
    let branch = single_line(
        &run(
            &program,
            root,
            &["symbolic-ref", "--short", "-q", "HEAD"],
            MAX_SMALL_OUTPUT,
        )
        .await?,
    );
    let (contains_head, ahead) = if local_head.is_some() {
        let ancestor = run(
            &program,
            root,
            &["merge-base", "--is-ancestor", head_sha, "HEAD"],
            MAX_SMALL_OUTPUT,
        )
        .await?;
        let range = format!("{head_sha}..HEAD");
        let count = single_line(
            &run(
                &program,
                root,
                &["rev-list", "--count", &range],
                MAX_SMALL_OUTPUT,
            )
            .await?,
        )
        .and_then(|text| text.parse::<u64>().ok());
        (ancestor.success, count)
    } else {
        (false, None)
    };
    let untracked = run(
        &program,
        root,
        &["ls-files", "-z", "--others", "--exclude-standard"],
        MAX_UNTRACKED_BYTES,
    )
    .await?;
    if !untracked.success && !untracked.truncated {
        return Err(explain(&untracked));
    }
    let untracked_paths: Vec<String> = untracked
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(decode)
        .collect();
    // A cut-off listing ends in a partial path, which is not read.
    let complete_paths = if untracked.truncated {
        untracked_paths.len().saturating_sub(1)
    } else {
        untracked_paths.len()
    };
    let diff = run(
        &program,
        root,
        &[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "-M",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            head_sha,
            "--",
        ],
        MAX_DIFF_BYTES,
    )
    .await?;
    if !diff.success && !diff.truncated {
        return Err(explain(&diff));
    }
    let (mut diffs, truncated) = parse_patch(&diff.stdout, diff.truncated);
    // Untracked files join as new files while the size budget lasts.
    let mut budget = MAX_DIFF_BYTES.saturating_sub(diff.stdout.len());
    let mut included = 0;
    if !truncated {
        for path in untracked_paths
            .iter()
            .take(complete_paths.min(MAX_UNTRACKED_FILES))
        {
            match untracked_diff(root, path, &mut budget) {
                Ok(Some(entry)) => {
                    diffs.push(entry);
                    included += 1;
                }
                Ok(None) => {}
                Err(()) => break,
            }
        }
    }
    diffs.sort_by(|left, right| {
        let path = |diff: &Value| diff["newPath"].as_str().unwrap_or_default().to_owned();
        path(left).cmp(&path(right))
    });
    Ok(json!({
        "repositoryPath": root.to_string_lossy(),
        "comparedSha": head_sha,
        "localHead": local_head,
        "branch": branch,
        "containsMrHead": contains_head,
        "aheadCount": ahead,
        "untrackedCount": complete_paths,
        "untrackedMore": untracked.truncated,
        "untrackedIncluded": included,
        "diffs": diffs,
        "truncated": truncated,
    }))
}

/// A working-tree file as read for display, without following a symbolic link.
#[derive(Debug, PartialEq, Eq)]
pub enum WorktreeFile {
    Text(String),
    /// Not UTF-8 or Shift_JIS text (for example an image).
    Binary,
    TooLarge,
}

/// Reads `relative` (a git path with `/` separators) inside `root`. Paths
/// that leave the work tree, directly or through a linked folder, are refused.
pub fn read_worktree_file(root: &Path, relative: &str) -> Result<WorktreeFile, AppError> {
    let invalid = || {
        AppError::new(
            "INVALID_INPUT",
            "リポジトリ内のファイルを指定してください。",
        )
    };
    if relative.is_empty()
        || relative.len() > 4096
        || relative
            .chars()
            .any(|c| c.is_control() || c == '\\' || c == ':')
        || relative
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(invalid());
    }
    let path = relative
        .split('/')
        .fold(root.to_path_buf(), |path, part| path.join(part));
    let missing = || AppError::new("NOT_FOUND", "作業ツリーにこのファイルがありません。");
    let metadata = std::fs::symlink_metadata(&path).map_err(|_| missing())?;
    let base = root.canonicalize().map_err(|_| missing())?;
    let parent = path
        .parent()
        .and_then(|parent| parent.canonicalize().ok())
        .ok_or_else(missing)?;
    if !parent.starts_with(&base) {
        return Err(invalid());
    }
    // git records a link as the text of its target, so it is shown the same way.
    if metadata.file_type().is_symlink() {
        let target = std::fs::read_link(&path).map_err(|_| missing())?;
        return Ok(WorktreeFile::Text(
            target.to_string_lossy().replace('\\', "/"),
        ));
    }
    if !metadata.is_file() {
        return Err(missing());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Ok(WorktreeFile::TooLarge);
    }
    let bytes = std::fs::read(&path).map_err(|_| missing())?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Ok(WorktreeFile::TooLarge);
    }
    Ok(decode_text(&bytes).map_or(WorktreeFile::Binary, WorktreeFile::Text))
}

/// UTF-8, then Shift_JIS; text with NUL bytes is treated as binary, as git does.
fn decode_text(bytes: &[u8]) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(text.to_owned()),
        Err(_) => encoding_rs::SHIFT_JIS
            .decode_without_bom_handling_and_without_replacement(bytes)
            .map(|text| text.into_owned()),
    }
}

/// An untracked file as a new-file diff, in git's format. `Err` once the
/// size budget is spent, so later files are only counted; `None` for a file
/// that can no longer be read.
fn untracked_diff(root: &Path, path: &str, budget: &mut usize) -> Result<Option<Value>, ()> {
    let Ok(file) = read_worktree_file(root, path) else {
        return Ok(None);
    };
    let mut entry = json!({
        "oldPath": path,
        "newPath": path,
        "diff": "",
        "newFile": true,
        "deletedFile": false,
        "renamedFile": false,
        "tooLarge": false,
        "collapsed": false,
        "untracked": true,
    });
    match file {
        WorktreeFile::Text(text) => {
            let diff = new_file_diff(&text);
            *budget = budget.checked_sub(diff.len()).ok_or(())?;
            entry["diff"] = diff.into();
        }
        WorktreeFile::TooLarge => entry["tooLarge"] = true.into(),
        WorktreeFile::Binary => {}
    }
    Ok(Some(entry))
}

fn new_file_diff(text: &str) -> String {
    if text.is_empty() {
        return String::new();
    }
    let body = text.strip_suffix('\n').unwrap_or(text);
    let lines: Vec<&str> = body.split('\n').collect();
    let mut diff = if lines.len() == 1 {
        "@@ -0,0 +1 @@\n".to_owned()
    } else {
        format!("@@ -0,0 +1,{} @@\n", lines.len())
    };
    for line in &lines {
        diff.push('+');
        diff.push_str(line);
        diff.push('\n');
    }
    if !text.ends_with('\n') {
        diff.push_str("\\ No newline at end of file\n");
    }
    diff
}

fn decode(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => encoding_rs::SHIFT_JIS
            .decode_without_bom_handling_and_without_replacement(bytes)
            .map(|text| text.into_owned())
            .unwrap_or_else(|| String::from_utf8_lossy(bytes).into_owned()),
    }
}

/// git's C-style quoting of a path with special characters.
fn unquote(value: &str) -> String {
    let Some(inner) = value
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
    else {
        return value.to_owned();
    };
    let mut bytes = Vec::new();
    let mut chars = inner.bytes().peekable();
    while let Some(byte) = chars.next() {
        if byte != b'\\' {
            bytes.push(byte);
            continue;
        }
        match chars.next() {
            Some(b'n') => bytes.push(b'\n'),
            Some(b't') => bytes.push(b'\t'),
            Some(b'r') => bytes.push(b'\r'),
            Some(digit @ b'0'..=b'7') => {
                let mut code = u32::from(digit - b'0');
                for _ in 0..2 {
                    match chars.peek() {
                        Some(next @ b'0'..=b'7') => {
                            code = code * 8 + u32::from(next - b'0');
                            chars.next();
                        }
                        _ => break,
                    }
                }
                bytes.push(code as u8);
            }
            Some(other) => bytes.push(other),
            None => {}
        }
    }
    decode(&bytes)
}

fn strip_side(path: &str, prefix: &str) -> Option<String> {
    let path = unquote(path.trim_end_matches('\t'));
    (path != "/dev/null").then(|| path.strip_prefix(prefix).unwrap_or(&path).to_owned())
}

/// Splits `git diff` output into the same file shape as GitLab's MR diffs.
/// A cut-off output drops its last, incomplete file and says so.
pub fn parse_patch(bytes: &[u8], cut_off: bool) -> (Vec<Value>, bool) {
    let mut starts = Vec::new();
    let mut offset = 0;
    for line in bytes.split_inclusive(|byte| *byte == b'\n') {
        if line.starts_with(b"diff --git ") {
            starts.push(offset);
        }
        offset += line.len();
    }
    let mut blocks: Vec<&[u8]> = starts
        .iter()
        .enumerate()
        .map(|(index, start)| &bytes[*start..starts.get(index + 1).copied().unwrap_or(bytes.len())])
        .collect();
    let truncated = cut_off && blocks.pop().is_some();
    let diffs = blocks
        .into_iter()
        .map(|block| parse_file(&decode(block)))
        .collect();
    (diffs, truncated || (cut_off && starts.is_empty()))
}

fn parse_file(text: &str) -> Value {
    let (header, body) = match text.find("\n@@") {
        Some(index) => (&text[..index], &text[index + 1..]),
        None => (text, ""),
    };
    let mut lines = header.lines();
    let first = lines
        .next()
        .unwrap_or_default()
        .trim_start_matches("diff --git ");
    let (mut old_path, mut new_path) = (None, None);
    let (mut new_file, mut deleted_file, mut renamed_file) = (false, false, false);
    for line in lines {
        if line.starts_with("new file mode") {
            new_file = true;
        } else if line.starts_with("deleted file mode") {
            deleted_file = true;
        } else if let Some(path) = line.strip_prefix("rename from ") {
            renamed_file = true;
            old_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("rename to ") {
            renamed_file = true;
            new_path = Some(unquote(path));
        } else if let Some(path) = line.strip_prefix("--- ") {
            old_path = old_path.or_else(|| strip_side(path, "a/"));
        } else if let Some(path) = line.strip_prefix("+++ ") {
            new_path = new_path.or_else(|| strip_side(path, "b/"));
        }
    }
    // Binary or mode-only changes have no ---/+++ lines: the header names one
    // unchanged path as "a/<path> b/<path>".
    if old_path.is_none() && new_path.is_none() {
        let path = if first.starts_with('"') {
            first
                .split_once("\" ")
                .map(|(left, _)| unquote(&format!("{left}\"")))
                .unwrap_or_default()
        } else {
            let length = first.len().saturating_sub(5) / 2;
            first.get(2..2 + length).unwrap_or_default().to_owned()
        };
        let path = path.strip_prefix("a/").unwrap_or(&path).to_owned();
        old_path = Some(path.clone());
        new_path = Some(path);
    }
    let old_path = old_path.or_else(|| new_path.clone()).unwrap_or_default();
    let new_path = new_path.unwrap_or_else(|| old_path.clone());
    json!({
        "oldPath": old_path,
        "newPath": new_path,
        "diff": body,
        "newFile": new_file,
        "deletedFile": deleted_file,
        "renamedFile": renamed_file,
        "tooLarge": false,
        "collapsed": false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remotes_match_only_the_project_on_the_instance() {
        let instance = Url::parse("https://gitlab.example.com").unwrap();
        for remote in [
            "https://gitlab.example.com/group/app.git",
            "https://user@gitlab.example.com/Group/App",
            "git@gitlab.example.com:group/app.git",
            "ssh://git@gitlab.example.com:2222/group/app.git",
        ] {
            assert!(remote_matches(remote, &instance, "group/app"), "{remote}");
        }
        for remote in [
            "https://github.com/group/app.git",
            "git@github.com:group/app.git",
            "https://gitlab.example.com/group/app-other.git",
            "https://gitlab.example.com:8443/group/app.git",
            "file:///C:/repos/group/app",
            "C:/repos/group/app",
        ] {
            assert!(!remote_matches(remote, &instance, "group/app"), "{remote}");
        }
        let subpath = Url::parse("https://example.com/gitlab").unwrap();
        assert!(remote_matches(
            "https://example.com/gitlab/group/app.git",
            &subpath,
            "group/app"
        ));
        assert!(!remote_matches(
            "https://example.com/group/app.git",
            &subpath,
            "group/app"
        ));
    }

    #[test]
    fn patch_files_take_the_merge_request_diff_shape() {
        let patch = "diff --git a/src/main.rs b/src/main.rs\nindex 1111111..2222222 100644\n--- a/src/main.rs\n+++ b/src/main.rs\n@@ -1,2 +1,2 @@\n fn main() {\n-    old();\n+    new();\ndiff --git a/new file.txt b/new file.txt\nnew file mode 100644\nindex 0000000..3333333\n--- /dev/null\n+++ b/new file.txt\t\n@@ -0,0 +1 @@\n+hello\ndiff --git a/gone.txt b/gone.txt\ndeleted file mode 100644\nindex 4444444..0000000\n--- a/gone.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\ndiff --git a/old.rs b/renamed.rs\nsimilarity index 100%\nrename from old.rs\nrename to renamed.rs\ndiff --git a/logo.png b/logo.png\nindex 5555555..6666666 100644\nBinary files a/logo.png and b/logo.png differ\ndiff --git \"a/\\346\\227\\245\\346\\234\\254.txt\" \"b/\\346\\227\\245\\346\\234\\254.txt\"\nindex 7777777..8888888 100644\n--- \"a/\\346\\227\\245\\346\\234\\254.txt\"\n+++ \"b/\\346\\227\\245\\346\\234\\254.txt\"\n@@ -1 +1 @@\n-a\n+b\n";
        let (diffs, truncated) = parse_patch(patch.as_bytes(), false);
        assert!(!truncated);
        assert_eq!(diffs.len(), 6);
        assert_eq!(diffs[0]["newPath"], "src/main.rs");
        assert_eq!(
            diffs[0]["diff"],
            "@@ -1,2 +1,2 @@\n fn main() {\n-    old();\n+    new();\n"
        );
        assert_eq!(diffs[1]["oldPath"], "new file.txt");
        assert_eq!(diffs[1]["newPath"], "new file.txt");
        assert_eq!(diffs[1]["newFile"], true);
        assert_eq!(diffs[2]["newPath"], "gone.txt");
        assert_eq!(diffs[2]["deletedFile"], true);
        assert_eq!(diffs[3]["oldPath"], "old.rs");
        assert_eq!(diffs[3]["newPath"], "renamed.rs");
        assert_eq!(diffs[3]["renamedFile"], true);
        assert_eq!(diffs[3]["diff"], "");
        assert_eq!(diffs[4]["newPath"], "logo.png");
        assert_eq!(diffs[5]["newPath"], "日本.txt");
    }

    #[test]
    fn a_cut_off_patch_drops_its_incomplete_last_file() {
        let patch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/b.txt b/b.txt\n--- a/b.txt\n+++ b/b.txt\n@@ -1 +1 @@\n-a\n";
        let (diffs, truncated) = parse_patch(patch.as_bytes(), true);
        assert!(truncated);
        assert_eq!(diffs.len(), 1);
        assert_eq!(diffs[0]["newPath"], "a.txt");
    }

    #[test]
    fn shift_jis_files_are_decoded() {
        let (bytes, _, _) = encoding_rs::SHIFT_JIS.encode("+日本語\n");
        let mut patch =
            b"diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n".to_vec();
        patch.extend_from_slice(&bytes);
        let (diffs, _) = parse_patch(&patch, false);
        assert_eq!(diffs[0]["diff"], "@@ -0,0 +1 @@\n+日本語\n");
    }

    /// Runs the real `git` on a temporary repository when one is installed.
    #[test]
    fn local_changes_compare_the_working_tree_with_the_head() {
        let Ok(program) = resolve_program() else {
            return;
        };
        let directory =
            std::env::temp_dir().join(format!("gitlab-desktop-local-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let git = |args: &[&str]| {
            let status = std::process::Command::new(&program)
                .arg("-C")
                .arg(&directory)
                .args([
                    "-c",
                    "user.name=t",
                    "-c",
                    "user.email=t@example.com",
                    "-c",
                    "commit.gpgsign=false",
                ])
                .args(args)
                .output()
                .unwrap();
            assert!(status.status.success(), "{args:?}");
            String::from_utf8(status.stdout).unwrap()
        };
        git(&["init", "-q"]);
        std::fs::write(directory.join("a.txt"), "one\n").unwrap();
        git(&["add", "a.txt"]);
        git(&["commit", "-q", "-m", "first"]);
        let head = git(&["rev-parse", "HEAD"]).trim().to_owned();
        std::fs::write(directory.join("a.txt"), "one\ntwo\n").unwrap();
        git(&["commit", "-q", "-am", "second"]);
        std::fs::write(directory.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        std::fs::write(directory.join("untracked.txt"), "x\ny").unwrap();
        std::fs::write(directory.join("image.bin"), [0u8, 1, 2]).unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let root = runtime
            .block_on(repository_root(directory.to_str().unwrap()))
            .unwrap();
        let result = runtime.block_on(local_changes(&root, &head)).unwrap();
        let missing = runtime.block_on(local_changes(&root, &"0".repeat(40)));
        std::fs::remove_dir_all(&directory).ok();
        assert_eq!(result["containsMrHead"], true);
        assert_eq!(result["aheadCount"], 1);
        assert_eq!(result["untrackedCount"], 2);
        assert_eq!(result["untrackedIncluded"], 2);
        assert_eq!(result["truncated"], false);
        assert_eq!(result["diffs"][0]["newPath"], "a.txt");
        assert_eq!(
            result["diffs"][0]["diff"],
            "@@ -1 +1,3 @@\n one\n+two\n+three\n"
        );
        // Untracked files are new files, in path order; binary ones have no lines.
        assert_eq!(result["diffs"][1]["newPath"], "image.bin");
        assert_eq!(result["diffs"][1]["newFile"], true);
        assert_eq!(result["diffs"][1]["untracked"], true);
        assert!(result["diffs"][0].get("untracked").is_none());
        assert_eq!(result["diffs"][1]["diff"], "");
        assert_eq!(result["diffs"][2]["newPath"], "untracked.txt");
        assert_eq!(
            result["diffs"][2]["diff"],
            "@@ -0,0 +1,2 @@\n+x\n+y\n\\ No newline at end of file\n"
        );
        assert_eq!(missing.unwrap_err().code, "NOT_FOUND");
    }

    #[test]
    fn worktree_files_stay_inside_the_repository() {
        let directory =
            std::env::temp_dir().join(format!("gitlab-desktop-file-{}", uuid::Uuid::new_v4()));
        let root = directory.join("repo");
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
        std::fs::write(directory.join("secret.txt"), "outside\n").unwrap();
        let (sjis, _, _) = encoding_rs::SHIFT_JIS.encode("日本語\n");
        std::fs::write(root.join("sjis.txt"), &sjis).unwrap();
        std::fs::write(root.join("binary.bin"), [0u8, 1]).unwrap();
        std::fs::write(
            root.join("large.txt"),
            vec![b'a'; MAX_FILE_BYTES as usize + 1],
        )
        .unwrap();
        let read = |path: &str| read_worktree_file(&root, path);
        assert_eq!(
            read("src/main.rs").unwrap(),
            WorktreeFile::Text("fn main() {}\n".into())
        );
        assert_eq!(
            read("sjis.txt").unwrap(),
            WorktreeFile::Text("日本語\n".into())
        );
        assert_eq!(read("binary.bin").unwrap(), WorktreeFile::Binary);
        assert_eq!(read("large.txt").unwrap(), WorktreeFile::TooLarge);
        for path in [
            "../secret.txt",
            "src/../../secret.txt",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "src\\main.rs",
            "",
            "src//main.rs",
        ] {
            assert_eq!(read(path).unwrap_err().code, "INVALID_INPUT", "{path}");
        }
        assert_eq!(read("missing.txt").unwrap_err().code, "NOT_FOUND");
        assert_eq!(read("src").unwrap_err().code, "NOT_FOUND");
        std::fs::remove_dir_all(&directory).ok();
    }

    #[test]
    fn new_file_diffs_follow_git() {
        assert_eq!(new_file_diff(""), "");
        assert_eq!(new_file_diff("a\n"), "@@ -0,0 +1 @@\n+a\n");
        assert_eq!(new_file_diff("a\nb\n"), "@@ -0,0 +1,2 @@\n+a\n+b\n");
        assert_eq!(
            new_file_diff("a"),
            "@@ -0,0 +1 @@\n+a\n\\ No newline at end of file\n"
        );
    }
}
