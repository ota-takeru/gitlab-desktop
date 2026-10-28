//! Repository files that are not UTF-8 are read in the legacy encoding they most likely use.

use std::borrow::Cow;
use std::sync::RwLock;

use chardetng::{EncodingDetector, Iso2022JpDetection, Utf8Detection};
use encoding_rs::Encoding;

/// What legacy text here tends to be: a CJK encoding tried first, or a country
/// domain that steers detection between single-byte encodings.
#[derive(Clone, Copy, Debug, PartialEq)]
enum LegacyHint {
    Encoding(&'static Encoding),
    Tld(&'static [u8]),
}

/// The hint for a Windows ANSI code page. Single-byte code pages decode any
/// bytes, so they only steer detection instead of being tried first.
fn legacy_hint(code_page: u32) -> Option<LegacyHint> {
    Some(match code_page {
        932 => LegacyHint::Encoding(encoding_rs::SHIFT_JIS),
        936 => LegacyHint::Encoding(encoding_rs::GBK),
        949 => LegacyHint::Encoding(encoding_rs::EUC_KR),
        950 => LegacyHint::Encoding(encoding_rs::BIG5),
        874 => LegacyHint::Tld(b"th"),
        1250 => LegacyHint::Tld(b"cz"),
        1251 => LegacyHint::Tld(b"ru"),
        1253 => LegacyHint::Tld(b"gr"),
        1254 => LegacyHint::Tld(b"tr"),
        1255 => LegacyHint::Tld(b"il"),
        1256 => LegacyHint::Tld(b"ae"),
        1257 => LegacyHint::Tld(b"lt"),
        1258 => LegacyHint::Tld(b"vn"),
        _ => return None,
    })
}

/// The hint for the interface language, for a system whose code page gives none
/// (a Japanese interface on English Windows still reads Shift_JIS first).
fn language_hint(language: &str) -> Option<LegacyHint> {
    Some(match language {
        "ja" => LegacyHint::Encoding(encoding_rs::SHIFT_JIS),
        "zh-Hans" => LegacyHint::Encoding(encoding_rs::GBK),
        "zh-Hant" => LegacyHint::Encoding(encoding_rs::BIG5),
        "ko" => LegacyHint::Encoding(encoding_rs::EUC_KR),
        "ru" => LegacyHint::Tld(b"ru"),
        _ => return None,
    })
}

static LANGUAGE_HINT: RwLock<Option<LegacyHint>> = RwLock::new(None);

/// Records the interface language the frontend shows.
pub fn set_language(language: &str) {
    *LANGUAGE_HINT
        .write()
        .unwrap_or_else(|error| error.into_inner()) = language_hint(language);
}

/// A CJK encoding wins over a domain: the system's, else the language's.
fn choose_hint(system: Option<LegacyHint>, language: Option<LegacyHint>) -> Option<LegacyHint> {
    match (system, language) {
        (Some(LegacyHint::Encoding(_)), _) | (_, None) => system,
        (_, Some(LegacyHint::Encoding(_))) | (None, _) => language,
        _ => system,
    }
}

fn current_hint() -> Option<LegacyHint> {
    let language = *LANGUAGE_HINT
        .read()
        .unwrap_or_else(|error| error.into_inner());
    choose_hint(system_code_page().and_then(legacy_hint), language)
}

#[cfg(windows)]
fn system_code_page() -> Option<u32> {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetACP() -> u32;
    }
    // SAFETY: GetACP takes no arguments and only returns the active ANSI code page.
    Some(unsafe { GetACP() })
}

#[cfg(not(windows))]
fn system_code_page() -> Option<u32> {
    None
}

/// Text that is not UTF-8: the hinted CJK encoding when the bytes are valid in
/// it (Shift_JIS on Japanese Windows, as before), else the encoding the bytes
/// look like.
fn decode_legacy(bytes: &[u8], hint: Option<LegacyHint>) -> Option<String> {
    if let Some(LegacyHint::Encoding(encoding)) = hint {
        if let Some(text) = encoding.decode_without_bom_handling_and_without_replacement(bytes) {
            return Some(text.into_owned());
        }
    }
    let tld = match hint {
        Some(LegacyHint::Tld(tld)) => Some(tld),
        _ => None,
    };
    let mut detector = EncodingDetector::new(Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    detector
        .guess(tld, Utf8Detection::Deny)
        .decode_without_bom_handling_and_without_replacement(bytes)
        .map(Cow::into_owned)
}

fn decode_text_with(bytes: &[u8], hint: Option<LegacyHint>) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(text.to_owned()),
        Err(_) => decode_legacy(bytes, hint),
    }
}

/// A text file's content; `None` for binary (NUL bytes, as git treats them)
/// or bytes that are text in no encoding.
pub fn decode_text(bytes: &[u8]) -> Option<String> {
    decode_text_with(bytes, current_hint())
}

