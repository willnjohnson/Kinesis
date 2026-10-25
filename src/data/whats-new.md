# Changelog (v0.5.7)

## Improved
- **Performance and Stability:**
  - Resolved an infinite re-render loop in YouTube Search that caused high CPU utilization and application crashes (React Error #185) after performing ad-hoc keyword searches.
  - Decoupled search bar state synchronization so background prop updates no longer re-trigger active filtering.
  - Optimized video list header layout measurements to eliminate redundant layout reflows during view transitions.

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