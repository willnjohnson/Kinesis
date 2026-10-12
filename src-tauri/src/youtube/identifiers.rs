use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};

pub fn extract_playlist_id(url_or_id: &str) -> String {
    if url_or_id.contains("list=") {
        let parts: Vec<&str> = url_or_id.split("list=").collect();
        if parts.len() > 1 {
            return parts[1].split('&').next().unwrap_or("").to_string();
        }
    }
    url_or_id.to_string()
}

pub async fn extract_channel_id(url_or_handle: &str) -> Result<Option<String>, String> {
    if url_or_handle.starts_with("UC") && url_or_handle.len() == 24 {
        return Ok(Some(url_or_handle.to_string()));
    }

    if url_or_handle.contains("youtube.com/channel/") {
        let parts: Vec<&str> = url_or_handle.split("youtube.com/channel/").collect();
        if parts.len() > 1 {
            return Ok(Some(parts[1].split('/').next().unwrap_or("").split('?').next().unwrap_or("").to_string()));
        }
    }

    let mut handle = url_or_handle.to_string();
    if url_or_handle.contains("youtube.com/@") {
        let parts: Vec<&str> = url_or_handle.split("youtube.com/@").collect();
        if parts.len() > 1 {
            handle = parts[1].split('/').next().unwrap_or("").split('?').next().unwrap_or("").to_string();
        }
    } else if url_or_handle.starts_with('@') {
        handle = url_or_handle[1..].to_string();
    } else if url_or_handle.contains("youtube.com/c/") {
        let parts: Vec<&str> = url_or_handle.split("youtube.com/c/").collect();
        if parts.len() > 1 {
            handle = parts[1].split('/').next().unwrap_or("").split('?').next().unwrap_or("").to_string();
        }
    }

    let client = reqwest::Client::new();
    let url = format!("https://www.youtube.com/@{}", handle);
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"));
    headers.insert(reqwest::header::ACCEPT, HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"));
    headers.insert(reqwest::header::ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));

    let res = client.get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = res.text().await.map_err(|e| e.to_string())?;

    // Try multiple regex patterns for channel ID, prioritizing canonical and meta tags
    let patterns = [
        r#"<meta itemprop="identifier" content="(UC[^"]+)">"#,
        r#"link rel="canonical" href="https://www.youtube.com/channel/(UC[^"]+)""#,
        r#"meta property="og:url" content="https://www.youtube.com/channel/(UC[^"]+)""#,
        r#""channelId":"(UC[^"]+)""#,
    ];

    for pattern in patterns {
        let re = regex::Regex::new(pattern).unwrap();
        if let Some(caps) = re.captures(&text) {
            return Ok(Some(caps.get(1).unwrap().as_str().to_string()));
        }
    }

    Ok(None)
}

/// A channel's regular videos (no Shorts, no live streams) as a playlist id: "UULF" plus the channel
/// id without its "UC". This is the playlist YouTube itself lists a channel's Videos tab from; the
/// older "all uploads" one ("UU") now answers anonymous requests with a server error.
pub fn channel_id_to_uploads_playlist(channel_id: &str) -> String {
    if channel_id.starts_with("UC") {
        return format!("UULF{}", &channel_id[2..]);
    }
    channel_id.to_string()
}

/// Extract YouTube handle from text like "Channel Name (@handle)"
pub(crate) fn extract_handle_from_text(text: &str) -> Option<String> {
    if let Some(at_pos) = text.find("(@") {
        let handle_part = &text[at_pos..];
        // Find the end of the handle (could be at end of string or before another parenthesis)
        let end = handle_part.find(')').unwrap_or(handle_part.len());
        let handle = &handle_part[1..end]; // Skip the '@' character
        if !handle.is_empty() {
            return Some(format!("@{}", handle));
        }
    }
    None
}

/// What a channel calls itself now: its @handle and name, by its channel ID (which never changes, unlike both of these).
/// Asked of YouTube's own page-data endpoint (the one the app lists a channel's videos from), so no API key is needed.
/// None when the answer doesn't say (no handle, an error) — the caller then leaves what it has alone. With them, the
/// channel's subscriber count as that same page shows it (parse_channel_subscribers), when it shows one.
pub async fn fetch_channel_identity(channel_id: &str) -> Result<Option<(String, String, Option<i64>)>, String> {
    if !channel_id.starts_with("UC") || channel_id.len() != 24 {
        return Ok(None);
    }
    let data = super::YouTubeClient::new(super::ClientType::Web).browse(Some(channel_id.to_string()), None).await?;
    Ok(parse_channel_identity(&data, channel_id).map(|(handle, name)| (handle, name, parse_channel_subscribers(&data))))
}

