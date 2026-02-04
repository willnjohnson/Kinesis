use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::command;

use quick_xml::events::Event;
use quick_xml::Reader;

#[derive(Debug, Serialize, Deserialize)]
pub struct Video {
    id: String,
    title: String,
    thumbnail: String,
    #[serde(rename = "publishedAt")]
    published_at: String,
    #[serde(rename = "viewCount")]
    view_count: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelInfo {
    #[serde(rename = "channelId")]
    channel_id: String,
    #[serde(rename = "channelName")]
    channel_name: String,
}

use std::fs;
use std::path::PathBuf;

fn get_key_path() -> PathBuf {
    let paths = [
        PathBuf::from("yt.key"),
        PathBuf::from("src-tauri/yt.key"),
        PathBuf::from("../yt.key"),
    ];
    for p in paths {
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("yt.key")
}

fn get_api_key() -> String {
    fs::read_to_string(get_key_path())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

#[command]
async fn check_api_key() -> bool {
    !get_api_key().is_empty()
}

#[command]
async fn save_api_key(key: String) -> Result<(), String> {
    fs::write(get_key_path(), key.trim()).map_err(|e| e.to_string())
}

/// Resolve a YouTube handle or username to channel ID
#[command]
async fn resolve_channel(query: String) -> Result<ChannelInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let url = if query.starts_with("UC") && query.len() == 24 {
        return Ok(ChannelInfo {
            channel_id: query,
            channel_name: "Unknown".to_string(),
        });
    } else if query.starts_with('@') {
        format!("https://www.youtube.com/{}", query)
    } else if query.starts_with("http") {
        query.clone()
    } else {
        format!("https://www.youtube.com/@{}", query)
    };
    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let re_id = Regex::new(r#""channelId":"([^"]+)""#).unwrap();
    if let Some(caps) = re_id.captures(&html) {
        let channel_id = caps[1].to_string();
        let re_name = Regex::new(r#""channelName":"([^"]+)""#).unwrap();
        let channel_name = re_name
            .captures(&html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| "Unknown".to_string());
        return Ok(ChannelInfo {
            channel_id,
            channel_name,
        });
    }
    Err(format!("Could not resolve query: {}", query))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VideoResponse {
    videos: Vec<Video>,
    continuation: Option<String>,
}

/// Fetch videos from a channel or playlist
#[command]
async fn fetch_videos(
    id: String,
    is_playlist: bool,
    continuation: Option<String>,
) -> Result<VideoResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    if let Some(token) = continuation {
        return fetch_continuation(&client, token).await;
    }

    let url = if is_playlist {
        format!(
            "https://www.youtube.com/feeds/videos.xml?playlist_id={}",
            id
        )
    } else {
        format!("https://www.youtube.com/feeds/videos.xml?channel_id={}", id)
    };

    if let Ok(res) = client.get(&url).send().await {
        if let Ok(xml) = res.text().await {
            if let Ok(videos) = parse_feed(&xml) {
                // Return seed token for pagination
                let browse_token = if is_playlist {
                    Some(id.clone())
                } else {
                    Some("EgZ2aWRlb3PyBgQKAjoA".to_string())
                };
                return Ok(VideoResponse {
                    videos,
                    continuation: browse_token,
                });
            }
        }
    }

    Err("Failed to fetch videos".to_string())
}

async fn fetch_continuation(
    client: &reqwest::Client,
    token: String,
) -> Result<VideoResponse, String> {
    let url = format!(
        "https://www.youtube.com/youtubei/v1/browse?key={}",
        get_api_key()
    );

    // Determine if we are starting a fresh browse (by ID) or continuing (by token)
    let body = if token.starts_with("PL") || token.starts_with("UU") || token.starts_with("UC") {
        let browse_id = if token.starts_with("PL") {
            format!("VL{}", token)
        } else {
            token.clone()
        };
        serde_json::json!({
            "context": { "client": { "hl": "en", "gl": "US", "clientName": "WEB", "clientVersion": "2.20240327.01.00" } },
            "browseId": browse_id
        })
    } else {
        serde_json::json!({
            "context": { "client": { "hl": "en", "gl": "US", "clientName": "WEB", "clientVersion": "2.20240327.01.00" } },
            "continuation": token
        })
    };

    let res = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let mut videos = Vec::new();
    let mut next_token = None;

    // 1. Check for continuation items (Standard Load More)
    if let Some(items) = json.pointer("/onResponseReceivedActions/0/appendContinuationItemsAction/continuationItems").and_then(|v| v.as_array()) {
        parse_inner_items(items, &mut videos, &mut next_token);
    } 
    // 2. Check for initial browse items (First Load More click for playlists)
    else if let Some(items) = json.pointer("/contents/twoColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/itemSectionRenderer/contents/0/playlistVideoListRenderer/contents")
        .or_else(|| json.pointer("/contents/twoColumnBrowseResultsRenderer/tabs/1/tabRenderer/content/richGridRenderer/contents"))
        .and_then(|v| v.as_array()) {
        parse_inner_items(items, &mut videos, &mut next_token);
    }

    Ok(VideoResponse {
        videos,
        continuation: next_token,
    })
}

fn parse_inner_items(
    items: &Vec<serde_json::Value>,
    videos: &mut Vec<Video>,
    next_token: &mut Option<String>,
) {
    for item in items {
        if let Some(v) = item
            .get("richItemRenderer")
            .and_then(|i| i.get("content"))
            .and_then(|c| c.get("videoRenderer"))
            .or_else(|| item.get("videoRenderer"))
            .or_else(|| item.get("playlistVideoRenderer"))
        {
            let id = v
                .get("videoId")
                .and_then(|i| i.as_str())
                .unwrap_or_default()
                .to_string();
            if id.is_empty() {
                continue;
            }
            videos.push(Video {
                id,
                title: v
                    .pointer("/title/runs/0/text")
                    .or_else(|| v.get("title").and_then(|t| t.get("simpleText")))
                    .and_then(|t| t.as_str())
                    .unwrap_or("Unknown")
                    .to_string(),
                thumbnail: format!(
                    "https://i.ytimg.com/vi/{}/hqdefault.jpg",
                    v.get("videoId")
                        .and_then(|i| i.as_str())
                        .unwrap_or_default()
                ),
                published_at: v
                    .pointer("/publishedTimeText/simpleText")
                    .or_else(|| v.pointer("/videoInfo/runs/2/text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or_default()
                    .to_string(),
                view_count: v
                    .pointer("/viewCountText/simpleText")
                    .or_else(|| v.pointer("/videoInfo/runs/0/text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or_default()
                    .to_string(),
            });
        } else if let Some(c) = item.get("continuationItemRenderer") {
            *next_token = c
                .pointer("/continuationEndpoint/continuationCommand/token")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string());
        }
    }
}

fn parse_feed(xml: &str) -> Result<Vec<Video>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let (mut videos, mut current, mut tag, mut buf) =
        (Vec::new(), None::<Video>, String::new(), Vec::new());
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                if tag == "entry" {
                    current = Some(Video {
                        id: String::new(),
                        title: String::new(),
                        thumbnail: String::new(),
                        published_at: String::new(),
                        view_count: "0".to_string(),
                    });
                }
            }
            Ok(Event::Empty(e)) => {
                if String::from_utf8_lossy(e.name().as_ref()) == "media:thumbnail" {
                    if let Some(ref mut v) = current {
                        for a in e.attributes().flatten() {
                            if a.key.as_ref() == b"url" {
                                v.thumbnail = String::from_utf8_lossy(&a.value).to_string();
                            }
                        }
                    }
                }
            }
            Ok(Event::Text(e)) => {
                if let Some(ref mut v) = current {
                    let t = e.unescape().unwrap_or_default().to_string();
                    match tag.as_str() {
                        "yt:videoId" => v.id = t,
                        "title" => v.title = t,
                        "published" => v.published_at = t,
                        _ => {}
                    }
                }
            }
            Ok(Event::End(e)) => {
                if String::from_utf8_lossy(e.name().as_ref()) == "entry" {
                    if let Some(v) = current.take() {
                        videos.push(v);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(e.to_string()),
            _ => {}
        }
        buf.clear();
    }
    Ok(videos)
}

#[command]
async fn fetch_view_count(video_id: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let html = client
        .get(format!("https://www.youtube.com/watch?v={}", video_id))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let re = Regex::new(r#""viewCount":"(\d+)""#).unwrap();
    Ok(re
        .captures(&html)
        .map(|c| c[1].to_string())
        .unwrap_or_else(|| "0".to_string()))
}

#[command]
async fn fetch_video_info(video_id: String) -> Result<Video, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let html = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let title_re = Regex::new(r#"<meta name="title" content="([^"]+)">"#).unwrap();
    let title = title_re
        .captures(&html)
        .map(|c| c[1].to_string())
        .unwrap_or_else(|| "Unknown Title".to_string());

    let views_re = Regex::new(r#""viewCount":"(\d+)""#).unwrap();
    let view_count = views_re
        .captures(&html)
        .map(|c| c[1].to_string())
        .unwrap_or_else(|| "0".to_string());

    let pub_re = Regex::new(r#"<meta itemprop="datePublished" content="([^"]+)">"#).unwrap();
    let published_at = pub_re
        .captures(&html)
        .map(|c| c[1].to_string())
        .unwrap_or_default();

    Ok(Video {
        id: video_id.clone(),
        title,
        thumbnail: format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id),
        published_at,
        view_count,
    })
}

#[command]
async fn fetch_transcript(video_id: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
        .build().map_err(|e| e.to_string())?;

    let video_url = format!("https://www.youtube.com/watch?v={}", video_id);
    let html = client
        .get(&video_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    // Gather session metadata
    let api_key = get_api_key();
    let visitor_data = Regex::new(r#""visitorData":"([^"]+)""#)
        .unwrap()
        .captures(&html)
        .map(|c| c[1].to_string());

    // Find transcript rendering params in the HTML first
    let mut transcript_params = None;
    let re_data =
        Regex::new(r#"(?s)(?:ytInitialData|ytInitialPlayerResponse)\s*=\s*(\{.*?\});"#).unwrap();
    for cap in re_data.captures_iter(&html) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&cap[1]) {
            // Check Engagement Panels
            if let Some(panels) = json.get("engagementPanels").and_then(|p| p.as_array()) {
                for panel in panels {
                    if let Some(p) = panel
                        .get("engagementPanelSectionListRenderer")
                        .and_then(|r| r.get("content"))
                        .and_then(|c| c.get("transcriptRenderer"))
                        .and_then(|t| t.get("params"))
                        .and_then(|p| p.as_str())
                    {
                        transcript_params = Some(p.to_string());
                        break;
                    }
                }
            }
            if transcript_params.is_some() {
                break;
            }
        }
    }

    let mut client_obj = serde_json::json!({ "hl": "en", "gl": "US", "clientName": "ANDROID", "clientVersion": "19.08.35" });
    if let Some(ref vd) = visitor_data {
        client_obj.as_object_mut().unwrap().insert(
            "visitorData".to_string(),
            serde_json::Value::String(vd.clone()),
        );
    }

    // API key v1/get_transcript
    if let Some(params_raw) = transcript_params {
        if let Ok(params) = urlencoding::decode(&params_raw) {
            let body = serde_json::json!({ "context": { "client": { "hl": "en", "gl": "US", "clientName": "WEB", "clientVersion": "2.20240327.01.00" } }, "params": params.into_owned() });
            let trans_url = format!(
                "https://www.youtube.com/youtubei/v1/get_transcript?key={}",
                api_key
            );
            if let Ok(res) = client.post(&trans_url).json(&body).send().await {
                if let Ok(json) = res.json::<serde_json::Value>().await {
                    let mut segs = Vec::new();
                    recursive_find_text(&json, &mut segs);
                    if !segs.is_empty() {
                        return Ok(segs.join(" ").replace("\u{a0}", " "));
                    }
                }
            }
        }
    }

    // Discovery via v1/player
    let player_url = format!(
        "https://www.youtube.com/youtubei/v1/player?key={}",
        api_key
    );
    let player_body =
        serde_json::json!({ "context": { "client": client_obj }, "videoId": video_id });
    if let Ok(res) = client.post(&player_url).json(&player_body).send().await {
        if let Ok(json) = res.json::<serde_json::Value>().await {
            if let Some(tracks) = json
                .get("captions")
                .and_then(|c| c.get("playerCaptionsTracklistRenderer"))
                .and_then(|t| t.get("captionTracks"))
                .and_then(|t| t.as_array())
            {
                // Pick the best English track
                let track = tracks
                    .iter()
                    .find(|t| t.get("languageCode").and_then(|l| l.as_str()) == Some("en"))
                    .or_else(|| {
                        tracks.iter().find(|t| {
                            t.get("languageCode")
                                .and_then(|l| l.as_str())
                                .map(|s| s.starts_with("en"))
                                .unwrap_or(false)
                        })
                    })
                    .or_else(|| tracks.first());

                if let Some(t) = track {
                    if let Some(base_url) = t.get("baseUrl").and_then(|u| u.as_str()) {
                        if let Ok(res) = client
                            .get(base_url)
                            .header("Referer", &video_url)
                            .send()
                            .await
                        {
                            if let Ok(body) = res.text().await {
                                let mut segs = Vec::new();
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                                    recursive_find_text(&json, &mut segs);
                                } else {
                                    for c in Regex::new(r">([^<]+)<").unwrap().captures_iter(&body)
                                    {
                                        let t = c[1].trim();
                                        if !t.is_empty() && !t.starts_with("<?xml") {
                                            segs.push(t.to_string());
                                        }
                                    }
                                }
                                if !segs.is_empty() {
                                    return Ok(segs.join(" ").replace("\u{a0}", " "));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Err("Transcript not available for this video or restricted by YouTube.".to_string())
}

fn recursive_find_text(json: &serde_json::Value, results: &mut Vec<String>) {
    match json {
        serde_json::Value::Object(map) => {
            if let Some(t) = map.get("text").and_then(|v| v.as_str()) {
                results.push(t.to_string());
            } else if let Some(runs) = map.get("runs").and_then(|v| v.as_array()) {
                for run in runs {
                    if let Some(t) = run.get("text").and_then(|v| v.as_str()) {
                        results.push(t.to_string());
                    }
                }
            } else if let Some(st) = map.get("simpleText").and_then(|v| v.as_str()) {
                results.push(st.to_string());
            } else {
                for value in map.values() {
                    recursive_find_text(value, results);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for value in arr {
                recursive_find_text(value, results);
            }
        }
        _ => {}
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_openurl::init())
        .invoke_handler(tauri::generate_handler![
            resolve_channel,
            fetch_videos,
            fetch_view_count,
            fetch_transcript,
            fetch_video_info,
            check_api_key,
            save_api_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
