# Changelog (v0.5.6)

## Improved
- **Notes View:** 
  - Added formatting toolbar for accessibility.
  - Added WYSIWIG Mode so user can edit while simultaneously seeing live preview. Markdown Mode remains available as an option.

- **Logs Entry Template:**
  - Added shorthand to custom event mapping to account for **multiple** events. See example:
  
    `{{@event: --12-25 = "Christmas", --12-26 = "Boxing Day", --01-01 = "New Year"}}`

- **Other Minor Changes:**
  - New databases only: auto_vacuum chosen before the first table exists.
  - Markdown change: support local paths for images. See example:

    `![Image](file:///C:/Users/Name/Pictures/Image.png)`
    
    `![Image](/home/name/Pictures/Image.png)`

# Changelog (v0.5.5)

## Added
- **Notifications:** Added a notification modal upon entering a workspace to bring pending action items to the user's attention, rather than relying solely on the easily overlooked pin indicator in the titlebar.

## Improved
- **Notes filtering:** Added a **No Drives** option to the Notes panel's Drive filter to show notes that haven't been assigned to a Drive.
- **Markdown insertion spacing:** Improved context-menu insertions in the Notes Markdown editor to add appropriate blank-line spacing when inserting formatting into empty lines between existing text blocks.
- **Cite Moment:** Added option to toggle between citing timestamped video in the video player as a Thought or as a Quote. (Previously, citing moments only represented blockquotes as Thoughts).
- **Full-text search:** Improved database-backed full-text search (FTS) to enhance search functionality.
- **Themes:** Added Content Theme tab, so user can separate theme for reading content from the rest of the workspace theme.
- **Q&A Format:** Uses blockquote format to construct Q&A (three ways) to address previous limitations of Q&A (previously single-line only):

```
First:
> [!QA] Single-line Question?
> Single-line Answer

Second (note: equivalent to previous, but for readability):
> [!QA]
> Single-line Question?
> Single-line Answer

Third (note: `---` separates question from answer):
> [!QA]
> Multi-line
>
> Question?
> ---
> Multi-line
>
> Answer
```

# Changelog (v0.5.4)

## Added

### Notes

* **Notes Section**: Write study notes in Markdown, apart from any one video. They save as you type, can be filed under Drives, and stay personal until you share them.
* **Cite Your Sources**: Right-click selected words in a Transcript or AI Summary to cite them in a note, or click **Cite Moment** on the player to pause and write a thought. A citation opens the video at that moment.
* **Questions and Answers**: A `Q:` line with an `A:` line under it keeps the answer covered until you click **Show Answer**.
* **Workbooks**: Put notes in order and read them a page at a time. A note or a workbook can be shared, linked to, and added to a Calendar track.
* **Collapsible Callouts**: `> [!NOTE]-` starts folded and `> [!NOTE]+` starts open. Click the title to fold or unfold it.
* **Maths and Formulas**: Write LaTeX between dollar signs: `$E = mc^2$` in a line, or `$$ ... $$` on lines of its own.
* **Find, Sort and Export**: `Ctrl+F` finds and replaces in the open note, the bottom bar sorts the list, and right-click exports a note as Markdown or a workbook as a ZIP.

### Logs

* **Logs Section**: Keep a dated record of what you did, with a title and a description for each day.
* **Columns, Dates and Export**: Drag a column's edge to resize it, choose a date format in **Entry Template**, and right-click a log to export it as CSV or Excel.

### Calendar

* **Repeat Patterns**: A scheduled track can repeat every other day or week, on the first Monday of the month, or by a rule of your own.

### Library

* **Sequences List**: The Drive panel can list every sequence, with a filter to find one.

### Themes

* **Light Themes**: Gruvbox Light and Catppuccin Latte.

## Improved

### Glossary

* **Terms in Sub-Drives**: File a term under any level of a Drive. Picking a Drive shows the terms beneath it too.
* **Flashcards**: Switch decks without closing Flashcards, and link to a deck from a note.

### Calendar

* **New Track and Edit Track**: Reorganized into Schedule and Options, and asks before closing with unsaved changes.

### Writing

* **Code Blocks**: Name a language after the triple backticks (```), and the code is colored to match your theme.
* **Callouts**: Start a quote with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or `[!CAUTION]`, or pick one under **Quote/Callout** in the right-click menu.

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