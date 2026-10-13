use crate::dto::AppError;
use crate::gitlab_api::{endpoint, read_limited, status_error, validate_id};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{Client, StatusCode};
use serde_json::Value;
use std::time::Duration;
use url::Url;

pub const MAX_UPLOAD_BYTES: usize = 10 * 1024 * 1024;
/// Uploads assume at least 512 kbit/s upstream, so a 10 MiB file is not cut
/// off (and turned into an ambiguous write) by the session's 20 s timeout.
const UPLOAD_BASE_TIMEOUT_SECS: u64 = 20;
const UPLOAD_MIN_BYTES_PER_SEC: u64 = 64 * 1024;

fn upload_timeout(len: usize) -> Duration {
    Duration::from_secs(UPLOAD_BASE_TIMEOUT_SECS + (len as u64).div_ceil(UPLOAD_MIN_BYTES_PER_SEC))
}

pub fn validate_filename(name: &str) -> Result<(), AppError> {
    if name.is_empty()
        || name.len() > 255
        || matches!(name, "." | "..")
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | '"'))
    {
        return Err(AppError::new("INVALID_INPUT", "添付ファイル名が不正です。"));
    }
    Ok(())
}

pub fn decode_upload(name: &str, encoded: &str) -> Result<Vec<u8>, AppError> {
    validate_filename(name)?;
    if encoded.len() > MAX_UPLOAD_BYTES.div_ceil(3) * 4 {
        return Err(AppError::new("TOO_LARGE", "添付は10MiBまでです。"));
    }
    let data = STANDARD
        .decode(encoded)
        .map_err(|_| AppError::new("INVALID_INPUT", "添付データが不正です。"))?;
    if data.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::new("TOO_LARGE", "添付は10MiBまでです。"));
    }
    Ok(data)
}

fn unknown_upload() -> AppError {
    AppError::new(
        "UNKNOWN_OUTCOME",
        "添付がGitLabに届いた可能性があります。再送せずGitLabで確認してください。",
    )
}

/// Send once. Filename/data are supplied by the file picker, never an arbitrary
/// filesystem path. The native session supplies credentials and the API origin.
pub async fn upload(
    client: &Client,
    api_base: &Url,
    project_id: &str,
    file_name: &str,
    data: Vec<u8>,
) -> Result<String, AppError> {
    validate_id(project_id, "projectId")?;
    validate_filename(file_name)?;
    if data.len() > MAX_UPLOAD_BYTES {
        return Err(AppError::new("TOO_LARGE", "添付は10MiBまでです。"));
    }
    let boundary = format!("gitlab-desktop-{}", uuid::Uuid::new_v4());
    let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").into_bytes();
    body.extend_from_slice(&data);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let response = client
        .post(endpoint(api_base, &["projects", project_id, "uploads"])?)
        .timeout(upload_timeout(body.len()))
        .header(
            reqwest::header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(body)
        .send()
        .await
        .map_err(|_| unknown_upload())?;
    let status = response.status();
    if !matches!(status, StatusCode::OK | StatusCode::CREATED) {
        return Err(
            if status.is_success()
                || status.is_server_error()
                || status == StatusCode::REQUEST_TIMEOUT
            {
                unknown_upload()
            } else {
                status_error(status, response.headers(), true)
            },
        );
    }
    let bytes = read_limited(response, 64 * 1024)
        .await
        .map_err(|_| unknown_upload())?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| unknown_upload())?;
    upload_markdown(api_base, file_name, &value)
}

