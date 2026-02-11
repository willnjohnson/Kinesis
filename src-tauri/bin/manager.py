import sqlite3
import json
import sys
import argparse
from concurrent.futures import ThreadPoolExecutor
from kinesis_cli import extract_video_id, cmd_info, cmd_get, ANDROID_CLIENT, WEB_CLIENT, extract_transcript

DB_NAME = "kinesis_data.db"

def get_db_path(args):
    return args.db if args and hasattr(args, 'db') and args.db else DB_NAME

def init_db(db_path):
    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS videos (
            video_id TEXT PRIMARY KEY,
            title TEXT,
            author TEXT,
            length_seconds INTEGER,
            transcript TEXT
        )
    """)
    conn.close()

def list_videos(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT video_id, title, author, length_seconds FROM videos ORDER BY rowid DESC") 
        rows = cursor.fetchall()
        videos = []
        for r in rows:
            videos.append({
                "id": r[0],
                "title": r[1],
                "author": r[2],
                "lengthSeconds": r[3],
            })
        return videos
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()

def delete_video(db_path, video_id):
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("DELETE FROM videos WHERE video_id = ?", (video_id,))
        conn.commit()
        return {"status": "deleted", "video_id": video_id}
    except Exception as e:
        return {"error": str(e)}
    finally:
        conn.close()

def check_video_exists(db_path, video_id):
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT video_id FROM videos WHERE video_id = ?", (video_id,))
        row = cursor.fetchone()
        return {"exists": row is not None}
    except Exception as e:
        return {"exists": False, "error": str(e)}
    finally:
        conn.close()

def bulk_save_videos(video_ids, db_path):
    results = []
    # Using max_workers=5 to speed up but avoid hitting YouTube limits too hard
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(get_video_data, vid, db_path, True) for vid in video_ids]
        for future in futures:
            try:
                results.append(future.result())
            except Exception as e:
                results.append({"error": str(e)})
    return results



def get_video_data(url_or_id: str, db_path: str, save_to_db: bool = True):
    video_id = extract_video_id(url_or_id)
    
    # Ensure table exists (auto-init)
    init_db(db_path)
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # 1. Check if we already have it
    cursor.execute("SELECT * FROM videos WHERE video_id = ?", (video_id,))
    row = cursor.fetchone()
    
    if row:
        conn.close()
        # print(f"--- Cache Hit: Fetching {video_id} from Database ---", file=sys.stderr)
        
        # Optional: Check if transcript is valid/complete if needed
        # For now, just trust the DB. 
        # If user feels "not in DB yet", maybe they deleted the file but row remains?
        # Or maybe the partial save happened.
        
        return {
            "video_id": row[0],
            "title": row[1],
            "author": row[2],
            "length": row[3],
            "transcript": row[4],
            "status": "exists"
        }

    # 2. If not, fetch from YouTube
    # print(f"--- Cache Miss: Fetching {video_id} from YouTube ---", file=sys.stderr)
    
    try:
        # Metadata (Internal logic of your -i flag)
        player_data = WEB_CLIENT.player(video_id)
        meta_data = player_data.get("videoDetails", {})
        
        # Transcript (Internal logic of your -g flag)
        player_json = ANDROID_CLIENT.player(video_id)
        lines = extract_transcript(player_json)
        full_text = "\n".join(lines) if lines else "No transcript available." # Non-empty so we know checked
        
        # 3. Save to DB (only if requested)
        if save_to_db:
            cursor.execute("""
                INSERT INTO videos (video_id, title, author, length_seconds, transcript)
                VALUES (?, ?, ?, ?, ?)
            """, (video_id, meta_data.get("title"), meta_data.get("author"), meta_data.get("lengthSeconds"), full_text))
            
            conn.commit()
            conn.close()
            
            return {
                "video_id": video_id, 
                "title": meta_data.get("title"),
                "author": meta_data.get("author"),
                "length": meta_data.get("lengthSeconds"),
                "transcript": full_text,
                "status": "saved"
            }
        else:
            conn.close()
            return {
                "video_id": video_id, 
                "title": meta_data.get("title"),
                "author": meta_data.get("author"),
                "length": meta_data.get("lengthSeconds"),
                "transcript": full_text,
                "status": "fetched"
            }
            
    except Exception as e:
        # If fetch fails, return partial or error
        conn.close()
        return {"error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="Kinesis Manager")
    parser.add_argument("--db", help="Path to database file")
    
    subparsers = parser.add_subparsers(dest="command")
    
    subparsers.add_parser("init", help="Initialize database")
    
    get_parser = subparsers.add_parser("get", help="Get video data (fetch and save if missing)")
    get_parser.add_argument("video_id", help="Video ID or URL")
    
    peek_parser = subparsers.add_parser("peek", help="Get video data (fetch if missing, do NOT save)")
    peek_parser.add_argument("video_id", help="Video ID or URL")
    
    subparsers.add_parser("list", help="List all saved videos")
    
    del_parser = subparsers.add_parser("delete", help="Delete a video")
    del_parser.add_argument("video_id", help="Video ID")
    
    check_parser = subparsers.add_parser("check", help="Check if video exists in DB")
    check_parser.add_argument("video_id", help="Video ID")

    bulk_parser = subparsers.add_parser("bulk-save", help="Save multiple videos in parallel")
    bulk_parser.add_argument("video_ids", nargs="+", help="One or more Video IDs or URLs")

    
    args = parser.parse_args()
    db_path = get_db_path(args)
    
    if args.command == "init":
        init_db(db_path)
        print("Database initialized.")
    elif args.command == "get":
        data = get_video_data(args.video_id, db_path, save_to_db=True)
        print(json.dumps(data))
    elif args.command == "peek":
        data = get_video_data(args.video_id, db_path, save_to_db=False)
        print(json.dumps(data))
    elif args.command == "list":
        videos = list_videos(db_path)
        print(json.dumps(videos))
    elif args.command == "delete":
        res = delete_video(db_path, args.video_id)
        print(json.dumps(res))
    elif args.command == "check":
        res = check_video_exists(db_path, args.video_id)
        print(json.dumps(res))
    elif args.command == "bulk-save":
        res = bulk_save_videos(args.video_ids, db_path)
        print(json.dumps(res))

    else:
        parser.print_help()

if __name__ == "__main__":
    main()
