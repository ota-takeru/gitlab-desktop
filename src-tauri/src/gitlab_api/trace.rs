//! The bounded tail of a CI job log, rendered with its colours and sections.

use super::*;

pub(super) async fn get_trace_tail(
    client: &Client,
    url: &Url,
) -> Result<(Vec<u8>, bool), AppError> {
    let mut retries = 0;
    loop {
        let response = match client
            .get(url.clone())
            .header(reqwest::header::RANGE, format!("bytes=-{MAX_TRACE_BYTES}"))
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                if retries < MAX_GET_RETRIES {
                    retries += 1;
                    wait_for_get_retry(retries).await;
                    continue;
                }
                return Err(transport_error(&error));
            }
        };
        let status = response.status();
        if is_recoverable_server_error(status) && retries < MAX_GET_RETRIES {
            retries += 1;
            wait_for_get_retry(retries).await;
            continue;
        }
        // A suffix range of an empty log cannot be satisfied.
        if status == StatusCode::RANGE_NOT_SATISFIABLE {
            return Ok((Vec::new(), false));
        }
        if !status.is_success() {
            return Err(status_error(status, response.headers(), false));
        }
        if !matches!(status, StatusCode::OK | StatusCode::PARTIAL_CONTENT) {
            return Err(unsupported_response(
                "GitLabから対応していない形式のジョブログが返されました。",
            ));
        }
        let range_start = (status == StatusCode::PARTIAL_CONTENT)
            .then(|| content_range_start(response.headers()))
            .flatten();
        match read_tail(response).await {
            Ok((bytes, dropped)) => {
                let head_omitted = dropped
                    || match (status, range_start) {
                        (StatusCode::PARTIAL_CONTENT, Some(start)) => start > 0,
                        (StatusCode::PARTIAL_CONTENT, None) => bytes.len() >= MAX_TRACE_BYTES,
                        _ => false,
                    };
                return Ok((bytes, head_omitted));
            }
            Err(error)
                if matches!(error.code.as_str(), "NETWORK" | "TIMEOUT")
                    && retries < MAX_GET_RETRIES =>
            {
                retries += 1;
                wait_for_get_retry(retries).await;
            }
            Err(error) => return Err(error),
        }
    }
}

/// The first byte of a `Content-Range: bytes <start>-<end>/<size>` response.
pub(super) fn content_range_start(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(reqwest::header::CONTENT_RANGE)?
        .to_str()
        .ok()?
        .trim()
        .strip_prefix("bytes ")?
        .split('-')
        .next()?
        .trim()
        .parse()
        .ok()
}

/// Keeps the last `MAX_TRACE_BYTES` of the body; reports whether any were dropped.
pub(super) async fn read_tail(mut response: Response) -> Result<(Vec<u8>, bool), AppError> {
    let too_large = || {
        AppError::new(
            "TOO_LARGE",
            "ジョブログが大きすぎるため表示できません。GitLabで開いてください。",
        )
    };
    if response
        .content_length()
        .is_some_and(|length| length > MAX_TRACE_DOWNLOAD_BYTES as u64)
    {
        return Err(too_large());
    }
    let mut output = Vec::new();
    let mut total = 0_usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| transport_error(&error))?
    {
        total = total.saturating_add(chunk.len());
        if total > MAX_TRACE_DOWNLOAD_BYTES {
            return Err(too_large());
        }
        output.extend_from_slice(&chunk);
        if output.len() > 2 * MAX_TRACE_BYTES {
            output.drain(..output.len() - MAX_TRACE_BYTES);
        }
    }
    if output.len() > MAX_TRACE_BYTES {
        output.drain(..output.len() - MAX_TRACE_BYTES);
    }
    Ok((output, total > MAX_TRACE_BYTES))
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(super) struct TraceStyle {
    fg: Option<&'static str>,
    bold: bool,
}

/// Turns raw log bytes into display lines of styled spans. Only foreground
/// colour and bold survive, as names the UI maps to theme colours; other
/// escape sequences, control characters and GitLab's section markers are
/// removed, and a carriage return starts the line over as a terminal would.
pub(super) fn render_trace(bytes: &[u8], head_omitted: bool) -> (Vec<Value>, bool) {
    let bytes = if head_omitted {
        // The kept part starts mid-line (and maybe mid-character).
        bytes
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(&bytes[bytes.len()..], |at| &bytes[at + 1..])
    } else {
        bytes
    };
    let text = String::from_utf8_lossy(bytes);
    let mut style = TraceStyle::default();
    let mut lines = Vec::new();
    let mut raw_lines: Vec<&str> = text.split('\n').collect();
    if raw_lines.last() == Some(&"") {
        raw_lines.pop();
    }
    for raw in raw_lines {
        let (raw, had_marker) = remove_section_markers(raw);
        let spans = trace_line_spans(&raw, &mut style);
        if had_marker && spans.is_empty() {
            continue;
        }
        lines.push(Value::Array(spans));
    }
    let mut head_omitted = head_omitted;
    if lines.len() > MAX_TRACE_LINES {
        lines.drain(..lines.len() - MAX_TRACE_LINES);
        head_omitted = true;
    }
    (lines, head_omitted)
}