/// A channel's subscriber count, from the line under its name in its page's header ("2.68M subscribers", among the
/// header's metadata rows; asked for in English, see YouTubeClient's context). It's the rounded figure the page shows
/// (three figures: 2.68M is 2,680,000), which is as exact as YouTube gives anyone, its Data API included. None when
/// the header has no such line: a channel that hides its count, or a page laid out some other way.
pub(crate) fn parse_channel_subscribers(data: &serde_json::Value) -> Option<i64> {
    let rows = data["header"]["pageHeaderRenderer"]["content"]["pageHeaderViewModel"]["metadata"]["contentMetadataViewModel"]["metadataRows"].as_array()?;
    rows.iter()
        .filter_map(|row| row["metadataParts"].as_array())
        .flatten()
        .filter_map(|part| part["text"]["content"].as_str())
        .find_map(subscribers_in)
}

/// The number in "2.68M subscribers" (or "915K", "1.2B", "843", "1 subscriber"); None for any other text.
fn subscribers_in(text: &str) -> Option<i64> {
    let re = regex::Regex::new(r"^\s*([0-9][0-9.,]*)\s*([KMB]?)\s+subscribers?\s*$").unwrap();
    let found = re.captures(text)?;
    let number: f64 = found[1].replace(',', "").parse().ok()?;
    let scale = match &found[2] {
        "K" => 1e3,
        "M" => 1e6,
        "B" => 1e9,
        _ => 1.0,
    };
    Some((number * scale).round() as i64)
}

