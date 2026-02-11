#!/usr/bin/env python3
"""
Kinesis-CLI: Fetch YouTube transcript

Supports searching, listing channel videos and playlist, fetching transcripts, and fetching basic video metadata.
"""

import argparse
import sys
import json
import requests
import xml.etree.ElementTree as ET
from typing import List, Optional, Dict, Any, Union
from innertube import InnerTube

# -------------------------
# Configuration
# -------------------------
WEB_CLIENT = InnerTube("WEB")       # For search and metadata
ANDROID_CLIENT = InnerTube("ANDROID")  # For player/transcript data

REQUEST_TIMEOUT = 30  # seconds

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/121.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}


# -------------------------
# Helpers
# -------------------------
def extract_video_id(url_or_id: str) -> str:
    """
    Extract the YouTube video ID from a full URL or raw ID.
    """
    if "v=" in url_or_id:
        return url_or_id.split("v=")[1].split("&")[0]
    return url_or_id


def extract_playlist_id(url_or_id: str) -> str:
    """
    Extract the YouTube playlist ID from a full URL or raw ID.
    """
    if "list=" in url_or_id:
        return url_or_id.split("list=")[1].split("&")[0]
    return url_or_id


def extract_channel_id(url_or_handle: str) -> Optional[str]:
    """
    Extract or resolve channel ID from URL, handle (@username), or channel ID.
    Returns the channel ID (UC...) or None if not found.
    """
    # Already a channel ID
    if url_or_handle.startswith("UC") and len(url_or_handle) == 24:
        return url_or_handle
    
    # Extract from URL
    if "youtube.com/channel/" in url_or_handle:
        return url_or_handle.split("youtube.com/channel/")[1].split("/")[0].split("?")[0]
    
    # Handle (@username) or URL with handle
    handle = url_or_handle
    if "youtube.com/@" in url_or_handle:
        handle = url_or_handle.split("youtube.com/@")[1].split("/")[0].split("?")[0]
    elif url_or_handle.startswith("@"):
        handle = url_or_handle[1:]
    elif "youtube.com/c/" in url_or_handle:
        handle = url_or_handle.split("youtube.com/c/")[1].split("/")[0].split("?")[0]
    elif "youtube.com/" in url_or_handle and "/channel/" not in url_or_handle:
        # Legacy username URL
        handle = url_or_handle.split("youtube.com/")[1].split("/")[0].split("?")[0]
    
    # Resolve handle to channel ID
    try:
        url = f"https://www.youtube.com/@{handle}"
        response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        
        # Extract channel ID from HTML
        import re
        match = re.search(r'"channelId":"(UC[^"]+)"', response.text)
        if match:
            return match.group(1)
    except Exception as e:
        print(f"Failed to resolve channel: {e}", file=sys.stderr)
    
    return None


def channel_id_to_uploads_playlist(channel_id: str) -> str:
    """
    Convert channel ID (UC...) to uploads playlist ID (UU...).
    """
    if channel_id.startswith("UC"):
        return "UU" + channel_id[2:]
    return channel_id


