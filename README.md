# Kinesis

<img src="src-tauri/icons/icon.png" alt="icon" width="128"/>

A lightweight desktop application for viewing YouTube transcripts.

## Features

- **Channel Search:** Browse uploads by entering a YouTube handle (e.g., @MrBeast) or Channel ID.
- **Playlist Search:** Browse playlists by entering a YouTube playlist URL.
- **Video Search:** Browse a single video by entering a YouTube video URL.

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
   npm run tauri dev
   ```

### Building for Production
To generate a production executable for your platform:
```bash
npm run tauri build
```

## Tech Stack
- Frontend: React, TypeScript, Tailwind CSS, Lucide Icons.
- Backend: Tauri (Rust), Reqwest, Serde.