fn upload_markdown(api_base: &Url, file_name: &str, value: &Value) -> Result<String, AppError> {
    let relative = value
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(unknown_upload)?;
    let full = value
        .get("full_path")
        .and_then(Value::as_str)
        .ok_or_else(unknown_upload)?;
    if !relative.starts_with("/uploads/")
        || !full.starts_with('/')
        || full.starts_with("//")
        || !full.ends_with(relative)
        || full.len() > 4096
        || full
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | '?' | '#' | '(' | ')' | ' '))
        || full.split('/').any(|part| matches!(part, "." | ".."))
    {
        return Err(unknown_upload());
    }
    let base_path = api_base
        .path()
        .strip_suffix("api/v4/")
        .ok_or_else(unknown_upload)?;
    let mut url = api_base.clone();
    let path = if base_path != "/" && full.starts_with(base_path) {
        full.to_owned()
    } else {
        format!("{}{full}", base_path.trim_end_matches('/'))
    };
    url.set_path(&path);
    url.set_query(None);
    url.set_fragment(None);
    let label = file_name
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]");
    let image = value
        .get("markdown")
        .and_then(Value::as_str)
        .is_some_and(|s| s.starts_with("!["));
    Ok(format!("{}[{label}]({url})", if image { "!" } else { "" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_header_injection_and_oversized_uploads() {
        for name in ["../secret", "C:\\secret", "a\r\nb", "a\"b", ""] {
            assert_eq!(decode_upload(name, "").unwrap_err().code, "INVALID_INPUT");
        }
        assert_eq!(
            decode_upload("ok.txt", "!").unwrap_err().code,
            "INVALID_INPUT"
        );
        let oversized = "A".repeat(MAX_UPLOAD_BYTES.div_ceil(3) * 4 + 1);
        assert_eq!(
            decode_upload("ok.txt", &oversized).unwrap_err().code,
            "TOO_LARGE"
        );
        assert_eq!(decode_upload("ok.txt", "YWJj").unwrap(), b"abc");
    }

    #[test]
    fn upload_timeout_grows_with_size_beyond_session_timeout() {
        assert_eq!(upload_timeout(0), Duration::from_secs(20));
        assert_eq!(upload_timeout(MAX_UPLOAD_BYTES), Duration::from_secs(180));
    }

    #[test]
    fn normalizes_safe_upload_links_with_self_managed_subpath() {
        let api = Url::parse("https://example.test/GitLab/api/v4/").unwrap();
        let value = serde_json::json!({"url":"/uploads/abc/test.png","full_path":"/-/project/7/uploads/abc/test.png","markdown":"![test](/uploads/abc/test.png)"});
        assert_eq!(
            upload_markdown(&api, "test[1].png", &value).unwrap(),
            "![test\\[1\\].png](https://example.test/GitLab/-/project/7/uploads/abc/test.png)"
        );
        for path in [
            "//evil.test/uploads/abc/test.png",
            "/../uploads/abc/test.png",
            "https://evil.test/uploads/abc/test.png",
        ] {
            let mut bad = value.clone();
            bad["full_path"] = Value::String(path.into());
            assert_eq!(
                upload_markdown(&api, "test.png", &bad).unwrap_err().code,
                "UNKNOWN_OUTCOME"
            );
        }
    }

    #[tokio::test]
    async fn posts_binary_file_as_one_multipart_request() {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let api = Url::parse(&format!(
            "http://{}/api/v4/",
            listener.local_addr().unwrap()
        ))
        .unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut chunk = [0u8; 4096];
                let count = stream.read(&mut chunk).unwrap();
                assert!(count > 0);
                request.extend_from_slice(&chunk[..count]);
                if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]);
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|s| s.trim().parse().unwrap())
                        })
                        .unwrap();
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let body = r#"{"url":"/uploads/abc/test.bin","full_path":"/-/project/7/uploads/abc/test.bin","markdown":"[test](/uploads/abc/test.bin)"}"#;
            write!(
                stream,
                "HTTP/1.1 201 Created\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
            request
        });
        let markdown = upload(&Client::new(), &api, "7", "test.bin", vec![0, 255, 65])
            .await
            .unwrap();
        assert!(markdown.starts_with("[test.bin](http://"));
        let request = server.join().unwrap();
        assert!(request.starts_with(b"POST /api/v4/projects/7/uploads HTTP/1.1"));
        let text = String::from_utf8_lossy(&request);
        assert!(text.contains("multipart/form-data; boundary="));
        assert!(text.contains("name=\"file\"; filename=\"test.bin\""));
        assert!(request.windows(3).any(|part| part == [0, 255, 65]));
    }
}
