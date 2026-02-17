use serde_json::Value;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT, CONTENT_TYPE};

#[derive(Debug, Clone, Copy)]
pub enum ClientType {
    Web,
    Android,
}

pub struct YouTubeClient {
    client: reqwest::Client,
    client_type: ClientType,
}

impl YouTubeClient {
    pub fn new(client_type: ClientType) -> Self {
        Self {
            client: reqwest::Client::new(),
            client_type,
        }
    }

    fn get_context(&self) -> Value {
        match self.client_type {
            ClientType::Web => {
                serde_json::json!({
                    "context": {
                        "client": {
                            "clientName": "WEB",
                            "clientVersion": "2.20230301.09.00",
                            "hl": "en",
                            "gl": "US",
                            "utcOffsetMinutes": 0,
                        }
                    }
                })
            }
            ClientType::Android => {
                serde_json::json!({
                    "context": {
                        "client": {
                            "clientName": "ANDROID",
                            "clientVersion": "19.05.36",
                            "hl": "en",
                            "gl": "US",
                            "utcOffsetMinutes": 0,
                            "androidSdkVersion": 34,
                        }
                    }
                })
            }
        }
    }

    fn get_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let ua = match self.client_type {
            ClientType::Web => "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            ClientType::Android => "com.google.android.youtube/19.05.36 (Linux; U; Android 14; en_US) gzip",
        };
        headers.insert(USER_AGENT, HeaderValue::from_str(ua).unwrap());
        headers
    }

    pub async fn search(&self, query: &str) -> Result<Value, String> {
        let mut body = self.get_context();
        body["query"] = serde_json::json!(query);

        let res = self.client.post("https://www.youtube.com/youtubei/v1/search")
            .headers(self.get_headers())
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        res.json::<Value>().await.map_err(|e| e.to_string())
    }

    pub async fn browse(&self, browse_id: Option<String>, continuation: Option<String>) -> Result<Value, String> {
        let mut body = self.get_context();
        if let Some(id) = browse_id {
            body["browseId"] = serde_json::json!(id);
        }
        if let Some(c) = continuation {
            body["continuation"] = serde_json::json!(c);
        }

        let res = self.client.post("https://www.youtube.com/youtubei/v1/browse")
            .headers(self.get_headers())
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        res.json::<Value>().await.map_err(|e| e.to_string())
    }

    pub async fn player(&self, video_id: &str) -> Result<Value, String> {
        let mut body = self.get_context();
        body["videoId"] = serde_json::json!(video_id);

        let res = self.client.post("https://www.youtube.com/youtubei/v1/player")
            .headers(self.get_headers())
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        res.json::<Value>().await.map_err(|e| e.to_string())
    }
}

pub fn extract_video_id(url_or_id: &str) -> String {
    if url_or_id.contains("v=") {
        let parts: Vec<&str> = url_or_id.split("v=").collect();
        if parts.len() > 1 {
            return parts[1].split('&').next().unwrap_or("").to_string();
        }
    }
    url_or_id.to_string()
}

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
    
    // Try multiple regex patterns for channel ID
    let patterns = [
        r#""channelId":"(UC[^"]+)""#,
        r#"meta property="og:url" content="https://www.youtube.com/channel/(UC[^"]+)""#,
        r#"link rel="canonical" href="https://www.youtube.com/channel/(UC[^"]+)""#,
    ];

    for pattern in patterns {
        let re = regex::Regex::new(pattern).unwrap();
        if let Some(caps) = re.captures(&text) {
            return Ok(Some(caps.get(1).unwrap().as_str().to_string()));
        }
    }

    Ok(None)
}

pub fn channel_id_to_uploads_playlist(channel_id: &str) -> String {
    if channel_id.starts_with("UC") {
        return format!("UU{}", &channel_id[2..]);
    }
    channel_id.to_string()
}

pub async fn fetch_transcript(player_json: &Value) -> Result<Option<String>, String> {
    let captions = &player_json["captions"];
    let caption_tracks = captions["playerCaptionsTracklistRenderer"]["captionTracks"].as_array();
    
    if let Some(tracks) = caption_tracks {
        let track = tracks.iter()
            .find(|t| t["languageCode"].as_str().unwrap_or("").starts_with("en"))
            .or_else(|| tracks.first());

        if let Some(track) = track {
            let base_url = track["baseUrl"].as_str().ok_or("No base URL for transcript")?;
            
            // Build headers for the transcript request (important for some formats)
            let mut headers = HeaderMap::new();
            headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"));
            
            let client = reqwest::Client::new();
            let res = client.get(base_url)
                .headers(headers)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let text = res.text().await.map_err(|e| e.to_string())?;

            if text.trim().starts_with('{') {
                // JSON format (json3 / events)
                let data: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
                let mut lines: Vec<String> = Vec::new();
                
                // Optimized segment collection for json3 format
                if let Some(events) = data["events"].as_array() {
                    for event in events {
                        if let Some(segs) = event["segs"].as_array() {
                            let line: String = segs.iter()
                                .map(|s| s["utf8"].as_str().unwrap_or(""))
                                .collect::<Vec<_>>()
                                .join("");
                            if !line.trim().is_empty() {
                                lines.push(line);
                            }
                        }
                    }
                }
                
                if lines.is_empty() {
                    collect_transcript_lines(&data, &mut lines);
                }
                
                return Ok(Some(lines.join("\n")));
            } else {
                // XML format
                return parse_xml_transcript(&text);
            }
        }
    }
    Ok(None)
}