/// Text that is shown in any case, such as git's diff output: undecodable
/// bytes become replacement characters.
pub fn decode_lossy(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => decode_legacy(bytes, current_hint())
            .unwrap_or_else(|| String::from_utf8_lossy(bytes).into_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encoded(encoding: &'static Encoding, text: &str) -> Vec<u8> {
        let (bytes, _, unmappable) = encoding.encode(text);
        assert!(!unmappable);
        bytes.into_owned()
    }

    const JAPANESE: &str =
        "-- 顧客の一覧を取得する\nSELECT name FROM customers WHERE status = '有効';\n";
    const SIMPLIFIED: &str =
        "// 读取配置文件并返回结果，如果文件不存在则使用默认值。\nfn main() {}\n";
    const TRADITIONAL: &str =
        "// 讀取設定檔並回傳結果，如果檔案不存在則使用預設值。\nfn main() {}\n";
    const KOREAN: &str =
        "// 설정 파일을 읽고 결과를 반환합니다. 파일이 없으면 기본값을 사용합니다.\n";
    const RUSSIAN: &str =
        "// Читает файл настроек и возвращает результат, иначе значения по умолчанию.\n";
    const GERMAN: &str = "// Liest die Einstellungen und gibt das Ergebnis zurück; sonst gelten Standardwerte für Größe.\n";

    #[test]
    fn utf8_and_binary_are_unchanged() {
        assert_eq!(
            decode_text_with("日本語".as_bytes(), None).as_deref(),
            Some("日本語")
        );
        assert_eq!(
            decode_text_with(&[0x89, b'P', b'N', b'G', 0, 0xff], None),
            None
        );
    }

    #[test]
    fn a_japanese_interface_reads_shift_jis_first_on_other_systems() {
        let hint = choose_hint(legacy_hint(1252), language_hint("ja"));
        assert_eq!(hint, language_hint("ja"));
        let bytes = encoded(encoding_rs::SHIFT_JIS, "SELECT '日本語' -- 表示");
        assert_eq!(
            decode_text_with(&bytes, hint).as_deref(),
            Some("SELECT '日本語' -- 表示")
        );
    }

    #[test]
    fn the_system_encoding_wins_over_the_language() {
        assert_eq!(
            choose_hint(legacy_hint(932), language_hint("zh-Hans")),
            legacy_hint(932)
        );
        assert_eq!(
            choose_hint(legacy_hint(1251), language_hint("en")),
            legacy_hint(1251)
        );
        assert_eq!(choose_hint(None, language_hint("ru")), language_hint("ru"));
        assert_eq!(choose_hint(None, None), None);
    }

    #[test]
    fn japanese_windows_reads_shift_jis_first() {
        let hint = legacy_hint(932);
        let bytes = encoded(encoding_rs::SHIFT_JIS, "SELECT '日本語' -- 表示");
        assert_eq!(
            decode_text_with(&bytes, hint).as_deref(),
            Some("SELECT '日本語' -- 表示")
        );
    }

    #[test]
    fn other_systems_detect_cjk_encodings() {
        for hint in [None, legacy_hint(1252)] {
            for (encoding, text) in [
                (encoding_rs::SHIFT_JIS, JAPANESE),
                (encoding_rs::GBK, SIMPLIFIED),
                (encoding_rs::BIG5, TRADITIONAL),
                (encoding_rs::EUC_KR, KOREAN),
            ] {
                assert_eq!(
                    decode_text_with(&encoded(encoding, text), hint).as_deref(),
                    Some(text),
                    "{}",
                    encoding.name()
                );
            }
        }
    }

    #[test]
    fn chinese_and_korean_windows_read_their_encoding() {
        assert_eq!(
            decode_text_with(&encoded(encoding_rs::GBK, SIMPLIFIED), legacy_hint(936)).as_deref(),
            Some(SIMPLIFIED)
        );
        assert_eq!(
            decode_text_with(&encoded(encoding_rs::BIG5, TRADITIONAL), legacy_hint(950)).as_deref(),
            Some(TRADITIONAL)
        );
        assert_eq!(
            decode_text_with(&encoded(encoding_rs::EUC_KR, KOREAN), legacy_hint(949)).as_deref(),
            Some(KOREAN)
        );
    }

    #[test]
    fn single_byte_encodings_are_detected() {
        assert_eq!(
            decode_text_with(
                &encoded(encoding_rs::WINDOWS_1251, RUSSIAN),
                legacy_hint(1251)
            )
            .as_deref(),
            Some(RUSSIAN)
        );
        assert_eq!(
            decode_text_with(
                &encoded(encoding_rs::WINDOWS_1252, GERMAN),
                legacy_hint(1252)
            )
            .as_deref(),
            Some(GERMAN)
        );
    }

    #[test]
    fn lossy_text_is_always_shown() {
        assert_eq!(decode_lossy(b"plain"), "plain");
        assert!(!decode_lossy(&[0xff, 0xfe, 0x00, 0x81]).is_empty());
    }
}
