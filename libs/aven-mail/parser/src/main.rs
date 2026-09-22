use base64::{engine::general_purpose::STANDARD, Engine};
use mail_parser::{Message, MessageParser, MimeHeaders, PartType};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

const RAW_LIMIT: usize = 4 * 1024 * 1024;
const DECODED_LIMIT: usize = 8 * 1024 * 1024;

// A short-lived, stdin/stdout-only parser. No paths, URLs, credentials, or network
// operations enter this process. The parent also imposes a wall-clock/output limit.
fn limits() -> Result<(), &'static str> {
    #[cfg(unix)]
    unsafe {
        let cpu = libc::rlimit {
            rlim_cur: 3,
            rlim_max: 3,
        };
        if libc::setrlimit(libc::RLIMIT_CPU, &cpu) != 0 {
            return Err("resource-limit");
        }
        #[cfg(target_os = "linux")]
        {
            let memory = libc::rlimit {
                rlim_cur: 512 * 1024 * 1024,
                rlim_max: 512 * 1024 * 1024,
            };
            if libc::setrlimit(libc::RLIMIT_AS, &memory) != 0 {
                return Err("resource-limit");
            }
        }
    }
    Ok(())
}

fn filename(original: Option<&str>, path: &str, plain: bool) -> String {
    let value: String = original
        .unwrap_or("")
        .chars()
        .filter(|c| {
            !c.is_control()
                && !"/\\:\u{202a}\u{202b}\u{202c}\u{202d}\u{202e}\u{2066}\u{2067}\u{2068}\u{2069}"
                    .contains(*c)
        })
        .take(120)
        .collect();
    let value = value.trim().trim_matches('.');
    if value.is_empty() {
        format!("part-{path}.{}", if plain { "txt" } else { "bin" })
    } else {
        value.to_string()
    }
}

fn visit(
    message: &Message<'_>,
    id: usize,
    path: String,
    depth: usize,
    raw: &[u8],
    parts: &mut Vec<Value>,
    files: &mut Vec<Value>,
    total: &mut usize,
) -> Result<(), &'static str> {
    if depth > 16 || parts.len() >= 128 {
        return Err("part-limit");
    }
    let p = message.parts.get(id).ok_or("invalid-part")?;
    let (start, body, end) = (
        p.offset_header as usize,
        p.offset_body as usize,
        p.offset_end as usize,
    );
    if start > body || body > end || end > raw.len() {
        return Err("invalid-range");
    }
    if body - start > 32768 || p.headers.len() > 128 {
        return Err("header-limit");
    }
    let ct = p.content_type();
    let media = ct
        .map(|c| format!("{}/{}", c.ctype(), c.subtype().unwrap_or("octet-stream")))
        .unwrap_or_else(|| "text/plain".into())
        .to_ascii_lowercase();
    if media.len() > 256 {
        return Err("header-limit");
    }
    let charset = ct
        .and_then(|c| c.attribute("charset"))
        .unwrap_or("us-ascii")
        .to_ascii_lowercase();
    let transfer = p
        .content_transfer_encoding()
        .unwrap_or("7bit")
        .to_ascii_lowercase();
    if charset.len() > 128 || transfer.len() > 128 {
        return Err("header-limit");
    }
    let mut part = json!({"path": path, "headerStart": start, "bodyStart": body, "end": end,
        "mediaType": media, "charset": charset, "transferEncoding": transfer,
        "outcome": "unsupported", "reason": "media-type", "fileIndex": null});
    match &p.body {
        PartType::Multipart(children) => {
            part["outcome"] = json!("container");
            part["reason"] = json!("multipart");
            parts.push(part);
            for (n, child) in children.iter().enumerate() {
                visit(
                    message,
                    *child as usize,
                    format!("{path}.{}", n + 1),
                    depth + 1,
                    raw,
                    parts,
                    files,
                    total,
                )?;
            }
            return Ok(());
        }
        // Nested messages are retained in the original. Do not assign their decoded
        // offsets to the outer raw bytes or invent a direct evidence range.
        PartType::Message(_) => part["reason"] = json!("nested-message"),
        _ if p.is_encoding_problem => part["reason"] = json!("invalid-encoding"),
        _ if !["7bit", "8bit", "binary", "base64", "quoted-printable"]
            .contains(&transfer.as_str()) =>
        {
            part["reason"] = json!("transfer-encoding")
        }
        _ => {
            let text = p.is_text();
            let charset_supported = [
                "utf-8",
                "utf8",
                "us-ascii",
                "ascii",
                "iso-8859-1",
                "windows-1252",
            ]
            .contains(&charset.as_str());
            let supported = media == "text/plain"
                || media == "application/pdf"
                || media == "application/json"
                || media == "text/csv"
                || media == "image/png"
                || media == "image/jpeg";
            if text
                && (!charset_supported
                    || p.text_contents().is_some_and(|s| {
                        s.contains('\u{fffd}')
                            || (["us-ascii", "ascii"].contains(&charset.as_str()) && !s.is_ascii())
                    }))
            {
                part["reason"] = json!("charset");
            } else if supported {
                let content = p.contents();
                *total += content.len();
                if *total > DECODED_LIMIT {
                    return Err("decoded-limit");
                }
                if !content.is_empty() {
                    part["outcome"] = json!("materialized");
                    part["reason"] = json!("decoded");
                    part["fileIndex"] = json!(files.len());
                    files.push(json!({"name": filename(p.attachment_name(), &path, text),
                        "mediaType": if text { format!("{media}; charset=utf-8") } else { media },
                        "byteLength": content.len(), "sha256": format!("{:x}", Sha256::digest(content)),
                        "base64": STANDARD.encode(content)}));
                } else {
                    part["reason"] = json!("empty");
                }
            }
        }
    }
    parts.push(part);
    Ok(())
}