/// The handle and name in a channel's browse response (see fetch_channel_identity): its `channelMetadataRenderer`'s
/// title, and the handle from its vanity URL, else from the page header's link to itself. The response must be this
/// channel's own (its externalId matches), so some other page is never taken for a rename.
pub(crate) fn parse_channel_identity(data: &serde_json::Value, channel_id: &str) -> Option<(String, String)> {
    let meta = &data["metadata"]["channelMetadataRenderer"];
    if meta["externalId"].as_str() != Some(channel_id) {
        return None;
    }
    let name = meta["title"].as_str()?.trim().to_string();
    if name.is_empty() {
        return None;
    }
    let from_vanity = meta["vanityChannelUrl"].as_str().and_then(|u| u.split("/@").nth(1)).map(|h| h.split(['/', '?']).next().unwrap_or("").to_string());
    let handle = from_vanity.filter(|h| !h.is_empty()).or_else(|| {
        // The header links to the channel by its handle ("canonicalBaseUrl":"/@IHMC").
        let header = data["header"].to_string();
        let re = regex::Regex::new(r#""canonicalBaseUrl":"/@([^"/?]+)""#).unwrap();
        re.captures(&header).map(|c| c[1].to_string())
    })?;
    // A handle with letters outside ASCII can come percent-encoded.
    let handle = urlencoding::decode(&handle).map(|h| h.into_owned()).unwrap_or(handle);
    Some((format!("@{handle}"), name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ID: &str = "UCabcdefghijklmnopqrstuv";

    #[test]
    fn reads_handle_and_name_from_the_channel_metadata() {
        let data = json!({ "metadata": { "channelMetadataRenderer": {
            "externalId": ID, "title": "TheIHMC & Friends", "vanityChannelUrl": "http://www.youtube.com/@IHMC"
        } } });
        assert_eq!(parse_channel_identity(&data, ID), Some(("@IHMC".into(), "TheIHMC & Friends".into())));
        // No vanity URL: the header's link to the channel.
        let data = json!({
            "metadata": { "channelMetadataRenderer": { "externalId": ID, "title": "Name" } },
            "header": { "pageHeaderRenderer": { "x": { "canonicalBaseUrl": "/@New%C3%A9" } } }
        });
        assert_eq!(parse_channel_identity(&data, ID), Some(("@Newé".into(), "Name".into())));
    }

    /// Against YouTube itself (needs the network, so not in the normal run): `cargo test --lib live_channel -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_channel_identity() {
        let found = fetch_channel_identity("UC_x5XG1OV2P6uZZ5FSM9Ttw").await.unwrap();
        println!("live: {found:?}");
        assert!(found.is_some_and(|(handle, name, subscribers)| handle.starts_with('@') && !name.is_empty() && subscribers.is_some_and(|n| n > 0)));
    }

    #[test]
    fn reads_the_subscriber_count_from_the_header() {
        // The shape of a real answer (the header's rows: the handle, then subscribers and videos).
        let header = |text: &str| json!({ "header": { "pageHeaderRenderer": { "content": { "pageHeaderViewModel": { "metadata": { "contentMetadataViewModel": { "metadataRows": [
            { "metadataParts": [{ "text": { "content": "@GoogleDevelopers" } }] },
            { "metadataParts": [{ "text": { "content": text }, "accessibilityLabel": "x" }, { "text": { "content": "6.9K videos" } }] },
        ] } } } } } } });
        assert_eq!(parse_channel_subscribers(&header("2.68M subscribers")), Some(2_680_000));
        assert_eq!(parse_channel_subscribers(&header("915K subscribers")), Some(915_000));
        assert_eq!(parse_channel_subscribers(&header("1.2B subscribers")), Some(1_200_000_000));
        assert_eq!(parse_channel_subscribers(&header("843 subscribers")), Some(843));
        assert_eq!(parse_channel_subscribers(&header("1 subscriber")), Some(1));
        // A channel that hides its count has no such line; nor does a page with another layout.
        assert_eq!(parse_channel_subscribers(&header("6.9K videos")), None);
        assert_eq!(parse_channel_subscribers(&json!({ "header": {} })), None);
    }

    /// What the player endpoint says about a removed video and a normal one (needs the network; prints only).
    #[tokio::test]
    #[ignore]
    async fn live_player_status() {
        for id in ["Q9Th3wDpr_g", "dQw4w9WgXcQ", "aaaaaaaaaaa"] {
            let data = super::super::YouTubeClient::new(super::super::ClientType::Web).player(id).await.unwrap();
            println!(
                "live {id}: status={} reason={} title={}",
                data["playabilityStatus"]["status"], data["playabilityStatus"]["reason"], data["videoDetails"]["title"]
            );
        }
    }

    #[test]
    fn another_channel_or_no_handle_says_nothing() {
        let other = json!({ "metadata": { "channelMetadataRenderer": { "externalId": "UCzzzzzzzzzzzzzzzzzzzzzz", "title": "X", "vanityChannelUrl": "http://www.youtube.com/@X" } } });
        assert_eq!(parse_channel_identity(&other, ID), None);
        let no_handle = json!({ "metadata": { "channelMetadataRenderer": { "externalId": ID, "title": "X" } } });
        assert_eq!(parse_channel_identity(&no_handle, ID), None);
    }
}

pub async fn extract_handle_from_channel_id(channel_id: &str) -> Result<Option<String>, String> {
    if !channel_id.starts_with("UC") || channel_id.len() != 24 {
        return Ok(None);
    }

    let client = reqwest::Client::new();
    let url = format!("https://www.youtube.com/channel/{}", channel_id);
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"));
    headers.insert(reqwest::header::ACCEPT, HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7"));
    headers.insert(reqwest::header::ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));

    let res = client.get(url)
        .headers(headers)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = res.text().await.map_err(|e| e.to_string())?;

    // Try to find @handle in the page
    // Pattern 1: canonical URL with @handle
    let canonical_pattern = r#"link rel="canonical" href="https://www.youtube.com/(@[^""]+)"#;
    let re = regex::Regex::new(canonical_pattern).unwrap();
    if let Some(caps) = re.captures(&text) {
        return Ok(Some(caps.get(1).unwrap().as_str().to_string()));
    }

    // Pattern 2: og:url with @handle
    let og_pattern = r#"meta property="og:url" content="https://www.youtube.com/(@[^""]+)"#;
    let re = regex::Regex::new(og_pattern).unwrap();
    if let Some(caps) = re.captures(&text) {
        return Ok(Some(caps.get(1).unwrap().as_str().to_string()));
    }

    // Pattern 3: external_id in script
    let script_pattern = r#""externalId":"(UC[^"]+)"#;
    let re = regex::Regex::new(script_pattern).unwrap();
    if re.is_match(&text) {
        // This is the channel ID, not handle - return None since we couldn't find handle
        return Ok(None);
    }

    Ok(None)
}
