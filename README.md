# Kinesis

<img src="src-tauri/icons/icon.png" alt="icon" width="128"/>

A lightweight desktop application for bookmarking and viewing YouTube transcripts.

## Features

- **Channel Search:** Browse uploads by entering a YouTube handle (e.g., @MrBeast).
- **Playlist Search:** Browse playlists by entering a YouTube playlist URL.
- **Video Search:** Browse a single video by entering a YouTube video URL.

- **Bookmark videos:** Save videos to your library for quick access.
- **Search your bookmarks:** Filter through your bookmarked videos by title.
- **View transcripts:** View transcripts of videos in your library.

**Note:** Database is stored in AppData\Roaming\kinesisapp\kinesis_data.db for Windows and ~/.local/share/kinesisapp/kinesis_data.db for Linux.

## Setup and Installation

### Prerequisites
- Node.js (v18+)
- Rust toolchain (1.70+)

### Development
1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Launch the application in development mode:
   ```bash
   npx tauri dev
   ```

### Building for Production
To generate a production executable for your platform:
```bash
npx tauri build
```

## Tech Stack
- Frontend: React, TypeScript, Tailwind CSS, Lucide Icons, Vite.
- Backend: Tauri (Rust), Reqwest, Serde.
