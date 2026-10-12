# Kinesis

<img src="src-tauri/icons-kinesis/icon.png" alt="icon" width="128"/>

A desktop application for keeping and studying the videos you learn from.

## Workspaces

A workspace is your research library, one SQLite database plus its settings, all in a single folder. You can have as many as you want, and switching between them is instant:

- **Start an empty one** for a new project.
- **Import a Kinpak**, a single file someone else exported, to get their research without any of their API keys or local paths.
- **Point at a folder** that already holds a `kinesis_data.db`, to adopt a database that lives on an external drive.

The Workspaces screen is the first thing you see on a fresh install, and it runs Conway's Game of Life in the background while you decide. A workspace whose drive is unplugged stays in the list, dimmed, with a **Locate** action.

## Use Cases

Kinesis is built for anyone who learns from video and wants the learning to last. A few ways people use it:

- **Academics:** File lecture videos by course and chapter, write study notes that cite the exact moment in each lecture, and review with flashcards. Export the whole thing to Obsidian for a personal wiki.
- **Fitness:** Build workout tracks that rotate through exercises, with schedules and priorities, and export them to your calendar app.
- **Language learning:** Tag every video by language and chapter, file them under a Glossary term for each grammar point, and walk through them in order with sequences.
- **Research leads:** Curate a workspace for a team, decide what readers can see and change, and share curated content through a sync server. Readers never upload.
- **Hobbyists:** Save tutorial videos, tag them, summarize them with AI, and find them again later with full-text search.

## Features

### Searching YouTube

- **Channel Search:** Browse uploads by entering a YouTube handle (e.g., @MrBeast).
- **Playlist Search:** Browse playlists by entering a YouTube playlist URL.
- **Video Search:** Browse a single video by entering a YouTube video URL.
- **No API key required for searching:** Uses the same internal endpoints the YouTube website uses.

### Saving and browsing your library

- **Save videos** to your library for quick access.
- **Search your bookmarks** with FTS5 full-text search over titles, summaries, transcripts and tags.
- **View transcripts** of videos in your library.
- **Bulk summarize** all videos in your library at once.
- **Custom prompts** per channel and globally, to tailor the AI summary style.

### AI Summarization

Get AI-powered summaries of video transcripts using:

- **Cloud AI (VeniceAI):** Use cloud-based AI for summarization. Get an API key from [Venice.ai](https://venice.ai), enter it in Kinesis settings, and choose Venice as your summarization provider.

**Advanced:** A local AI option (Ollama) is available for users who want to run LLMs on their own machine, but it is not exposed in the Settings UI. It is enabled by setting a flag in the database directly.

### Organizing your research

- **Drive (WDBS):** A tree of categories for filing videos. A video's home Drive plus "Also In" links let it appear under multiple Drives.
- **Sequences:** Ordered watch lists per Drive, with Previous/Next navigation.
- **Glossary:** Quick Tags and Terms (with Markdown definitions), filed under Drives, with a flashcard mode.
- **Biographies:** Per-channel entries with display names, aliases, bios, social links and backlinks.
- **Notes:** Study notes that cite videos, with question-and-answer blocks and a backlinks column.
- **Calendar:** Tracks (ordered lists of videos, notes and tasks) with schedules, rotations, priorities and an ICS export.
- **Pins:** Mark videos you're working on now, shown in the title bar.
- **Graph view:** A force-directed graph of every video, term and person, joined by the links you wrote.

### Keeping up with YouTube

- **Renamed channels:** Detected by channel ID; the biography, its videos, links and footers all follow.
- **Renamed and removed videos:** Titles update automatically; removed videos are marked orphaned (kept with their data) and can be deleted in bulk.
- **Orphaned videos:** Shown as a chip in the Library's status bar.

### Export

- **Export to Obsidian:** Turn your workspace into a vault with notes, tags and links.
- **Export Kinpak:** A single file that bundles your workspace's shared content for sharing or backup.

**Note:** Database is stored in `AppData\Roaming\kinesisapp\kinesis_data.db` for Windows and `~/.local/share/kinesisapp/kinesis_data.db` for Linux.

## Setup and Installation

### Prerequisites

- Node.js (v18+)
- Rust toolchain (1.70+)
- **YouTube API Key:** Required for full use. It fetches channel IDs and subscriber counts, and other YouTube Data API features. Searching itself needs no key.
- **Pixabay API Key:** Optional. It powers the image search feature in the Photosynthesis panel (generate or find images to include in summaries).

### AI Provider Setup

#### Cloud AI (VeniceAI)

1. Get an API key from [Venice.ai](https://venice.ai)
2. Enter your API key in Kinesis settings
3. Choose Venice as your summarization provider

### Development

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Launch the application in development mode:
   ```bash
   npm run tauri:dev
   ```

### Building for Production

To generate a production executable for your platform:
```bash
npm run tauri:build
```

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS 4, Vite 7, Lucide Icons, react-markdown + remark-gfm, react-icons, date-fns, Tanstack Virtual.
- **Backend:** Tauri 2 (Rust), Reqwest, Serde, rusqlite (SQLite bundled), tokio, chrono, sha2, flate2, scraper, quick-xml, regex.
- **Sync:** `crates/kinesis-sync-proto`. Wire types, settings allowlist, hashing and the pack codec, shared by the client, the reference server and the Kinpak format.
- **AI:** VeniceAI (cloud); Ollama (local, advanced, not exposed in Settings).s).