fn collect_transcript_lines(val: &Value, lines: &mut Vec<String>) {
    if let Some(obj) = val.as_object() {
        // Handle "text" and "utf8" (for segments)
        if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
            lines.push(text.to_string());
        } else if let Some(utf8) = obj.get("utf8").and_then(|t| t.as_str()) {
             // In events/segs format, we might want to join segments, but for simplicity:
             lines.push(utf8.to_string());
        }
        
        // Some formats have "simpleText"
        if let Some(st) = obj.get("simpleText").and_then(|t| t.as_str()) {
            lines.push(st.to_string());
        }

        for v in obj.values() {
            collect_transcript_lines(v, lines);
        }
    } else if let Some(arr) = val.as_array() {
        for v in arr {
            collect_transcript_lines(v, lines);
        }
    }
}

fn parse_xml_transcript(xml: &str) -> Result<Option<String>, String> {
    let mut lines = Vec::new();
    let mut reader = quick_xml::Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut current_line = Vec::new();
    let mut in_p = false;
    let mut in_s = false;
    let mut in_text = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(quick_xml::events::Event::Start(ref e)) => {
                match e.name().as_ref() {
                    b"p" => {
                        in_p = true;
                        current_line.clear();
                    }
                    b"s" => in_s = true,
                    b"text" => {
                        in_text = true;
                        current_line.clear();
                    }
                    _ => {}
                }
            }
            Ok(quick_xml::events::Event::Text(e)) => {
                if in_s || in_text || (in_p && !xml.contains("</s>")) { 
                     let text = e.unescape().map_err(|e| e.to_string())?;
                     current_line.push(text.into_owned());
                }
            }
            Ok(quick_xml::events::Event::End(ref e)) => {
                match e.name().as_ref() {
                    b"p" => {
                        in_p = false;
                        if !current_line.is_empty() {
                            lines.push(current_line.iter().map(|s| s.trim()).collect::<Vec<_>>().join(" "));
                        }
                    }
                    b"s" => in_s = false,
                    b"text" => {
                        in_text = false;
                        if !current_line.is_empty() {
                            lines.push(current_line.join(" "));
                        }
                    }
                    _ => {}
                }
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(e) => return Err(e.to_string()),
            _ => {}
        }
        buf.clear();
    }

    if lines.is_empty() {
        Ok(None)
    } else {
        Ok(Some(lines.join("\n")))
    }
}

pub fn extract_video_basic_info(renderer: &Value) -> Option<Value> {
    let video_id = renderer["videoId"].as_str()?;
    let title = renderer["title"]["runs"][0]["text"].as_str().unwrap_or("Unknown");
    
    let thumbs = renderer["thumbnail"]["thumbnails"].as_array();
    let thumbnail = thumbs.and_then(|t| t.last())
        .and_then(|t| t["url"].as_str())
        .unwrap_or("");
    
    let published_text = renderer["publishedTimeText"]["simpleText"].as_str().unwrap_or("");
    
    let mut view_count_text = renderer["viewCountText"]["simpleText"].as_str().unwrap_or("").to_string();
    if view_count_text.is_empty() {
        if let Some(runs) = renderer["viewCountText"]["runs"].as_array() {
            view_count_text = runs.iter().map(|r| r["text"].as_str().unwrap_or("")).collect::<String>();
        }
    }

    let owner_text = renderer["ownerText"]["runs"][0]["text"].as_str().unwrap_or("");

    Some(serde_json::json!({
        "id": video_id,
        "title": title,
        "thumbnail": thumbnail,
        "publishedAt": published_text,
        "viewCount": view_count_text,
        "author": owner_text
    }))
}

pub fn extract_playlist_video_info(renderer: &Value) -> Option<Value> {
    let video_id = renderer["videoId"].as_str()?;
    let title = renderer["title"]["runs"][0]["text"].as_str().unwrap_or("Unknown");
    
    let thumbs = renderer["thumbnail"]["thumbnails"].as_array();
    let thumbnail = thumbs.and_then(|t| t.last())
        .and_then(|t| t["url"].as_str())
        .unwrap_or("");
    
    let owner_text = renderer["shortBylineText"]["runs"][0]["text"].as_str().unwrap_or("");

    Some(serde_json::json!({
        "id": video_id,
        "title": title,
        "thumbnail": thumbnail,
        "publishedAt": "",
        "viewCount": "",
        "author": owner_text
    }))
}