/// Removes `section_start:<time>:<name>[options]` and `section_end:<time>:<name>`.
pub(super) fn remove_section_markers(line: &str) -> (std::borrow::Cow<'_, str>, bool) {
    if !line.contains("section_start:") && !line.contains("section_end:") {
        return (std::borrow::Cow::Borrowed(line), false);
    }
    let mut output = String::with_capacity(line.len());
    let mut rest = line;
    let mut found = false;
    while let Some((start, marker_len)) = ["section_start:", "section_end:"]
        .iter()
        .filter_map(|marker| rest.find(marker).map(|at| (at, marker.len())))
        .min_by_key(|(at, _)| *at)
    {
        let after = &rest[start + marker_len..];
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        let Some(name_part) = after[digits..].strip_prefix(':').filter(|_| digits > 0) else {
            output.push_str(&rest[..start + marker_len]);
            rest = after;
            continue;
        };
        let name_len = name_part
            .bytes()
            .take_while(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
            .count();
        let mut end = name_len;
        if name_part[name_len..].starts_with('[') {
            if let Some(close) = name_part[name_len..].find(']') {
                end = name_len + close + 1;
            }
        }
        output.push_str(&rest[..start]);
        rest = &name_part[end..];
        found = true;
    }
    output.push_str(rest);
    (std::borrow::Cow::Owned(output), found)
}

pub(super) fn push_trace_text(
    spans: &mut Vec<(String, TraceStyle)>,
    current: &mut String,
    style: TraceStyle,
) {
    if current.is_empty() {
        return;
    }
    match spans.last_mut() {
        Some((text, last)) if *last == style => text.push_str(current),
        _ => spans.push((current.clone(), style)),
    }
    current.clear();
}

pub(super) fn trace_line_spans(line: &str, style: &mut TraceStyle) -> Vec<Value> {
    let mut spans: Vec<(String, TraceStyle)> = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '\u{1b}' => match chars.next() {
                Some('[') => {
                    let mut params = String::new();
                    let mut final_byte = None;
                    for next in chars.by_ref() {
                        if ('\u{40}'..='\u{7e}').contains(&next) {
                            final_byte = Some(next);
                            break;
                        }
                        if params.len() < 64 {
                            params.push(next);
                        }
                    }
                    if final_byte == Some('m') {
                        push_trace_text(&mut spans, &mut current, *style);
                        apply_sgr(&params, style);
                    }
                }
                Some(']') => {
                    // An operating system command ends with BEL or ESC \.
                    while let Some(next) = chars.next() {
                        if next == '\u{7}'
                            || (next == '\u{1b}' && chars.next_if_eq(&'\\').is_some())
                        {
                            break;
                        }
                    }
                }
                _ => {}
            },
            '\r' => {
                current.clear();
                spans.clear();
            }
            '\t' => current.push('\t'),
            character if character.is_control() => {}
            character => current.push(character),
        }
    }
    push_trace_text(&mut spans, &mut current, *style);
    spans
        .into_iter()
        .map(|(text, style)| {
            let mut span = json!({ "text": text });
            if let Some(fg) = style.fg {
                span["fg"] = fg.into();
            }
            if style.bold {
                span["bold"] = true.into();
            }
            span
        })
        .collect()
}

pub(super) fn apply_sgr(params: &str, style: &mut TraceStyle) {
    let codes: Vec<u32> = params
        .split([';', ':'])
        .map(|code| code.parse().unwrap_or(0))
        .collect();
    let mut index = 0;
    while index < codes.len() {
        match codes[index] {
            0 => *style = TraceStyle::default(),
            1 => style.bold = true,
            22 => style.bold = false,
            code @ (30..=37 | 90..=97) => {
                style.fg = match code % 10 {
                    0 => Some("gray"),
                    1 => Some("red"),
                    2 => Some("green"),
                    3 => Some("yellow"),
                    4 => Some("blue"),
                    5 => Some("magenta"),
                    6 => Some("cyan"),
                    _ => None,
                }
            }
            39 => style.fg = None,
            // 256-colour and RGB forms carry their own arguments, which are skipped.
            38 | 48 => {
                index += match codes.get(index + 1) {
                    Some(5) => 2,
                    Some(2) => 4,
                    _ => 0,
                }
            }
            _ => {}
        }
        index += 1;
    }
}
