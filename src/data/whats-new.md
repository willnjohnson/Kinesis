# Changelog (v0.5.3)

## Added

### Calendar

* **Tracks**: Plan videos and tasks as tracks, like a fitness routine or a school course. A track can go one item at a time, follow a weekly schedule, or repeat as a rotation. Check items off as you go, even in a read-only workspace.
* **Week View**: See each track's items on their days, with a month overview and an "Up next" list in the Tracks panel.
* **Folders**: Group several videos and tasks into a folder with **Add folder**, then drag items in or out. On a dated track, everything in a folder lands on the same day. A folder is done once everything in it is, and checking it off checks off all of it.
* **In Progress and Priority**: Mark an item you've started as In Progress. Priority shows as a diamond: gray outline for low, half-filled yellow for medium, solid red for high.
* **Export to Calendar**: Right-click a track to save it as an `.ics` file for Google Calendar, Apple Calendar or Outlook.

### Pins

* **Pin a Video**: Click the pin beside the sidebar's close button to keep a video at hand while you work on it.
* **Pin Menu**: The pin in the title bar lists your pinned videos, newest first, and opens any of them from any section. It also has submenus for the Essential tags (Watch Later, Favorite, Revisit, Key Source, Follow Up). **Clear pins** empties the list when you're done.

### Flashcards

* **Study Your Terms**: Click **Flashcards** in the Glossary's bottom bar to study the terms shown (all of them, or one Drive's). Click a card or press Space to flip it, and use the arrow keys to move between cards. Show the term or the definition first, and shuffle the deck. Sort each card into **Know it** or **Still learning**, then go over the ones you're still learning until you know them all.

### About Kinesis

* **Walkthrough**: A short tour of what Kinesis is and how each part works. Open it from the Workspaces screen or with `Ctrl+K`.

## Improved

### Biography

* **Alias**: Give a channel a name of your own in **Edit Bio**, like the person behind it. The alias shows as a badge before the channel's name in the Biography list, its window, and a summary's Channel Info line. Search with `@@` to find a channel by its alias or its name.
  * **Show Alias** in the bottom bar turns the badges on or off. With it on, the list is sorted by alias where there is one.
* **Renamed Channels**: Opening a biography checks the channel on YouTube. A new handle is updated everywhere it's used. A new display name asks whether to keep the old one as the alias, so the channel is still easy to recognize.

### Library

* **Orphaned Videos**: Videos YouTube no longer has are found as their thumbnails load in the Library, or when you open them. They stay in the Library for the record, and **Orphaned** in the bottom bar (next to the Trash) lists them, with a way to delete them. A video that comes back on YouTube is taken off the list.
* **Resume Where You Left Off**: Kinesis remembers where you stopped in each saved video. Open it again and click **Resume from 23:14** on the player to pick up there. Watching past the first half minute also marks the video **In Progress** on its Calendar tracks.
* **Continue Watching and Watched**: Two new lists in the pin menu. **Continue Watching** shows the videos you've started, with how far in you are; **Mark as Completed** moves a video to **Watched** and checks it off on its Calendar tracks. A video you watch to the end goes to Watched on its own.

# Changelog (v0.5.2)

## Improved

* **Select and Copy Text**: Transcripts, AI Summaries, Glossary definitions and Biographies can now be **selected**. Right-click a selection to copy it as plain text or as Markdown.
* **Easier Glossary/Biography Editing**: Edit a term from its window, preview your Markdown while editing, and get a warning before closing with unsaved changes. Pencil and delete icons are also moved closer to the entry name.
* **@ and ^ Mentions**: In a Markdown editor, type `@` and the start of a handle, or `^` and the start of a Glossary term, to see it suggested. Press Enter/Tab to turn it into a link.
* **Drag to Select in Bulk Assign**: Hold left click on a video and drag to select a whole block of videos at once.
* **Safer Deleting**: Emptying the Trash and other permanent deletes now ask first.

## Fixed

* **Search History**: "Clear day" no longer deletes the older days' searches along with it.

# Changelog (v0.5.1)

## Added

### Video Timestamps

* **Jump to a Moment**: Type a timestamp in square brackets, like `[1:23]` or `[1:02:03]`, in a Transcript or AI Summary. It shows as a clickable link, and jumps the sidebar's video to that moment. The square bracket syntax `[]` is important, to not confuse a timestamp with a ratio (2:1) or a time of day (12:00 PM).
  * With the video player hidden, clicking a timestamp opens the video on YouTube at that moment instead. Autoplay is turned off, so user would need to click the video to start it at the timestamp.
* **Timed Video Links**: A video link can start partway through: `[Talk](kinesis://video/ID?t=1:23)`. It shows its time and opens the video at that moment, or just jumps there if the video is already open.
  * Shortcut: type the timestamp straight after the link, `[Talk](kinesis://video/ID)[1:23]`, and it becomes part of the link when you save. This works anywhere you can add links: Transcripts, AI Summaries, Glossary definitions and Biographies.
  * A timestamp on its own only jumps the video in the sidebar. In Glossary definitions and Biographies, where there's no player, it stays plain text.
* **Copy Link at Time**: Hover the sidebar's video and click **Copy Link at Time** to copy a link to the video that starts where it's playing, ready to paste into any text.

### Tags

* **Essential Tags**: Every workspace now has five built-in tags for keeping track of videos: **Watch Later**, **Favorite**, **Revisit**, **Key Source** and **Follow Up**. They sit in their own **Essentials** section at the top of the Glossary's tags, each with its own icon, and can't be renamed or deleted.

### Links

* **Backlinks**: See everything that links to a video or a person. A video's new **Backlinks** tab (beside Attachments) and a person's Biography list each AI Summary, Transcript, Note, Glossary definition and Biography that links there, with the words around the link. Click a row to open it.
  * For a video, the moments other texts link to are listed too; click one to jump the video there.

* **External Link Confirmation**: Kinesis now asks before opening an external website from your content, showing the address first. This covers links in transcripts, summaries, glossary definitions and biographies, and Biography's social and website icons. Links Kinesis makes itself, like Open in YouTube, open straight away.

## Changed

### Title Bar

* **Binder Tabs**: In Title Bar navigation, Search, Library, Glossary and Biography are now tabs (instead of buttons) and appear after the workspace name, with the Kinesis logo, name and version on the left. The open tab is marked with an accent line.

### AI Summaries

* **Linked Creator**: The creator's name in a summary's "Channel Info" line now links to their Biography. New summaries get it automatically.
  * Summaries saved before this update still show the name as plain text. Update them all at once: [Link creators in older summaries](action:link-channel-info)

## Fixed

### Trash

* **Restoring a Creator's Videos**: Restoring videos from the Trash after all of a creator's videos were deleted now brings back their Biography too, in any order you restore them. Before, the videos came back without a Biography entry.

### Drives

* **Drive Tree Updates**: Changing a Drive's alias, Category Marker or Decoration Marker in Manage Drive now updates the Drive Tree right away, along with the Drive name shown in the status bar.

# Changelog (v0.5.0)

## Added

### Manage Drive

* **Manage Drive Section**:
  * Get an overview of an entire drive.
  * View all of the sequences that exist.
  * View all videos that aren't sorted into a Drive and view each Drive (similar to the existing Drive Tree).
  * Viewing an individual drive shows an overview, allows user to edit markers and alias.
* **Drive Node Actions**:
  * Add sub-drives.
  * Rename the current drive node.
  * Move/merge into another node.