def extract_transcript(player_json: Dict[str, Any]) -> Optional[List[str]]:
    """
    Extract transcript lines from Innertube player JSON.
    Returns a list of lines, or None if unavailable.
    """
    captions = player_json.get("captions", {})
    caption_tracks = (
        captions.get("playerCaptionsTracklistRenderer", {}).get("captionTracks", [])
    )
    if not caption_tracks:
        return None

    # Prefer English captions
    en_tracks = [t for t in caption_tracks if t.get("languageCode", "").startswith("en")]
    track = en_tracks[0] if en_tracks else caption_tracks[0]

    base_url = track.get("baseUrl")
    if not base_url:
        return None

    try:
        response = requests.get(base_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
    except requests.exceptions.Timeout:
        print("Request timed out. YouTube may be rate limiting.", file=sys.stderr)
        return None
    except requests.exceptions.RequestException as e:
        print(f"Request failed: {e}", file=sys.stderr)
        return None

    lines: List[str] = []

    # Attempt JSON parsing first
    try:
        data = json.loads(response.text)

        def _collect_text(obj: Any):
            if isinstance(obj, dict):
                text = obj.get("text")
                if isinstance(text, str):
                    lines.append(text)
                for value in obj.values():
                    _collect_text(value)
            elif isinstance(obj, list):
                for item in obj:
                    _collect_text(item)

        _collect_text(data)
        if lines:
            return lines
    except (json.JSONDecodeError, ValueError):
        pass

    # Attempt XML parsing as fallback
    try:
        root = ET.fromstring(response.text)
        for p_tag in root.findall(".//p"):
            segment_texts = [s_tag.text.strip() for s_tag in p_tag.findall("s") if s_tag.text]
            if segment_texts:
                lines.append(" ".join(segment_texts))
    except ET.ParseError as e:
        print(f"XML parse error: {e}", file=sys.stderr)
        return None

    return lines if lines else None


# -------------------------
# Commands
# -------------------------
def cmd_search(query: str, as_json: bool = False) -> None:
    """
    Search YouTube and print video ID and title.
    """
    data = WEB_CLIENT.search(query)
    output_list = []
    try:
        results = (
            data['contents']['twoColumnSearchResultsRenderer']['primaryContents']
            ['sectionListRenderer']['contents']
        )
        for section in results:
            item_section = section.get('itemSectionRenderer', {}).get('contents', [])
            for item in item_section:
                video_renderer = item.get('videoRenderer')
                if video_renderer:
                    info = extract_video_basic_info(video_renderer)
                    if info:
                        if as_json:
                            output_list.append(info)
                        else:
                            print(f"{info['id']} | {info['title']}")
        
        if as_json:
            print(json.dumps(output_list))

    except KeyError:
        print("Could not parse search results. YouTube UI structure may have changed.", file=sys.stderr)


def extract_video_basic_info(renderer: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    video_id = renderer.get("videoId")
    if not video_id:
        return None
        
    title = renderer.get("title", {}).get("runs", [{}])[0].get("text")
    
    # Thumbnails
    thumbs = renderer.get("thumbnail", {}).get("thumbnails", [])
    thumbnail = thumbs[-1].get("url") if thumbs else ""
    
    # Published Time
    published_text = renderer.get("publishedTimeText", {}).get("simpleText", "")
    
    # View Count
    view_count_text = renderer.get("viewCountText", {}).get("simpleText", "")
    if not view_count_text:
         # sometimes view count is in runs
         runs = renderer.get("viewCountText", {}).get("runs", [])
         if runs:
             view_count_text = "".join([r.get("text", "") for r in runs])

    # Author/Channel
    owner_text = renderer.get("ownerText", {}).get("runs", [{}])[0].get("text", "")

    return {
        "id": video_id,
        "title": title,
        "thumbnail": thumbnail,
        "publishedAt": published_text,
        "viewCount": view_count_text,
        "author": owner_text
    }


def cmd_list_playlist(playlist_url_or_id: str, as_json: bool = False) -> None:
    """
    List all videos from a playlist as: <video_id> | <title>
    """
    playlist_id = extract_playlist_id(playlist_url_or_id)
    
    # Use browse endpoint to get playlist items
    continuation_token = None
    
    while True:
        if continuation_token:
            # Continue fetching more videos
            data = WEB_CLIENT.browse(continuation=continuation_token)
        else:
            # Initial request with playlist ID
            browse_id = f"VL{playlist_id}" if not playlist_id.startswith("VL") else playlist_id
            data = WEB_CLIENT.browse(browse_id=browse_id)
        
        # Extract video IDs and titles from the response
        try:
            # Try to find playlist video renderer items
            items = None
            
            # Initial load path
            if not continuation_token:
                items = (
                    data.get("contents", {})
                    .get("twoColumnBrowseResultsRenderer", {})
                    .get("tabs", [{}])[0]
                    .get("tabRenderer", {})
                    .get("content", {})
                    .get("sectionListRenderer", {})
                    .get("contents", [{}])[0]
                    .get("itemSectionRenderer", {})
                    .get("contents", [{}])[0]
                    .get("playlistVideoListRenderer", {})
                    .get("contents", [])
                )
            else:
                # Continuation path
                items = (
                    data.get("onResponseReceivedActions", [{}])[0]
                    .get("appendContinuationItemsAction", {})
                    .get("continuationItems", [])
                )
            
            if not items:
                break
            
            # Extract and print video IDs and titles
            continuation_token = None
            output_list = []

            for item in items:
                video_renderer = item.get("playlistVideoRenderer")
                if video_renderer:
                    info = extract_video_basic_info(video_renderer)
                    if info:
                        if as_json:
                            output_list.append(info)
                        else:
                            print(f"{info['id']} | {info['title']}")
                
                # Check for continuation token
                continuation_renderer = item.get("continuationItemRenderer")
                if continuation_renderer:
                    continuation_token = (
                        continuation_renderer
                        .get("continuationEndpoint", {})
                        .get("continuationCommand", {})
                        .get("token")
                    )
            
            if as_json and output_list:
                # We print chunks of JSON array items, the consumer should handle streaming or we can buffer.
                # For simplicity, let's print line-delimited JSON objects
                for obj in output_list:
                    print(json.dumps(obj))

            # If no continuation found, we're done
            if not continuation_token:
                break
                
        except (KeyError, IndexError, TypeError) as e:
            print(f"Error parsing playlist data: {e}", file=sys.stderr)
            break


def cmd_list_channel(channel_url_or_handle: str, as_json: bool = False) -> None:
    """
    List all videos from a channel as: <video_id> | <title>
    """
    channel_id = extract_channel_id(channel_url_or_handle)
    
    if not channel_id:
        sys.exit("Could not resolve channel ID. Please provide a valid channel URL, handle (@username), or channel ID.")
    
    # Convert channel ID to uploads playlist ID
    uploads_playlist_id = channel_id_to_uploads_playlist(channel_id)
    
    # Use the playlist listing function
    cmd_list_playlist(uploads_playlist_id, as_json=as_json)


def cmd_get(video_url_or_id: str) -> None:
    """
    Fetch and print the full transcript for a YouTube video.
    """
    video_id = extract_video_id(video_url_or_id)
    data = ANDROID_CLIENT.player(video_id)
    transcript = extract_transcript(data)

    if not transcript:
        sys.exit("No transcript found for this video.")

    for line in transcript:
        print(line)


def cmd_info(video_url_or_id: str) -> None:
    """
    Print basic video metadata.
    """
    video_id = extract_video_id(video_url_or_id)
    data = WEB_CLIENT.player(video_id)
    details = data.get("videoDetails", {})
    
    # Also fetch microformat for description/published date/view count consistency if possible
    # But videoDetails usually has enough
    
    info = {
        "id": details.get("videoId"),
        "title": details.get("title"),
        "author": details.get("author"),
        "viewCount": details.get("viewCount"),
        "lengthSeconds": details.get("lengthSeconds"),
        "thumbnail": details.get("thumbnail", {}).get("thumbnails", [{}])[-1].get("url", ""),
        # publishedAt not always in videoDetails directly in the same format
    }
    print(json.dumps(info))


# -------------------------
# CLI
# -------------------------
def main() -> None:
    usage_text = """
kinesis-cli: Fetch YouTube transcripts (official + auto-generated) without API key.

Usage:
  kinesis-cli -s "search query"       Search YouTube
  kinesis-cli -l PLAYLIST_ID_OR_URL   List all videos from a playlist
  kinesis-cli -c CHANNEL_URL_OR_ID    List videos from a channel
  kinesis-cli -g VIDEO_ID_OR_URL      Get transcript for a video
  kinesis-cli -i VIDEO_ID_OR_URL      Get video metadata

Examples:
  kinesis-cli -s "Rust programming"
  kinesis-cli -l https://www.youtube.com/playlist?list=PLO5VPQH6OWdXR8NlZt0jRbC39W_IyzS-v
  kinesis-cli -l PLO5VPQH6OWdXR8NlZt0jRbC39W_IyzS-v
  kinesis-cli -c @MrBeast
  kinesis-cli -c https://www.youtube.com/@MrBeast
  kinesis-cli -c UCX6OQ3DkcsbYNE6H8uQQuVA
  kinesis-cli -g 1IBGxhCzVSY
  kinesis-cli -i https://www.youtube.com/watch?v=1IBGxhCzVSY
"""

    parser = argparse.ArgumentParser(
        prog="kinesis-cli",
        description="Kinesis-CLI: Fetch transcripts (official + auto-generated) without API key",
        usage=usage_text,
        formatter_class=argparse.RawTextHelpFormatter,
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("-s", "--search", help="Search YouTube")
    group.add_argument("-l", "--list", help="List all videos from a playlist")
    group.add_argument("-c", "--channel", help="List all videos from a channel")
    group.add_argument("-g", "--get", help="Get transcript for a video")
    group.add_argument("-i", "--info", help="Get video metadata")
    group.add_argument("--resolve", help="Resolve handle to channel ID")
    
    parser.add_argument("--json", action="store_true", help="Output in JSON format")

    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()

    try:
        if args.search:
            cmd_search(args.search, as_json=args.json)
        elif args.list:
            cmd_list_playlist(args.list, as_json=args.json)
        elif args.channel:
            cmd_list_channel(args.channel, as_json=args.json)
        elif args.get:
            cmd_get(args.get)
        elif args.info:
            cmd_info(args.info)
        elif args.resolve:
            cid = extract_channel_id(args.resolve)
            if cid:
                print(json.dumps({"channelId": cid, "channelName": args.resolve}))
            else:
                sys.exit("Could not resolve channel.")
    except Exception as e:
        sys.exit(f"Error: {e}")


if __name__ == "__main__":
    main()