fn parse(raw: &[u8]) -> Result<Value, &'static str> {
    if raw.len() > RAW_LIMIT {
        return Err("raw-limit");
    }
    let message = MessageParser::default().parse(raw).ok_or("malformed")?;
    let mut parts = vec![];
    let mut files = vec![];
    let mut total = 0;
    visit(
        &message,
        0,
        "1".into(),
        0,
        raw,
        &mut parts,
        &mut files,
        &mut total,
    )?;
    Ok(
        json!({"parser": "mail-parser/0.11.9", "profile": "bounded-mail-v1",
        "outcome": "inspected", "reason": null,
        "subject": message.subject().unwrap_or("").chars().take(2048).collect::<String>(),
        "parts": parts, "files": files}),
    )
}

fn main() {
    let result = limits()
        .and_then(|_| {
            let mut raw = vec![];
            std::io::stdin()
                .take((RAW_LIMIT + 1) as u64)
                .read_to_end(&mut raw)
                .map_err(|_| "input")?;
            parse(&raw)
        })
        .unwrap_or_else(|reason| {
            json!({"parser": "mail-parser/0.11.9", "profile": "bounded-mail-v1",
        "outcome": "unavailable", "reason": reason, "subject": "", "parts": [], "files": []})
        });
    let _ = std::io::stdout().write_all(result.to_string().as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decodes_and_retains_exact_source_ranges() {
        let raw = b"MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=flower\r\n\r\n--flower\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nRoses =3D 17\r\n--flower\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=../../garden.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--flower--\r\n";
        let value = parse(raw).unwrap();
        assert_eq!(value["files"].as_array().unwrap().len(), 2);
        assert_eq!(
            STANDARD
                .decode(value["files"][0]["base64"].as_str().unwrap())
                .unwrap(),
            b"Roses = 17"
        );
        assert_eq!(
            STANDARD
                .decode(value["files"][1]["base64"].as_str().unwrap())
                .unwrap(),
            b"%PDF-1.4\n"
        );
        for part in value["parts"].as_array().unwrap().iter().skip(1) {
            let a = part["bodyStart"].as_u64().unwrap() as usize;
            let b = part["end"].as_u64().unwrap() as usize;
            assert!(!raw[a..b].is_empty());
        }
        assert!(!value["files"][1]["name"].as_str().unwrap().contains('/'));
    }
    #[test]
    fn unsupported_html_and_malformed_do_not_become_files() {
        assert_eq!(
            parse(b"Content-Type: text/html\r\n\r\n<script>fetch('https://example.test')</script>")
                .unwrap()["files"],
            json!([])
        );
        assert_eq!(parse(b"not mail").unwrap()["files"], json!([]));
        assert_eq!(parse(&vec![b'x'; RAW_LIMIT + 1]).unwrap_err(), "raw-limit");
    }

    #[test]
    fn charset_conversion_is_explicit_and_invalid_ascii_is_not_silently_repaired() {
        let value = parse(b"Content-Type: text/plain; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCr=E8me").unwrap();
        assert_eq!(
            STANDARD
                .decode(value["files"][0]["base64"].as_str().unwrap())
                .unwrap(),
            "Crème".as_bytes()
        );
        let invalid =
            parse("Content-Type: text/plain; charset=us-ascii\r\n\r\nCrème".as_bytes()).unwrap();
        assert_eq!(invalid["files"], json!([]));
        assert_eq!(invalid["parts"][0]["reason"], "charset");
    }

    #[test]
    fn nested_messages_do_not_get_false_outer_source_locations() {
        let value = parse(b"Content-Type: message/rfc822\r\n\r\nSubject: Inner\r\nContent-Type: text/plain\r\n\r\nNested note").unwrap();
        assert_eq!(value["files"], json!([]));
        assert_eq!(value["parts"][0]["reason"], "nested-message");
    }

    #[test]
    fn oversized_headers_and_many_parts_fail_without_partial_file_results() {
        let header = format!(
            "X-Long: {}\r\nContent-Type: text/plain\r\n\r\nNote",
            "a".repeat(33000)
        );
        assert_eq!(parse(header.as_bytes()).unwrap_err(), "header-limit");
        let many = format!(
            "Content-Type: multipart/mixed; boundary=petal\r\n\r\n{}--petal--\r\n",
            "--petal\r\nContent-Type: text/plain\r\n\r\nPetal\r\n".repeat(129)
        );
        assert_eq!(parse(many.as_bytes()).unwrap_err(), "part-limit");
    }
}
