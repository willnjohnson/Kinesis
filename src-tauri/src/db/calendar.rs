//! Calendar: schedules for working through videos, one model for three ways of scheduling.
//!
//! A **track** is a named, ordered list of **entries** (a video, or a task with just a label), and its `advance_mode` says
//! how it moves along:
//!   - `completion`: the next entry comes up once the one before it is marked done. No dates (a Gantt-style chain).
//!   - `calendar`: entries are dealt out in order onto the track's schedule (its weekdays, within its terms, minus its
//!     holidays), whether or not the last one was done (a school schedule: Mon/Wed/Fri lectures).
//!   - `hybrid`: both. An entry is up once its date has come *and* the one before it is done; past its date and still not
//!     done, it's overdue rather than skipped.
//! `loop_entries` starts the list over after its last entry: a Push/Pull/Legs rotation is a looping `completion` track.
//!
//! A track can belong to a Drive (`drive`, "" for none, as the Glossary does). With `source_drive_sequence`, its order is
//! read live off that Drive's sequence (db/sequences.rs) rather than kept separately; its own entry rows then only carry a
//! per-video label or a place for a completion to hang off, and are made the first time one's needed.
//!
//! An entry can also be a **folder**: a named group of entries that share one place in the track. A dated track gives the
//! whole folder one day, so several things land on the same day; an undated one has it up until everything in it is done.
//! A folder holds videos and tasks, not other folders, and is done once all it holds is (worked out, never stored). The
//! schedule deals out **slots**: an entry on its own, or a folder with what's in it.
//!
//! Nothing about where a track stands is stored: `resolve_track` works it out each time from the entries, what's been
//! marked done and today's date.
//!
//! Schedules: a track's **terms** (Fall, Spring, ...) are the date windows its schedule runs in, each a one-off range or the
//! same months every year; none means no limit. **Holiday sets** are named lists of dates a track can exclude or include.
//! An included date always happens (a make-up day, even outside the usual weekdays), and wins over any exclusion. An
//! excluded date never uses up an entry: it just isn't a day on the schedule. "US Federal Holidays" is built in and worked
//! out for any year rather than stored, since most of its dates are "the Nth weekday of a month".

use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Duration, NaiveDate, Weekday};
use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};

use super::sequences::{get_drive_sequence, normalize_drive};

fn invalid(msg: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, msg.into())))
}

const MODES: [&str; 3] = ["completion", "calendar", "hybrid"];
/// The built-in holiday set's `builtin` value.
pub const US_FEDERAL: &str = "us_federal";
/// How far past a track's start the schedule is ever followed (a guard against a schedule with no days left on it).
const MAX_SCHEDULE_DAYS: i64 = 366 * 25;

/// Creates the Calendar's tables (called from init_db). STRICT, like every table here, and cleaned up by triggers rather
/// than foreign keys, which this project doesn't turn on.
pub fn ensure_calendar_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS CalendarTracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            drive TEXT NOT NULL DEFAULT '',
            advance_mode TEXT NOT NULL DEFAULT 'completion' CHECK (advance_mode IN ('completion', 'calendar', 'hybrid')),
            loop_entries INTEGER NOT NULL DEFAULT 0,
            source_drive_sequence INTEGER NOT NULL DEFAULT 0,
            weekdays TEXT NOT NULL DEFAULT '',
            start_date TEXT NOT NULL,
            archived INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            time_start INTEGER,
            time_duration INTEGER,
            cycle_offset INTEGER NOT NULL DEFAULT 0,
            previous_start_date TEXT,
            previous_cycle_offset INTEGER
        ) STRICT;
        CREATE TABLE IF NOT EXISTS CalendarEntries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL,
            video_id TEXT,
            label TEXT NOT NULL DEFAULT '',
            position INTEGER,
            target_date TEXT,
            icon TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            priority INTEGER NOT NULL DEFAULT 0,
            former_video_id TEXT,
            is_folder INTEGER NOT NULL DEFAULT 0,
            folder_id INTEGER,
            UNIQUE (track_id, video_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idxCalendarEntriesTrack ON CalendarEntries(track_id, position);
        CREATE INDEX IF NOT EXISTS idxCalendarEntriesVideo ON CalendarEntries(video_id);
        CREATE TABLE IF NOT EXISTS CalendarCompletions (
            entry_id INTEGER NOT NULL,
            cycle INTEGER NOT NULL DEFAULT 0,
            completed_at TEXT NOT NULL,
            PRIMARY KEY (entry_id, cycle)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS CalendarTerms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            start_date TEXT NOT NULL,
            end_date TEXT NOT NULL,
            annual INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idxCalendarTermsTrack ON CalendarTerms(track_id);
        CREATE TABLE IF NOT EXISTS CalendarHolidaySets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            annual INTEGER NOT NULL DEFAULT 0,
            builtin TEXT NOT NULL DEFAULT ''
        ) STRICT;
        CREATE UNIQUE INDEX IF NOT EXISTS idxCalendarHolidaySetsBuiltin ON CalendarHolidaySets(builtin) WHERE builtin != '';
        CREATE TABLE IF NOT EXISTS CalendarHolidayDates (
            set_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (set_id, date)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS CalendarTrackHolidayRules (
            track_id INTEGER NOT NULL,
            set_id INTEGER NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('exclude', 'include')),
            PRIMARY KEY (track_id, set_id)
        ) STRICT;

        -- A deleted track takes everything of its own with it (completions first, while their entries still exist).
        CREATE TRIGGER IF NOT EXISTS trgCalendarTracksAfterDEL_Cascade
        AFTER DELETE ON CalendarTracks
        BEGIN
            DELETE FROM CalendarCompletions WHERE entry_id IN (SELECT id FROM CalendarEntries WHERE track_id = OLD.id);
            DELETE FROM CalendarEntries WHERE track_id = OLD.id;
            DELETE FROM CalendarTerms WHERE track_id = OLD.id;
            DELETE FROM CalendarTrackHolidayRules WHERE track_id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trgCalendarEntriesAfterDEL_Cascade
        AFTER DELETE ON CalendarEntries
        BEGIN
            DELETE FROM CalendarCompletions WHERE entry_id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trgCalendarHolidaySetsAfterDEL_Cascade
        AFTER DELETE ON CalendarHolidaySets
        BEGIN
            DELETE FROM CalendarHolidayDates WHERE set_id = OLD.id;
            DELETE FROM CalendarTrackHolidayRules WHERE set_id = OLD.id;
        END;",
    )?;
    // A track's time of day, and where its current run starts (Start over), came after the table did: a database from
    // before gets the columns now.
    // (Likewise an entry's icon and description.)
    for (table, column, definition) in [
        ("CalendarTracks", "time_start", "INTEGER"),
        ("CalendarTracks", "time_duration", "INTEGER"),
        ("CalendarTracks", "cycle_offset", "INTEGER NOT NULL DEFAULT 0"),
        ("CalendarTracks", "previous_start_date", "TEXT"),
        ("CalendarTracks", "previous_cycle_offset", "INTEGER"),
        ("CalendarEntries", "icon", "TEXT NOT NULL DEFAULT ''"),
        ("CalendarEntries", "description", "TEXT NOT NULL DEFAULT ''"),
        ("CalendarEntries", "priority", "INTEGER NOT NULL DEFAULT 0"),
        ("CalendarEntries", "former_video_id", "TEXT"),
        // A folder (is_folder) groups the entries whose folder_id is its id into one place in the track. An entry in a
        // folder has its position among the folder's entries; one not in a folder, among the track's.
        ("CalendarEntries", "is_folder", "INTEGER NOT NULL DEFAULT 0"),
        ("CalendarEntries", "folder_id", "INTEGER"),
    ] {
        if !super::schema::column_exists(conn, table, column)? {
            conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"), [])?;
        }
    }
    // Started but not finished: an entry marked In progress in a cycle (set_calendar_progress). Only a marker: it
    // doesn't move the track along, and marking the entry done clears it. Gone with its entry, or its track.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS CalendarProgress (
            entry_id INTEGER NOT NULL,
            cycle INTEGER NOT NULL DEFAULT 0,
            started_at TEXT NOT NULL,
            PRIMARY KEY (entry_id, cycle)
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS trgCalendarEntriesAfterDEL_Progress
        AFTER DELETE ON CalendarEntries
        BEGIN
            DELETE FROM CalendarProgress WHERE entry_id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS trgCalendarTracksAfterDEL_Progress
        AFTER DELETE ON CalendarTracks
        BEGIN
            DELETE FROM CalendarProgress WHERE entry_id IN (SELECT id FROM CalendarEntries WHERE track_id = OLD.id);
        END;",
    )?;
    // After the columns above, which these use.
    conn.execute_batch(
        "-- A deleted video (the Trash too) leaves its place in a track as a task named after it, so a milestone in a chain
        -- survives it. Which video it was is kept, so the video coming back (restored from the Trash, or saved again)
        -- takes its place again: see the trigger after this one. (It replaces one that left the task with no name.)
        DROP TRIGGER IF EXISTS trgVideosAfterDEL_CalendarEntries_ClearVideo;
        CREATE TRIGGER IF NOT EXISTS trgVideosAfterDEL_CalendarEntries_KeepPlace
        AFTER DELETE ON Videos
        BEGIN
            UPDATE CalendarEntries
            SET label = CASE WHEN label = '' THEN COALESCE(NULLIF(OLD.title, ''), OLD.video_id) ELSE label END,
                former_video_id = OLD.video_id,
                video_id = NULL
            WHERE video_id = OLD.video_id;
        END;
        -- A video coming back reconnects the places it left: one per track (a track holds a video once), and not in a track
        -- that has it again already. The name it was left with goes back to following the video's title.
        CREATE TRIGGER IF NOT EXISTS trgVideosAfterINS_CalendarEntries_Reconnect
        AFTER INSERT ON Videos
        BEGIN
            UPDATE CalendarEntries
            SET video_id = NEW.video_id,
                former_video_id = NULL,
                label = CASE WHEN label = COALESCE(NULLIF(NEW.title, ''), NEW.video_id) THEN '' ELSE label END
            WHERE id IN (
                SELECT MIN(id) FROM CalendarEntries
                WHERE former_video_id = NEW.video_id
                  AND track_id NOT IN (SELECT track_id FROM CalendarEntries WHERE video_id = NEW.video_id)
                GROUP BY track_id
            );
        END;",
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO CalendarHolidaySets (name, annual, builtin) VALUES ('US Federal Holidays', 1, ?1)",
        params![US_FEDERAL],
    )?;
    Ok(())
}

// ── Dates ────────────────────────────────────────────────────────────────────────────────────────

fn parse_date(s: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").map_err(|_| invalid(format!("'{}' isn't a date like 2026-09-01", s.trim())))
}

fn fmt_date(d: NaiveDate) -> String {
    d.format("%Y-%m-%d").to_string()
}

fn now_stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Today, on this computer's clock.
pub fn local_today() -> NaiveDate {
    chrono::Local::now().date_naive()
}

/// The `n`th (1-based) `weekday` of a month, or the last one with `n == 0`.
fn nth_weekday(year: i32, month: u32, weekday: Weekday, n: u32) -> NaiveDate {
    if n == 0 {
        let next_month = if month == 12 { NaiveDate::from_ymd_opt(year + 1, 1, 1) } else { NaiveDate::from_ymd_opt(year, month + 1, 1) };
        let mut d = next_month.expect("valid month") - Duration::days(1);
        while d.weekday() != weekday {
            d -= Duration::days(1);
        }
        return d;
    }
    let first = NaiveDate::from_ymd_opt(year, month, 1).expect("valid month");
    let offset = (7 + weekday.num_days_from_monday() as i64 - first.weekday().num_days_from_monday() as i64) % 7;
    first + Duration::days(offset + 7 * (n as i64 - 1))
}

/// A fixed-date holiday's day off: Saturday's is the Friday before, Sunday's the Monday after (5 U.S.C. 6103).
fn observed(d: NaiveDate) -> NaiveDate {
    match d.weekday() {
        Weekday::Sat => d - Duration::days(1),
        Weekday::Sun => d + Duration::days(1),
        _ => d,
    }
}

/// The eleven U.S. federal holidays of `year`, as the days they're observed.
pub fn us_federal_holidays(year: i32) -> Vec<(NaiveDate, &'static str)> {
    let fixed = |m: u32, d: u32| observed(NaiveDate::from_ymd_opt(year, m, d).expect("valid date"));
    vec![
        (fixed(1, 1), "New Year's Day"),
        (nth_weekday(year, 1, Weekday::Mon, 3), "Martin Luther King Jr. Day"),
        (nth_weekday(year, 2, Weekday::Mon, 3), "Washington's Birthday"),
        (nth_weekday(year, 5, Weekday::Mon, 0), "Memorial Day"),
        (fixed(6, 19), "Juneteenth"),
        (fixed(7, 4), "Independence Day"),
        (nth_weekday(year, 9, Weekday::Mon, 1), "Labor Day"),
        (nth_weekday(year, 10, Weekday::Mon, 2), "Columbus Day"),
        (fixed(11, 11), "Veterans Day"),
        (nth_weekday(year, 11, Weekday::Thu, 4), "Thanksgiving Day"),
        (fixed(12, 25), "Christmas Day"),
    ]
}

fn is_us_federal_holiday(d: NaiveDate) -> bool {
    // Next year's New Year's Day can be observed on this year's December 31.
    [d.year(), d.year() + 1].iter().any(|&y| us_federal_holidays(y).iter().any(|(h, _)| *h == d))
}

// ── Tracks ───────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarTrack {
    pub id: i64,
    pub name: String,
    /// The Drive it belongs to (":CS-DSA"), or "" for none.
    pub drive: String,
    pub advance_mode: String,
    pub loop_entries: bool,
    pub source_drive_sequence: bool,
    /// The days of the week its schedule runs on, 1 (Monday) to 7 (Sunday). Empty for a `completion` track.
    pub weekdays: Vec<u32>,
    pub start_date: String,
    pub archived: bool,
    pub created_at: String,
    /// A dated track's time of day: its start, in minutes after midnight, and how long it takes, in minutes. Both None for
    /// "any time that day" (and always for a `completion` track, which has no days).
    pub time_start: Option<i64>,
    pub time_duration: Option<i64>,
    /// The cycle its current run began at: 0, until it's started over (start_calendar_track_over), which moves it past every
    /// cycle used so far. What was marked done before stays, under its own cycles, as history; the new run starts unmarked.
    pub cycle_offset: i64,
    /// Where it stood before its last Start over (its start date and cycle_offset), so that can be undone
    /// (undo_calendar_track_start_over). None when there's nothing to undo. Only TrackState's `can_undo_start_over` is sent.
    #[serde(skip)]
    pub previous_start_date: Option<String>,
    #[serde(skip)]
    pub previous_cycle_offset: Option<i64>,
}

/// What a new or edited track is given.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInput {
    pub name: String,
    #[serde(default)]
    pub drive: String,
    pub advance_mode: String,
    #[serde(default)]
    pub loop_entries: bool,
    #[serde(default)]
    pub source_drive_sequence: bool,
    #[serde(default)]
    pub weekdays: Vec<u32>,
    /// When its schedule starts; today when left out.
    pub start_date: Option<String>,
    /// A time window on its days (minutes after midnight, and minutes long); both left out for any time that day.
    #[serde(default)]
    pub time_start: Option<i64>,
    #[serde(default)]
    pub time_duration: Option<i64>,
}

struct CleanTrack {
    name: String,
    drive: String,
    mode: String,
    weekdays: String,
    start: String,
    time: Option<(i64, i64)>,
}

/// The shortest time window a track can have, in minutes.
const MIN_DURATION: i64 = 5;

fn clean_track(input: &TrackInput) -> Result<CleanTrack> {
    // Runs of spaces count as one, so "Data  Structures" and "Data Structures" are the same name (see ensure_name_free).
    let name = input.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(invalid("A track needs a name."));
    }
    if !MODES.contains(&input.advance_mode.as_str()) {
        return Err(invalid(format!("'{}' isn't a way a track can advance", input.advance_mode)));
    }
    let drive = if input.drive.trim().is_empty() { String::new() } else { normalize_drive(&input.drive)? };
    if input.source_drive_sequence && drive.is_empty() {
        return Err(invalid("A track can only follow a Drive's sequence when it belongs to a Drive."));
    }
    let mut days: Vec<u32> = input.weekdays.iter().copied().filter(|d| (1..=7).contains(d)).collect();
    days.sort_unstable();
    days.dedup();
    if input.advance_mode != "completion" && days.is_empty() {
        return Err(invalid("A track that follows dates needs at least one day of the week."));
    }
    if input.advance_mode == "completion" {
        days.clear();
    }
    let start = match &input.start_date {
        Some(s) if !s.trim().is_empty() => fmt_date(parse_date(s)?),
        _ => fmt_date(local_today()),
    };
    // A time window only means something on a track with days. It stays within its day: it can't run past midnight.
    let time = match (input.time_start, input.time_duration) {
        _ if input.advance_mode == "completion" => None,
        (None, None) => None,
        (Some(start), Some(duration)) => {
            if !(0..24 * 60).contains(&start) {
                return Err(invalid("A track's start time has to be within the day."));
            }
            if duration < MIN_DURATION {
                return Err(invalid(format!("A track's time has to last at least {MIN_DURATION} minutes.")));
            }
            if start + duration > 24 * 60 {
                return Err(invalid("A track's time can't run past midnight."));
            }
            Some((start, duration))
        }
        _ => return Err(invalid("A track's time needs both a start and a length.")),
    };
    Ok(CleanTrack { name, drive, mode: input.advance_mode.clone(), weekdays: days.iter().map(u32::to_string).collect::<Vec<_>>().join(","), start, time })
}

const TRACK_COLUMNS: &str =
    "id, name, drive, advance_mode, loop_entries, source_drive_sequence, weekdays, start_date, archived, created_at, time_start, time_duration, cycle_offset, previous_start_date, previous_cycle_offset";

fn track_from_row(row: &rusqlite::Row) -> Result<CalendarTrack> {
    let weekdays: String = row.get(6)?;
    Ok(CalendarTrack {
        id: row.get(0)?,
        name: row.get(1)?,
        drive: row.get(2)?,
        advance_mode: row.get(3)?,
        loop_entries: row.get::<_, i64>(4)? != 0,
        source_drive_sequence: row.get::<_, i64>(5)? != 0,
        weekdays: weekdays.split(',').filter_map(|d| d.trim().parse().ok()).collect(),
        start_date: row.get(7)?,
        archived: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
        time_start: row.get(10)?,
        time_duration: row.get(11)?,
        cycle_offset: row.get(12)?,
        previous_start_date: row.get(13)?,
        previous_cycle_offset: row.get(14)?,
    })
}

/// "9:00" for 540 minutes after midnight.
fn fmt_time(minutes: i64) -> String {
    format!("{}:{:02}", minutes / 60, minutes % 60)
}

/// When a track's time slot is taken: its weekdays, its time window, and the dates it runs between (its start, to the end
/// of its last term; open-ended without terms, or with a term that comes back every year). None for a track without a time.
struct Slot {
    weekdays: HashSet<u32>,
    from: i64,
    to: i64,
    runs_from: NaiveDate,
    runs_to: Option<NaiveDate>,
}

fn slot_of(conn: &Connection, track: &CalendarTrack) -> Result<Option<Slot>> {
    let (Some(from), Some(duration)) = (track.time_start, track.time_duration) else { return Ok(None) };
    if track.advance_mode == "completion" || track.archived {
        return Ok(None);
    }
    let terms = load_terms(conn, track.id)?;
    let runs_to = if terms.is_empty() || terms.iter().any(|t| t.annual) {
        None
    } else {
        terms.iter().filter_map(|t| parse_date(&t.end_date).ok()).max()
    };
    Ok(Some(Slot {
        weekdays: track.weekdays.iter().copied().collect(),
        from,
        to: from + duration,
        runs_from: parse_date(&track.start_date).unwrap_or_else(|_| local_today()),
        runs_to,
    }))
}

/// Refuses a track whose time window would clash with another active track's: overlapping times (back to back is fine) on
/// a weekday they share, while both are running. Checked after a change is written, inside its transaction, so a clash
/// rolls the change back. (A make-up day from an included holiday set isn't counted: it's a one-off, not the schedule.)
fn ensure_no_clash(conn: &Connection, track_id: i64) -> Result<()> {
    let track = load_track(conn, track_id)?;
    let Some(mine) = slot_of(conn, &track)? else { return Ok(()) };
    let others: Vec<CalendarTrack> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT {TRACK_COLUMNS} FROM CalendarTracks WHERE archived = 0 AND id != ?1 AND time_start IS NOT NULL ORDER BY name COLLATE NOCASE"
        ))?;
        let rows = stmt.query_map(params![track_id], track_from_row)?;
        rows.collect::<Result<_>>()?
    };
    for other in others {
        let Some(theirs) = slot_of(conn, &other)? else { continue };
        let times_overlap = mine.from < theirs.to && theirs.from < mine.to;
        let shared_day = mine.weekdays.intersection(&theirs.weekdays).next().is_some();
        let both_running = theirs.runs_to.map_or(true, |end| mine.runs_from <= end) && mine.runs_to.map_or(true, |end| theirs.runs_from <= end);
        if times_overlap && shared_day && both_running {
            let days: Vec<&str> = WEEKDAY_NAMES.iter().enumerate().filter(|(i, _)| theirs.weekdays.contains(&(*i as u32 + 1))).map(|(_, n)| *n).collect();
            return Err(invalid(format!(
                "That time clashes with \"{}\" ({} {}–{}). Pick another time or other days.",
                other.name,
                days.join("/"),
                fmt_time(theirs.from),
                fmt_time(theirs.to),
            )));
        }
    }
    Ok(())
}

const WEEKDAY_NAMES: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

fn load_track(conn: &Connection, id: i64) -> Result<CalendarTrack> {
    conn.query_row(&format!("SELECT {TRACK_COLUMNS} FROM CalendarTracks WHERE id = ?1"), params![id], track_from_row)
        .optional()?
        .ok_or_else(|| invalid("That track doesn't exist any more."))
}

/// Refuses `name` when another active track (any but `except`) already has it, ignoring case. Track names are unique among
/// the tracks that aren't archived, since a name is all that tells them apart in the panel and on the week; an archived
/// track can share one (last year's "Data Structures" beside this year's).
fn ensure_name_free(conn: &Connection, name: &str, except: Option<i64>) -> Result<()> {
    let wanted = name.to_lowercase();
    let mut stmt = conn.prepare("SELECT id, name FROM CalendarTracks WHERE archived = 0")?;
    let taken = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .filter_map(|r| r.ok())
        .find(|(id, existing)| Some(*id) != except && existing.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase() == wanted);
    match taken {
        Some((_, existing)) => Err(invalid(format!("A track called \"{existing}\" already exists. Pick another name, or archive that one first."))),
        None => Ok(()),
    }
}

pub fn create_calendar_track(db_path: &str, input: &TrackInput) -> Result<i64> {
    let t = clean_track(input)?;
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    ensure_name_free(&tx, &t.name, None)?;
    tx.execute(
        "INSERT INTO CalendarTracks (name, drive, advance_mode, loop_entries, source_drive_sequence, weekdays, start_date, created_at, time_start, time_duration)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![t.name, t.drive, t.mode, input.loop_entries as i64, input.source_drive_sequence as i64, t.weekdays, t.start, now_stamp(),
            t.time.map(|(s, _)| s), t.time.map(|(_, d)| d)],
    )?;
    let id = tx.last_insert_rowid();
    ensure_no_clash(&tx, id)?;
    tx.commit()?;
    Ok(id)
}

pub fn update_calendar_track(db_path: &str, id: i64, input: &TrackInput) -> Result<()> {
    let t = clean_track(input)?;
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    // An archived track's name (and time) only has to be free once it's unarchived (set_calendar_track_archived checks then).
    if !load_track(&tx, id)?.archived {
        ensure_name_free(&tx, &t.name, Some(id))?;
    }
    // A new start date replaces what a Start over set, so there's no undoing that any more (it would put back a start
    // date from before this edit).
    tx.execute(
        "UPDATE CalendarTracks SET name = ?1, drive = ?2, advance_mode = ?3, loop_entries = ?4, source_drive_sequence = ?5,
             weekdays = ?6, start_date = ?7, time_start = ?8, time_duration = ?9,
             previous_start_date = CASE WHEN start_date = ?7 THEN previous_start_date END,
             previous_cycle_offset = CASE WHEN start_date = ?7 THEN previous_cycle_offset END
         WHERE id = ?10",
        params![t.name, t.drive, t.mode, input.loop_entries as i64, input.source_drive_sequence as i64, t.weekdays, t.start,
            t.time.map(|(s, _)| s), t.time.map(|(_, d)| d), id],
    )?;
    ensure_no_clash(&tx, id)?;
    tx.commit()
}

pub fn set_calendar_track_archived(db_path: &str, id: i64, archived: bool) -> Result<()> {
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    let track = load_track(&tx, id)?;
    // Coming back from the archive: its name and time mustn't clash with a track that's active now.
    if !archived && track.archived {
        ensure_name_free(&tx, &track.name, Some(id)).map_err(|_| {
            invalid(format!("An active track is already called \"{}\". Rename one of them first.", track.name))
        })?;
    }
    tx.execute("UPDATE CalendarTracks SET archived = ?1 WHERE id = ?2", params![archived as i64, id])?;
    ensure_no_clash(&tx, id)?;
    tx.commit()
}

pub fn delete_calendar_track(db_path: &str, id: i64) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute("DELETE FROM CalendarTracks WHERE id = ?1", params![id])?;
    Ok(())
}

// ── Entries ──────────────────────────────────────────────────────────────────────────────────────

/// The longest an entry's description can be, in characters.
const MAX_DESCRIPTION: usize = 2000;

/// An entry's priority: 0 none, 1 low, 2 medium, 3 high. Only a marker: it doesn't change the entry's place or day.
pub const MAX_PRIORITY: i64 = 3;

/// What an entry has besides its place: its icon (a name from the app's own set, like "tree-palm"; "" for the default), its
/// description, and its priority.
#[derive(Debug, Clone, Default)]
pub struct EntryExtras {
    pub icon: String,
    pub description: String,
    pub priority: i64,
}

/// `extras`, checked and tidied.
fn clean_extras(extras: &EntryExtras) -> Result<EntryExtras> {
    let icon = extras.icon.trim();
    if icon.len() > 40 || !icon.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(invalid(format!("'{icon}' isn't an icon name")));
    }
    let description = extras.description.trim();
    if description.chars().count() > MAX_DESCRIPTION {
        return Err(invalid(format!("A description can be at most {MAX_DESCRIPTION} characters.")));
    }
    if !(0..=MAX_PRIORITY).contains(&extras.priority) {
        return Err(invalid("A priority is none, low, medium or high."));
    }
    Ok(EntryExtras { icon: icon.to_string(), description: description.to_string(), priority: extras.priority })
}

/// Adds an entry to the end of a track: a video, or (with no video) a task with its label, with its icon, description and
/// priority. On a track that follows a Drive's sequence, this makes (or returns) the row for one of the sequence's videos,
/// to hold a label or completions.
pub fn add_calendar_entry(db_path: &str, track_id: i64, video_id: Option<&str>, label: &str, extras: &EntryExtras) -> Result<i64> {
    let EntryExtras { icon, description, priority } = clean_extras(extras)?;
    let conn = Connection::open(db_path)?;
    let track = load_track(&conn, track_id)?;
    let video_id = video_id.map(str::trim).filter(|v| !v.is_empty());
    let label = label.trim();
    if video_id.is_none() && label.is_empty() {
        return Err(invalid("An entry without a video needs a label."));
    }
    if let Some(v) = video_id {
        if let Some(id) = conn
            .query_row("SELECT id FROM CalendarEntries WHERE track_id = ?1 AND video_id = ?2", params![track_id, v], |r| r.get(0))
            .optional()?
        {
            if track.source_drive_sequence {
                return Ok(id);
            }
            return Err(invalid("That video is already in this track."));
        }
    } else if track.source_drive_sequence {
        return Err(invalid("A track that follows a Drive's sequence only holds that sequence's videos."));
    }
    let position: Option<i64> = if track.source_drive_sequence {
        None
    } else {
        Some(next_top_position(&conn, track_id)?)
    };
    conn.execute(
        "INSERT INTO CalendarEntries (track_id, video_id, label, position, icon, description, priority) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![track_id, video_id, label, position, icon, description, priority],
    )?;
    Ok(conn.last_insert_rowid())
}

/// The position after a track's last top-level entry (not counting what's inside folders).
fn next_top_position(conn: &Connection, track_id: i64) -> Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM CalendarEntries WHERE track_id = ?1 AND folder_id IS NULL",
        params![track_id],
        |r| r.get(0),
    )
}

/// Adds an empty folder to the end of a track: a named group whose entries share one place (one day, on a dated track).
/// Entries go into it by dragging (set_calendar_entry_layout). Not on a track that follows a Drive's sequence, whose order
/// is the sequence's.
pub fn add_calendar_folder(db_path: &str, track_id: i64, name: &str, extras: &EntryExtras) -> Result<i64> {
    let EntryExtras { icon, description, priority } = clean_extras(extras)?;
    let conn = Connection::open(db_path)?;
    if load_track(&conn, track_id)?.source_drive_sequence {
        return Err(invalid("A track that follows a Drive's sequence takes its order from the sequence, so it has no folders."));
    }
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("A folder needs a name."));
    }
    let position = next_top_position(&conn, track_id)?;
    conn.execute(
        "INSERT INTO CalendarEntries (track_id, video_id, label, position, icon, description, priority, is_folder) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, 1)",
        params![track_id, name, position, icon, description, priority],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_calendar_entry(db_path: &str, id: i64, label: &str, target_date: Option<&str>, extras: &EntryExtras) -> Result<()> {
    let EntryExtras { icon, description, priority } = clean_extras(extras)?;
    let target = match target_date.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => Some(fmt_date(parse_date(s)?)),
        None => None,
    };
    let conn = Connection::open(db_path)?;
    let (video_id,): (Option<String>,) = conn
        .query_row("SELECT video_id FROM CalendarEntries WHERE id = ?1", params![id], |r| Ok((r.get(0)?,)))
        .optional()?
        .ok_or_else(|| invalid("That entry doesn't exist any more."))?;
    if video_id.is_none() && label.trim().is_empty() {
        return Err(invalid("An entry without a video needs a label."));
    }
    conn.execute(
        "UPDATE CalendarEntries SET label = ?1, target_date = ?2, icon = ?3, description = ?4, priority = ?5 WHERE id = ?6",
        params![label.trim(), target, icon, description, priority, id],
    )?;
    Ok(())
}

/// Removes an entry. Removing a folder keeps what was in it: its entries take the folder's place, in their order.
pub fn remove_calendar_entry(db_path: &str, id: i64) -> Result<()> {
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    let found: Option<(i64, i64, Option<i64>)> = tx
        .query_row("SELECT track_id, is_folder, position FROM CalendarEntries WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?;
    if let Some((track_id, is_folder, position)) = found {
        if is_folder != 0 {
            let inside: Vec<i64> = {
                let mut stmt = tx.prepare("SELECT id FROM CalendarEntries WHERE folder_id = ?1 ORDER BY position, id")?;
                let rows = stmt.query_map(params![id], |r| r.get(0))?;
                rows.collect::<Result<_>>()?
            };
            let at = position.unwrap_or(0);
            let n = inside.len() as i64;
            // Make room after the folder, then put its entries there.
            tx.execute(
                "UPDATE CalendarEntries SET position = position + ?1 WHERE track_id = ?2 AND folder_id IS NULL AND position > ?3",
                params![n, track_id, at],
            )?;
            for (i, entry) in inside.iter().enumerate() {
                tx.execute("UPDATE CalendarEntries SET folder_id = NULL, position = ?1 WHERE id = ?2", params![at + 1 + i as i64, entry])?;
            }
        }
        tx.execute("DELETE FROM CalendarEntries WHERE id = ?1", params![id])?;
        renumber_entries(&tx, track_id)?;
    }
    tx.commit()
}

/// Numbers a track's positions 1 to N again: the top-level entries among themselves, and each folder's entries among
/// themselves.
fn renumber_entries(conn: &Connection, track_id: i64) -> Result<()> {
    let rows: Vec<(i64, Option<i64>)> = {
        let mut stmt = conn.prepare(
            "SELECT id, folder_id FROM CalendarEntries WHERE track_id = ?1 AND position IS NOT NULL ORDER BY position, id",
        )?;
        let rows = stmt.query_map(params![track_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_>>()?
    };
    let mut next: HashMap<Option<i64>, i64> = HashMap::new();
    for (id, folder) in rows {
        let n = next.entry(folder).or_insert(0);
        *n += 1;
        conn.execute("UPDATE CalendarEntries SET position = ?1 WHERE id = ?2", params![*n, id])?;
    }
    Ok(())
}

/// Puts a track's entries in a new order, keeping each in the folder it's in. `ordered` must list exactly its entries,
/// each once. (A track that follows a Drive's sequence is reordered by reordering the sequence.)
pub fn set_calendar_entry_order(db_path: &str, track_id: i64, ordered: &[i64]) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let folder_of: HashMap<i64, Option<i64>> = {
        let mut stmt = conn.prepare("SELECT id, folder_id FROM CalendarEntries WHERE track_id = ?1")?;
        let rows = stmt.query_map(params![track_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_>>()?
    };
    drop(conn);
    let layout: Vec<(i64, Option<i64>)> = ordered.iter().map(|id| (*id, folder_of.get(id).copied().flatten())).collect();
    set_calendar_entry_layout(db_path, track_id, &layout)
}

/// Lays a track's entries out anew: their order, and which folder (if any) each is in, as the panel's drag and drop
/// leaves them. `layout` lists every entry once, in reading order, each with its folder. A folder can't go in a folder
/// (one level only), and only a folder of this track can hold an entry.
pub fn set_calendar_entry_layout(db_path: &str, track_id: i64, layout: &[(i64, Option<i64>)]) -> Result<()> {
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    if load_track(&tx, track_id)?.source_drive_sequence {
        return Err(invalid("This track follows its Drive's sequence: reorder the sequence instead."));
    }
    let is_folder: HashMap<i64, bool> = {
        let mut stmt = tx.prepare("SELECT id, is_folder FROM CalendarEntries WHERE track_id = ?1")?;
        let rows = stmt.query_map(params![track_id], |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)))?;
        rows.collect::<Result<_>>()?
    };
    let wanted: HashSet<i64> = layout.iter().map(|(id, _)| *id).collect();
    let current: HashSet<i64> = is_folder.keys().copied().collect();
    if wanted.len() != layout.len() || wanted != current {
        return Err(invalid("The new order must list each entry in the track exactly once."));
    }
    let mut next: HashMap<Option<i64>, i64> = HashMap::new();
    for &(id, folder) in layout {
        if let Some(f) = folder {
            if is_folder[&id] {
                return Err(invalid("A folder can't go inside another folder."));
            }
            if !is_folder.get(&f).copied().unwrap_or(false) {
                return Err(invalid("An entry can only go in one of this track's folders."));
            }
        }
        let n = next.entry(folder).or_insert(0);
        *n += 1;
        tx.execute("UPDATE CalendarEntries SET position = ?1, folder_id = ?2 WHERE id = ?3", params![*n, folder, id])?;
    }
    tx.commit()
}

/// Marks an entry done (or not) in a given loop `cycle`. A track that follows a Drive's sequence can name the entry by
/// its video, which gets its row now if it has none yet.
pub fn set_calendar_completion(db_path: &str, track_id: i64, entry_id: Option<i64>, video_id: Option<&str>, cycle: i64, done: bool) -> Result<()> {
    let entry_id = match (entry_id.filter(|&id| id > 0), video_id) {
        (Some(id), _) => id,
        (None, Some(v)) => add_calendar_entry(db_path, track_id, Some(v), "", &EntryExtras::default())?,
        (None, None) => return Err(invalid("Say which entry to mark.")),
    };
    let conn = Connection::open(db_path)?;
    let belongs: bool = conn
        .query_row("SELECT 1 FROM CalendarEntries WHERE id = ?1 AND track_id = ?2", params![entry_id, track_id], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if !belongs {
        return Err(invalid("That entry isn't in this track."));
    }
    // A folder isn't marked itself: marking it marks everything in it.
    let targets: Vec<i64> = if is_folder_entry(&conn, entry_id)? {
        let mut stmt = conn.prepare("SELECT id FROM CalendarEntries WHERE folder_id = ?1")?;
        let inside: Vec<i64> = stmt.query_map(params![entry_id], |r| r.get(0))?.collect::<Result<_>>()?;
        if inside.is_empty() {
            return Err(invalid("This folder is empty: drag videos or tasks into it first."));
        }
        inside
    } else {
        vec![entry_id]
    };
    let stamp = now_stamp();
    for id in targets {
        if done {
            conn.execute(
                "INSERT OR IGNORE INTO CalendarCompletions (entry_id, cycle, completed_at) VALUES (?1, ?2, ?3)",
                params![id, cycle.max(0), stamp],
            )?;
            // Done is past In progress.
            conn.execute("DELETE FROM CalendarProgress WHERE entry_id = ?1 AND cycle = ?2", params![id, cycle.max(0)])?;
        } else {
            conn.execute("DELETE FROM CalendarCompletions WHERE entry_id = ?1 AND cycle = ?2", params![id, cycle.max(0)])?;
        }
    }
    Ok(())
}

fn is_folder_entry(conn: &Connection, id: i64) -> Result<bool> {
    Ok(conn.query_row("SELECT is_folder FROM CalendarEntries WHERE id = ?1", params![id], |r| r.get::<_, i64>(0))
        .optional()?
        .unwrap_or(0)
        != 0)
}

/// Marks a video done on every active track it's on and isn't done on yet, in each track's current cycle (Continue
/// Watching's Mark as Completed). A video in a Drive's sequence with no row of its own gets one. Returns how many
/// entries it marked.
pub fn complete_video_on_tracks(db_path: &str, video_id: &str, today: NaiveDate) -> Result<usize> {
    let conn = Connection::open(db_path)?;
    let tracks: Vec<CalendarTrack> = {
        let mut stmt = conn.prepare(&format!("SELECT {TRACK_COLUMNS} FROM CalendarTracks WHERE archived = 0 ORDER BY id"))?;
        let rows = stmt.query_map([], track_from_row)?;
        rows.collect::<Result<_>>()?
    };
    let mut to_mark = Vec::new();
    for track in &tracks {
        let state = resolve(&conn, track, today)?;
        for e in state.entries.iter().filter(|e| e.video_id.as_deref() == Some(video_id) && !e.done) {
            to_mark.push((track.id, (e.id > 0).then_some(e.id), state.cycle));
        }
    }
    drop(conn);
    for (track_id, entry_id, cycle) in &to_mark {
        set_calendar_completion(db_path, *track_id, *entry_id, Some(video_id), *cycle, true)?;
    }
    Ok(to_mark.len())
}

/// Marks an entry In progress in `cycle`, or takes the mark off: started but not finished. Like a check-off, a video in a
/// Drive's sequence with no row of its own gets one, and it's allowed in a read-only workspace (the reader's own). Only a
/// marker: it doesn't move the track along. An entry already done in that cycle can't be put back to In progress.
pub fn set_calendar_progress(db_path: &str, track_id: i64, entry_id: Option<i64>, video_id: Option<&str>, cycle: i64, on: bool) -> Result<()> {
    let entry_id = match (entry_id.filter(|&id| id > 0), video_id) {
        (Some(id), _) => id,
        (None, Some(v)) => add_calendar_entry(db_path, track_id, Some(v), "", &EntryExtras::default())?,
        (None, None) => return Err(invalid("Say which entry to mark.")),
    };
    let conn = Connection::open(db_path)?;
    let belongs: bool = conn
        .query_row("SELECT 1 FROM CalendarEntries WHERE id = ?1 AND track_id = ?2", params![entry_id, track_id], |_| Ok(true))
        .optional()?
        .unwrap_or(false);
    if !belongs {
        return Err(invalid("That entry isn't in this track."));
    }
    if is_folder_entry(&conn, entry_id)? {
        return Err(invalid("A folder shows In progress by itself, once something in it is started or done."));
    }
    if on {
        let done = conn
            .query_row("SELECT 1 FROM CalendarCompletions WHERE entry_id = ?1 AND cycle = ?2", params![entry_id, cycle.max(0)], |_| Ok(()))
            .optional()?
            .is_some();
        if done {
            return Err(invalid("That's done already. Uncheck it first."));
        }
        conn.execute(
            "INSERT OR IGNORE INTO CalendarProgress (entry_id, cycle, started_at) VALUES (?1, ?2, ?3)",
            params![entry_id, cycle.max(0), now_stamp()],
        )?;
    } else {
        conn.execute("DELETE FROM CalendarProgress WHERE entry_id = ?1 AND cycle = ?2", params![entry_id, cycle.max(0)])?;
    }
    Ok(())
}

/// Which (entry, cycle) pairs of a track are marked In progress.
fn load_progress(conn: &Connection, track_id: i64) -> Result<HashSet<(i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT p.entry_id, p.cycle FROM CalendarProgress p JOIN CalendarEntries e ON e.id = p.entry_id WHERE e.track_id = ?1",
    )?;
    let rows = stmt.query_map(params![track_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    rows.collect()
}

// ── Terms and holidays ───────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarTerm {
    pub id: i64,
    pub track_id: i64,
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    /// The same months every year (only the month and day of its dates count).
    pub annual: bool,
}

pub fn add_calendar_term(db_path: &str, track_id: i64, name: &str, start: &str, end: &str, annual: bool) -> Result<i64> {
    let (s, e) = (parse_date(start)?, parse_date(end)?);
    if !annual && e < s {
        return Err(invalid("A term can't end before it starts."));
    }
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    load_track(&tx, track_id)?;
    tx.execute(
        "INSERT INTO CalendarTerms (track_id, name, start_date, end_date, annual) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![track_id, name.trim(), fmt_date(s), fmt_date(e), annual as i64],
    )?;
    let id = tx.last_insert_rowid();
    // A term changes when the track runs, which can bring its time up against another's.
    ensure_no_clash(&tx, track_id)?;
    tx.commit()?;
    Ok(id)
}

pub fn remove_calendar_term(db_path: &str, id: i64) -> Result<()> {
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    let track_id: Option<i64> = tx.query_row("SELECT track_id FROM CalendarTerms WHERE id = ?1", params![id], |r| r.get(0)).optional()?;
    tx.execute("DELETE FROM CalendarTerms WHERE id = ?1", params![id])?;
    if let Some(track_id) = track_id {
        ensure_no_clash(&tx, track_id)?;
    }
    tx.commit()
}

fn load_terms(conn: &Connection, track_id: i64) -> Result<Vec<CalendarTerm>> {
    let mut stmt = conn.prepare("SELECT id, track_id, name, start_date, end_date, annual FROM CalendarTerms WHERE track_id = ?1 ORDER BY start_date, id")?;
    let rows = stmt.query_map(params![track_id], |r| {
        Ok(CalendarTerm { id: r.get(0)?, track_id: r.get(1)?, name: r.get(2)?, start_date: r.get(3)?, end_date: r.get(4)?, annual: r.get::<_, i64>(5)? != 0 })
    })?;
    rows.collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolidayDate {
    pub date: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolidaySet {
    pub id: i64,
    pub name: String,
    /// Its dates recur every year (only their month and day count).
    pub annual: bool,
    /// "us_federal" for the built-in set, "" for one made by hand.
    pub builtin: String,
    /// The set's dates. For the built-in set, the given year's.
    pub dates: Vec<HolidayDate>,
}

/// Every holiday set, the built-in one first, its dates shown for `year`.
pub fn list_calendar_holiday_sets(db_path: &str, year: i32) -> Result<Vec<HolidaySet>> {
    let conn = Connection::open(db_path)?;
    let mut sets: Vec<HolidaySet> = {
        let mut stmt = conn.prepare("SELECT id, name, annual, builtin FROM CalendarHolidaySets ORDER BY builtin = '', name COLLATE NOCASE, id")?;
        let rows = stmt.query_map([], |r| Ok(HolidaySet { id: r.get(0)?, name: r.get(1)?, annual: r.get::<_, i64>(2)? != 0, builtin: r.get(3)?, dates: vec![] }))?;
        rows.collect::<Result<_>>()?
    };
    for set in &mut sets {
        set.dates = if set.builtin == US_FEDERAL {
            us_federal_holidays(year).into_iter().map(|(d, name)| HolidayDate { date: fmt_date(d), name: name.to_string() }).collect()
        } else {
            let mut stmt = conn.prepare("SELECT date, name FROM CalendarHolidayDates WHERE set_id = ?1 ORDER BY date")?;
            let rows = stmt.query_map(params![set.id], |r| Ok(HolidayDate { date: r.get(0)?, name: r.get(1)? }))?;
            rows.collect::<Result<_>>()?
        };
    }
    Ok(sets)
}

pub fn create_calendar_holiday_set(db_path: &str, name: &str, annual: bool) -> Result<i64> {
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("A holiday set needs a name."));
    }
    let conn = Connection::open(db_path)?;
    conn.execute("INSERT INTO CalendarHolidaySets (name, annual) VALUES (?1, ?2)", params![name, annual as i64])?;
    Ok(conn.last_insert_rowid())
}

fn is_builtin_set(conn: &Connection, set_id: i64) -> Result<bool> {
    let builtin: Option<String> = conn.query_row("SELECT builtin FROM CalendarHolidaySets WHERE id = ?1", params![set_id], |r| r.get(0)).optional()?;
    match builtin {
        None => Err(invalid("That holiday set doesn't exist any more.")),
        Some(b) => Ok(!b.is_empty()),
    }
}

pub fn delete_calendar_holiday_set(db_path: &str, set_id: i64) -> Result<()> {
    let conn = Connection::open(db_path)?;
    if is_builtin_set(&conn, set_id)? {
        return Err(invalid("The built-in holiday set can't be deleted."));
    }
    conn.execute("DELETE FROM CalendarHolidaySets WHERE id = ?1", params![set_id])?;
    Ok(())
}

pub fn add_calendar_holiday_date(db_path: &str, set_id: i64, date: &str, name: &str) -> Result<()> {
    let d = parse_date(date)?;
    let conn = Connection::open(db_path)?;
    if is_builtin_set(&conn, set_id)? {
        return Err(invalid("The built-in holiday set's dates are worked out automatically."));
    }
    conn.execute(
        "INSERT INTO CalendarHolidayDates (set_id, date, name) VALUES (?1, ?2, ?3)
         ON CONFLICT (set_id, date) DO UPDATE SET name = excluded.name",
        params![set_id, fmt_date(d), name.trim()],
    )?;
    Ok(())
}

pub fn remove_calendar_holiday_date(db_path: &str, set_id: i64, date: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute("DELETE FROM CalendarHolidayDates WHERE set_id = ?1 AND date = ?2", params![set_id, date.trim()])?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolidayRule {
    pub set_id: i64,
    /// "exclude" or "include".
    pub mode: String,
}

/// Has a track exclude or include a holiday set, or (with `mode` None) neither.
pub fn set_calendar_track_holiday_rule(db_path: &str, track_id: i64, set_id: i64, mode: Option<&str>) -> Result<()> {
    let conn = Connection::open(db_path)?;
    load_track(&conn, track_id)?;
    is_builtin_set(&conn, set_id)?;
    match mode {
        None => {
            conn.execute("DELETE FROM CalendarTrackHolidayRules WHERE track_id = ?1 AND set_id = ?2", params![track_id, set_id])?;
        }
        Some(m @ ("exclude" | "include")) => {
            conn.execute(
                "INSERT INTO CalendarTrackHolidayRules (track_id, set_id, mode) VALUES (?1, ?2, ?3)
                 ON CONFLICT (track_id, set_id) DO UPDATE SET mode = excluded.mode",
                params![track_id, set_id, m],
            )?;
        }
        Some(other) => return Err(invalid(format!("'{other}' isn't exclude or include"))),
    }
    Ok(())
}

fn load_rules(conn: &Connection, track_id: i64) -> Result<Vec<HolidayRule>> {
    let mut stmt = conn.prepare("SELECT set_id, mode FROM CalendarTrackHolidayRules WHERE track_id = ?1 ORDER BY set_id")?;
    let rows = stmt.query_map(params![track_id], |r| Ok(HolidayRule { set_id: r.get(0)?, mode: r.get(1)? }))?;
    rows.collect()
}

// ── The schedule ─────────────────────────────────────────────────────────────────────────────────

/// A holiday set's dates, as the schedule checks them.
enum SetDates {
    UsFederal,
    Fixed(HashSet<NaiveDate>),
    /// (month, day)
    Annual(HashSet<(u32, u32)>),
}

impl SetDates {
    fn contains(&self, d: NaiveDate) -> bool {
        match self {
            SetDates::UsFederal => is_us_federal_holiday(d),
            SetDates::Fixed(dates) => dates.contains(&d),
            SetDates::Annual(days) => days.contains(&(d.month(), d.day())),
        }
    }
}

/// Which days a track's schedule lands on.
struct Schedule {
    start: NaiveDate,
    weekdays: HashSet<u32>,
    /// (start, end, annual)
    terms: Vec<(NaiveDate, NaiveDate, bool)>,
    exclude: Vec<SetDates>,
    include: Vec<SetDates>,
}

impl Schedule {
    fn load(conn: &Connection, track: &CalendarTrack) -> Result<Schedule> {
        let terms = load_terms(conn, track.id)?
            .iter()
            .filter_map(|t| Some((parse_date(&t.start_date).ok()?, parse_date(&t.end_date).ok()?, t.annual)))
            .collect();
        let (mut exclude, mut include) = (Vec::new(), Vec::new());
        for rule in load_rules(conn, track.id)? {
            let set: Option<(i64, String)> = conn
                .query_row("SELECT annual, builtin FROM CalendarHolidaySets WHERE id = ?1", params![rule.set_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?;
            let Some((annual, builtin)) = set else { continue };
            let dates = if builtin == US_FEDERAL {
                SetDates::UsFederal
            } else {
                let mut stmt = conn.prepare("SELECT date FROM CalendarHolidayDates WHERE set_id = ?1")?;
                let days: Vec<NaiveDate> = stmt.query_map(params![rule.set_id], |r| r.get::<_, String>(0))?
                    .filter_map(|r| r.ok().and_then(|s| parse_date(&s).ok()))
                    .collect();
                if annual != 0 {
                    SetDates::Annual(days.iter().map(|d| (d.month(), d.day())).collect())
                } else {
                    SetDates::Fixed(days.into_iter().collect())
                }
            };
            if rule.mode == "include" { include.push(dates) } else { exclude.push(dates) }
        }
        Ok(Schedule {
            start: parse_date(&track.start_date).unwrap_or_else(|_| local_today()),
            weekdays: track.weekdays.iter().copied().collect(),
            terms,
            exclude,
            include,
        })
    }

    fn in_terms(&self, d: NaiveDate) -> bool {
        if self.terms.is_empty() {
            return true;
        }
        self.terms.iter().any(|&(s, e, annual)| {
            if !annual {
                return s <= d && d <= e;
            }
            let (x, a, b) = ((d.month(), d.day()), (s.month(), s.day()), (e.month(), e.day()));
            // A window can run over the new year (November to February).
            if a <= b { a <= x && x <= b } else { x >= a || x <= b }
        })
    }

    /// Whether `d` is a day on the schedule.
    fn has(&self, d: NaiveDate) -> bool {
        if d < self.start {
            return false;
        }
        if self.include.iter().any(|s| s.contains(d)) {
            return true;
        }
        self.weekdays.contains(&d.weekday().number_from_monday()) && self.in_terms(d) && !self.exclude.iter().any(|s| s.contains(d))
    }

    /// The schedule's days, in order, from its start.
    fn days(&self) -> impl Iterator<Item = NaiveDate> + '_ {
        (0..MAX_SCHEDULE_DAYS).map(move |i| self.start + Duration::days(i)).filter(move |d| self.has(*d))
    }
}

// ── Where a track stands ─────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    /// 0 for a video in a Drive's sequence that has no row of its own yet.
    pub id: i64,
    pub video_id: Option<String>,
    pub label: String,
    /// What to call it: its label, else its video's title, else its video's id.
    pub title: String,
    pub target_date: Option<String>,
    /// Its icon, a name from the app's own set ("palm-tree"); "" for the default (a video's, or a task's).
    pub icon: String,
    pub description: String,
    /// 0 none, 1 low, 2 medium, 3 high.
    pub priority: i64,
    /// Marked done in the track's current cycle.
    pub done: bool,
    /// Marked In progress in the current cycle (and not done).
    pub in_progress: bool,
    /// The day the schedule gives it in the current cycle (dated tracks only).
    pub due_date: Option<String>,
    /// A folder: a group of the entries after it (theirs is `folder_id`), sharing one place. Its `done` is all of them
    /// done; its `in_progress`, some of them started or done but not all.
    pub is_folder: bool,
    /// The folder it's in, if it's in one.
    pub folder_id: Option<i64>,
    /// Its place among the track's videos and tasks, from 1 ("4 of 12"); 0 for a folder.
    pub place: i64,
}

/// The track's slots, in order: an entry on its own, or a folder followed by what's in it (indices into `entries`, which
/// load_entries lays out that way). A dated track gives each slot one day.
fn slots(entries: &[EntryView]) -> Vec<Vec<usize>> {
    let mut out: Vec<Vec<usize>> = Vec::new();
    for (i, e) in entries.iter().enumerate() {
        match (e.folder_id, out.last_mut()) {
            (Some(f), Some(last)) if entries[last[0]].is_folder && entries[last[0]].id == f => last.push(i),
            _ => out.push(vec![i]),
        }
    }
    out
}

/// Of a slot, the videos and tasks (not the folder itself).
fn items_of<'a>(entries: &'a [EntryView], slot: &'a [usize]) -> impl Iterator<Item = usize> + 'a {
    slot.iter().copied().filter(move |&i| !entries[i].is_folder)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackState {
    pub entries: Vec<EntryView>,
    /// Which entry is up (an index into `entries`), or none once a track that doesn't loop is finished (or is empty).
    pub current: Option<usize>,
    /// Hybrid: the entry that's up is past its day and still not done.
    pub current_overdue: bool,
    /// Hybrid and calendar: the entry that's up hasn't reached its day yet.
    pub current_waiting: bool,
    pub current_due: Option<String>,
    /// Dated tracks: the schedule's next day after today.
    pub next_date: Option<String>,
    /// How far through the current cycle it is: videos and tasks done (or, on a calendar track, already behind it).
    pub done: i64,
    /// How many videos and tasks the track has (folders aren't counted, what's in them is).
    pub total: i64,
    /// The cycle completions are marked under right now (what set_calendar_completion is given). It counts on from the
    /// track's `cycle_offset`, so after a Start over it isn't 0: use `round` to show which time through the list this is.
    pub cycle: i64,
    /// Which time through the list the current run is on (0 the first): `cycle` less the track's `cycle_offset`.
    pub round: i64,
    pub finished: bool,
    /// Whether its last Start over can be undone: it's saved where it stood before, and nothing's been marked done in the
    /// run since (undoing then would leave those marks in a cycle the old run hasn't reached).
    pub can_undo_start_over: bool,
}

/// Whether a track's last Start over can be undone (see TrackState's `can_undo_start_over`), given its completions' cycles.
fn start_over_undoable(track: &CalendarTrack, mut cycles: impl Iterator<Item = i64>) -> bool {
    track.previous_start_date.is_some() && track.previous_cycle_offset.is_some() && !cycles.any(|c| c >= track.cycle_offset)
}

fn load_entries(conn: &Connection, track: &CalendarTrack) -> Result<Vec<EntryView>> {
    // An entry's own fields (id, label, target date, icon, description, priority), as read from its row.
    type Own = (i64, String, Option<String>, String, String, i64);
    let view = |video_id: Option<String>, video_title: Option<String>, (id, label, target_date, icon, description, priority): Own| {
        let title = if !label.is_empty() { label.clone() } else { video_title.or_else(|| video_id.clone()).unwrap_or_default() };
        EntryView {
            id, video_id, label, title, target_date, icon, description, priority,
            done: false, in_progress: false, due_date: None, is_folder: false, folder_id: None, place: 0,
        }
    };
    // Numbers the videos and tasks 1, 2, 3... (folders get 0).
    let number = |mut list: Vec<EntryView>| {
        let mut n = 0;
        for e in list.iter_mut().filter(|e| !e.is_folder) {
            n += 1;
            e.place = n;
        }
        list
    };
    if !track.source_drive_sequence {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.video_id, e.label, v.title, e.target_date, e.icon, e.description, e.priority, e.is_folder, e.folder_id
             FROM CalendarEntries e LEFT JOIN Videos v ON v.video_id = e.video_id
             WHERE e.track_id = ?1
             ORDER BY e.position IS NULL, e.position, e.id",
        )?;
        let rows: Vec<EntryView> = stmt
            .query_map(params![track.id], |r| {
                let mut e = view(r.get(1)?, r.get(3)?, (r.get(0)?, r.get(2)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?));
                e.is_folder = r.get::<_, i64>(8)? != 0;
                e.folder_id = r.get(9)?;
                Ok(e)
            })?
            .collect::<Result<_>>()?;
        // Laid out as the track reads: each top-level entry in order, a folder followed by what's in it. An entry whose
        // folder is gone counts as top-level.
        let folders: HashSet<i64> = rows.iter().filter(|e| e.is_folder).map(|e| e.id).collect();
        let (mut top, mut inside): (Vec<EntryView>, HashMap<i64, Vec<EntryView>>) = (Vec::new(), HashMap::new());
        for mut e in rows {
            match e.folder_id.filter(|f| folders.contains(f) && !e.is_folder) {
                Some(f) => inside.entry(f).or_default().push(e),
                None => {
                    e.folder_id = None;
                    top.push(e);
                }
            }
        }
        let mut laid = Vec::new();
        for e in top {
            let id = e.id;
            let folder = e.is_folder;
            laid.push(e);
            if folder {
                laid.extend(inside.remove(&id).unwrap_or_default());
            }
        }
        return Ok(number(laid));
    }
    // Live off the Drive's sequence, with any row of its own for a video layered on.
    let mut own: HashMap<String, Own> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, video_id, label, target_date, icon, description, priority FROM CalendarEntries WHERE track_id = ?1 AND video_id IS NOT NULL",
        )?;
        let rows = stmt.query_map(params![track.id], |r| {
            Ok((r.get::<_, String>(1)?, (r.get(0)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))
        })?;
        for row in rows {
            let (video, data) = row?;
            own.insert(video, data);
        }
    }
    let path = conn.path().unwrap_or_default().to_string();
    let sequence = get_drive_sequence(&path, &track.drive).unwrap_or_default();
    Ok(number(
        sequence
            .into_iter()
            .map(|s| {
                let fields = own.remove(&s.video_id).unwrap_or((0, String::new(), None, String::new(), String::new(), 0));
                view(Some(s.video_id), Some(s.title), fields)
            })
            .collect(),
    ))
}

/// Where a track stands on `today`. (The app reads it through list_calendar_tracks / get_calendar_track.)
#[cfg(test)]
pub fn resolve_track(db_path: &str, track_id: i64, today: NaiveDate) -> Result<TrackState> {
    let conn = Connection::open(db_path)?;
    let track = load_track(&conn, track_id)?;
    resolve(&conn, &track, today)
}

fn resolve(conn: &Connection, track: &CalendarTrack, today: NaiveDate) -> Result<TrackState> {
    let mut entries = load_entries(conn, track)?;
    let slots = slots(&entries);
    let n_slots = slots.len() as i64;
    // Which slot each entry is in.
    let slot_of: Vec<usize> = {
        let mut of = vec![0; entries.len()];
        for (s, slot) in slots.iter().enumerate() {
            for &i in slot {
                of[i] = s;
            }
        }
        of
    };
    let total = entries.iter().filter(|e| !e.is_folder).count() as i64;
    let completions: HashSet<(i64, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT c.entry_id, c.cycle FROM CalendarCompletions c JOIN CalendarEntries e ON e.id = c.entry_id WHERE e.track_id = ?1",
        )?;
        let rows = stmt.query_map(params![track.id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_>>()?
    };
    let is_done = |e: &EntryView, cycle: i64| e.id > 0 && completions.contains(&(e.id, cycle));
    // A slot is done once everything in it is (an empty folder has nothing to do).
    let slot_done = |entries: &[EntryView], slot: &[usize], cycle: i64| items_of(entries, slot).all(|i| is_done(&entries[i], cycle));
    // The entry a slot puts up: its first video or task not done, else its first one, else (an empty folder) the folder.
    let lead = |entries: &[EntryView], slot: &[usize], cycle: i64| {
        items_of(entries, slot).find(|&i| !is_done(&entries[i], cycle)).or_else(|| items_of(entries, slot).next()).unwrap_or(slot[0])
    };
    let mut state = TrackState {
        entries: vec![],
        current: None,
        current_overdue: false,
        current_waiting: false,
        current_due: None,
        next_date: None,
        done: 0,
        total,
        cycle: track.cycle_offset,
        round: 0,
        finished: false,
        can_undo_start_over: start_over_undoable(track, completions.iter().map(|&(_, c)| c)),
    };
    if n_slots == 0 {
        state.entries = entries;
        return Ok(state);
    }

    let dated = track.advance_mode != "completion";
    let schedule = if dated { Some(Schedule::load(conn, track)?) } else { None };
    // The current run's cycles count on from here (see CalendarTrack::cycle_offset).
    let offset = track.cycle_offset;
    // How many videos and tasks are in the slots before slot `s`.
    let items_before = |s: usize| slots[..s].iter().map(|slot| items_of(&entries, slot).count()).sum::<usize>() as i64;

    if track.advance_mode == "calendar" {
        let schedule = schedule.as_ref().expect("dated");
        // The nth day so far is the nth slot's; before the first day, the first slot is still the one coming up.
        let so_far = schedule.days().take_while(|d| *d <= today).count() as i64;
        let k = (so_far - 1).max(0);
        if !track.loop_entries && so_far > n_slots {
            state.finished = true;
            state.done = total;
            state.cycle = offset;
        } else {
            state.cycle = offset + k / n_slots;
            let s = (k % n_slots) as usize;
            state.current = Some(lead(&entries, &slots[s], state.cycle));
            state.done = items_before(s);
            state.current_waiting = so_far == 0;
        }
    } else {
        // Completion and hybrid: the first slot not done in the current cycle is up (in a folder, its first video or task
        // not done); a looping track moves on to the next cycle once every slot in this one is done.
        let mut cycle = offset;
        if track.loop_entries && total > 0 {
            let max_cycle = completions.iter().map(|&(_, c)| c).max().unwrap_or(offset);
            while cycle <= max_cycle && slots.iter().all(|slot| slot_done(&entries, slot, cycle)) {
                cycle += 1;
            }
        }
        state.cycle = cycle;
        state.current = slots.iter().find(|slot| !slot_done(&entries, slot, cycle)).map(|slot| lead(&entries, slot, cycle));
        state.done = entries.iter().filter(|e| !e.is_folder && is_done(e, cycle)).count() as i64;
        state.finished = state.current.is_none();
    }

    state.round = state.cycle - offset;
    let progress = load_progress(conn, track.id)?;
    for e in entries.iter_mut().filter(|e| !e.is_folder) {
        e.done = is_done(e, state.cycle);
        e.in_progress = !e.done && e.id > 0 && progress.contains(&(e.id, state.cycle));
    }
    // A folder: done once all it holds is; in progress while some of it is started or done but not all.
    for slot in &slots {
        let folder = slot[0];
        if !entries[folder].is_folder {
            continue;
        }
        let items: Vec<usize> = items_of(&entries, slot).collect();
        let all = !items.is_empty() && items.iter().all(|&i| entries[i].done);
        let some = items.iter().any(|&i| entries[i].done || entries[i].in_progress);
        entries[folder].done = all;
        entries[folder].in_progress = !all && some;
    }
    if let Some(schedule) = &schedule {
        // Each slot's day this round: the (round * slots + s + 1)th day of the schedule (which starts with the run). All of
        // a folder's entries have its day.
        let first = (state.round * n_slots) as usize;
        let days: Vec<NaiveDate> = schedule.days().skip(first).take(n_slots as usize).collect();
        for (i, e) in entries.iter_mut().enumerate() {
            e.due_date = days.get(slot_of[i]).map(|d| fmt_date(*d));
        }
        state.next_date = schedule.days().find(|d| *d > today).map(fmt_date);
        if let Some(i) = state.current {
            let due = days.get(slot_of[i]).copied();
            state.current_due = due.map(fmt_date);
            if track.advance_mode == "hybrid" {
                match due {
                    Some(d) => {
                        state.current_overdue = d < today;
                        state.current_waiting = d > today;
                    }
                    // No day left on the schedule for it (its terms are over).
                    None => state.current_waiting = true,
                }
            }
        }
    }
    state.entries = entries;
    Ok(state)
}

// ── What's on each day ───────────────────────────────────────────────────────────────────────────

/// One thing on one day of the Calendar's week (or month, or timeline).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayItem {
    pub track_id: i64,
    pub date: String,
    /// 0 for a video in a Drive's sequence with no row of its own yet (it's named by `video_id` then).
    pub entry_id: i64,
    pub video_id: Option<String>,
    pub title: String,
    /// Its icon, description and priority (see EntryView).
    pub icon: String,
    pub description: String,
    pub priority: i64,
    /// The cycle it's in (what marking it done is given): see TrackState's `cycle`.
    pub cycle: i64,
    pub done: bool,
    /// Marked In progress in its cycle (and not done).
    pub in_progress: bool,
    /// Hybrid: its day has passed and it still isn't done. (A calendar track moves on regardless, so nothing on it is
    /// ever overdue.)
    pub overdue: bool,
    /// "scheduled": the day the schedule gives it. "completed": an undated track's entry, on the day it was done.
    pub kind: &'static str,
    /// The folder it's in (its id and name), so the week can label a day's group. An empty folder is an item itself, so
    /// its day shows it: then `is_folder`.
    pub folder_id: Option<i64>,
    pub folder: Option<String>,
    pub is_folder: bool,
}

/// Everything on the days `from`..=`to` across every track that isn't archived: a dated track's entries on their
/// scheduled days (every cycle, not just the current one), and an undated track's entries on the days they were done.
pub fn list_calendar_days(db_path: &str, from: NaiveDate, to: NaiveDate, today: NaiveDate) -> Result<Vec<DayItem>> {
    let conn = Connection::open(db_path)?;
    let tracks: Vec<CalendarTrack> = {
        let mut stmt = conn.prepare(&format!("SELECT {TRACK_COLUMNS} FROM CalendarTracks WHERE archived = 0 ORDER BY id"))?;
        let rows = stmt.query_map([], track_from_row)?;
        rows.collect::<Result<_>>()?
    };
    let mut items = Vec::new();
    for track in &tracks {
        items.extend(track_days(&conn, track, from, to, today)?);
    }
    items.sort_by(|a, b| a.date.cmp(&b.date).then(a.track_id.cmp(&b.track_id)));
    Ok(items)
}

fn track_days(conn: &Connection, track: &CalendarTrack, from: NaiveDate, to: NaiveDate, today: NaiveDate) -> Result<Vec<DayItem>> {
    let entries = load_entries(conn, track)?;
    let slots = slots(&entries);
    let n_slots = slots.len();
    if n_slots == 0 || to < from {
        return Ok(vec![]);
    }
    let folder_name: HashMap<i64, String> = entries.iter().filter(|e| e.is_folder).map(|e| (e.id, e.title.clone())).collect();
    // When each entry was done, by (entry, cycle).
    let done_on: HashMap<(i64, i64), String> = {
        let mut stmt = conn.prepare(
            "SELECT c.entry_id, c.cycle, c.completed_at FROM CalendarCompletions c JOIN CalendarEntries e ON e.id = c.entry_id WHERE e.track_id = ?1",
        )?;
        let rows = stmt.query_map(params![track.id], |r| Ok(((r.get(0)?, r.get(1)?), r.get::<_, String>(2)?)))?;
        rows.collect::<Result<_>>()?
    };
    let progress = load_progress(conn, track.id)?;
    let item = |e: &EntryView, date: NaiveDate, cycle: i64, kind: &'static str| {
        let done = e.id > 0 && done_on.contains_key(&(e.id, cycle));
        let in_progress = !done && e.id > 0 && progress.contains(&(e.id, cycle));
        DayItem {
            track_id: track.id,
            date: fmt_date(date),
            entry_id: e.id,
            video_id: e.video_id.clone(),
            title: e.title.clone(),
            icon: e.icon.clone(),
            description: e.description.clone(),
            priority: e.priority,
            cycle,
            done,
            in_progress,
            overdue: track.advance_mode == "hybrid" && !done && !e.is_folder && date < today,
            kind,
            folder_id: e.folder_id,
            folder: e.folder_id.and_then(|f| folder_name.get(&f).cloned()),
            is_folder: e.is_folder,
        }
    };

    // Entries done in the cycles `keep` accepts, each on the day it was done.
    let by_id: HashMap<i64, &EntryView> = entries.iter().filter(|e| e.id > 0).map(|e| (e.id, e)).collect();
    let on_done_days = |keep: &dyn Fn(i64) -> bool| -> Vec<DayItem> {
        let mut out = Vec::new();
        for ((entry_id, cycle), at) in &done_on {
            let Some(e) = by_id.get(entry_id) else { continue };
            let Ok(day) = NaiveDate::parse_from_str(at.get(..10).unwrap_or(""), "%Y-%m-%d") else { continue };
            if keep(*cycle) && (from..=to).contains(&day) {
                out.push(item(e, day, *cycle, "completed"));
            }
        }
        out
    };

    if track.advance_mode == "completion" {
        // No schedule: an entry shows on the day it was done.
        return Ok(on_done_days(&|_| true));
    }

    // Dated: the kth day of the schedule is slot k mod slots's, in cycle offset + k / slots (the schedule starts with the
    // current run): an entry on its own, or everything in a folder (an empty folder shows as itself). What was done in a
    // run before a Start over shows on the day it was done, so past weeks keep it.
    let offset = track.cycle_offset;
    let schedule = Schedule::load(conn, track)?;
    let mut out = on_done_days(&|cycle| cycle < offset);
    for (k, day) in schedule.days().enumerate() {
        if day > to || (!track.loop_entries && k >= n_slots) {
            break;
        }
        if day >= from {
            let slot = &slots[k % n_slots];
            let cycle = offset + (k / n_slots) as i64;
            let mut any = false;
            for i in items_of(&entries, slot) {
                out.push(item(&entries[i], day, cycle, "scheduled"));
                any = true;
            }
            if !any {
                out.push(item(&entries[slot[0]], day, cycle, "scheduled"));
            }
        }
    }
    Ok(out)
}

// ── Export to other calendars (.ics) ─────────────────────────────────────────────────────────────

/// An iCalendar text value with its special characters escaped (RFC 5545 §3.3.11).
fn ics_text(s: &str) -> String {
    s.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace("\r\n", "\\n").replace('\n', "\\n")
}

/// One iCalendar content line, folded to 75 octets per line (continuations start with a space), without splitting a
/// character, and ended with CRLF.
fn ics_line(out: &mut String, line: &str) {
    let mut width = 0;
    for ch in line.chars() {
        let len = ch.len_utf8();
        if width + len > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(ch);
        width += len;
    }
    out.push_str("\r\n");
}

/// The chosen tracks' scheduled entries from `from` to `to` as an iCalendar file, for Google Calendar, Apple Calendar,
/// Outlook and the like: one event per entry per day. A track with a time window gives timed events (in the calendar's own
/// time zone, as "floating" times); one for any time of day, all-day events. Only dated tracks have days to give: an
/// undated track (one after another) adds nothing.
///
/// Each event's UID names its track, entry and cycle, so exporting again and importing over the old file updates those
/// events rather than doubling them (in calendars that honor UIDs).
pub fn export_calendar_ics(db_path: &str, track_ids: &[i64], from: NaiveDate, to: NaiveDate, today: NaiveDate) -> Result<String> {
    let conn = Connection::open(db_path)?;
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let mut out = String::new();
    for line in ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kinesis//Calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Kinesis"] {
        ics_line(&mut out, line);
    }
    for &track_id in track_ids {
        let track = load_track(&conn, track_id)?;
        if track.advance_mode == "completion" {
            continue;
        }
        for item in track_days(&conn, &track, from, to, today)? {
            // A folder isn't an event; what's in it is (an empty one adds nothing).
            if item.kind != "scheduled" || item.is_folder {
                continue;
            }
            let Ok(day) = parse_date(&item.date) else { continue };
            let who = if item.entry_id > 0 { format!("e{}", item.entry_id) } else { format!("v{}", item.video_id.clone().unwrap_or_default()) };
            ics_line(&mut out, "BEGIN:VEVENT");
            ics_line(&mut out, &format!("UID:kinesis-track{}-{}-c{}@kinesis.app", track.id, who, item.cycle));
            ics_line(&mut out, &format!("DTSTAMP:{stamp}"));
            match (track.time_start, track.time_duration) {
                (Some(start), Some(duration)) => {
                    let at = |minutes: i64| format!("{}T{:02}{:02}00", day.format("%Y%m%d"), minutes / 60, minutes % 60);
                    ics_line(&mut out, &format!("DTSTART:{}", at(start)));
                    ics_line(&mut out, &format!("DTEND:{}", at(start + duration)));
                }
                _ => {
                    ics_line(&mut out, &format!("DTSTART;VALUE=DATE:{}", day.format("%Y%m%d")));
                    ics_line(&mut out, &format!("DTEND;VALUE=DATE:{}", (day + Duration::days(1)).format("%Y%m%d")));
                }
            }
            ics_line(&mut out, &format!("SUMMARY:{}", ics_text(&format!("{}: {}", track.name, item.title))));
            let link = item.video_id.as_ref().map(|v| format!("https://www.youtube.com/watch?v={v}"));
            let description = [Some(item.description.clone()).filter(|d| !d.is_empty()), link.clone()].into_iter().flatten().collect::<Vec<_>>().join("\n\n");
            if !description.is_empty() {
                ics_line(&mut out, &format!("DESCRIPTION:{}", ics_text(&description)));
            }
            if let Some(link) = link {
                ics_line(&mut out, &format!("URL:{link}"));
            }
            ics_line(&mut out, &format!("CATEGORIES:{}", ics_text(&track.name)));
            // iCalendar's priority runs 1 (highest) to 9 (lowest), 0 for none.
            if let Some(p) = match item.priority { 3 => Some(1), 2 => Some(5), 1 => Some(9), _ => None } {
                ics_line(&mut out, &format!("PRIORITY:{p}"));
            }
            if item.done {
                ics_line(&mut out, "STATUS:CONFIRMED");
            }
            ics_line(&mut out, "END:VEVENT");
        }
    }
    ics_line(&mut out, "END:VCALENDAR");
    Ok(out)
}

/// Starts a track over from `today`: back to its first entry, in a new first round, with nothing marked done. What was done
/// before isn't deleted: the run's starting cycle moves past every cycle used so far, so those completions stay as history
/// (an undated track's on the days they were done, as before). A dated track's schedule starts again from today, so its
/// first entry lands on the schedule's next day from here.
pub fn start_calendar_track_over(db_path: &str, id: i64, today: NaiveDate) -> Result<()> {
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    let track = load_track(&tx, id)?;
    let state = resolve(&tx, &track, today)?;
    let highest_used: Option<i64> = tx.query_row(
        "SELECT MAX(c.cycle) FROM CalendarCompletions c JOIN CalendarEntries e ON e.id = c.entry_id WHERE e.track_id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    // Past both the cycle it's on now and any cycle something was marked done in.
    let next_offset = (state.cycle + 1).max(highest_used.map_or(0, |c| c + 1)).max(track.cycle_offset);
    let start = if track.advance_mode == "completion" { track.start_date.clone() } else { fmt_date(today) };
    // Where it stood before is kept, so this can be undone (undo_calendar_track_start_over). Only the last one is.
    tx.execute(
        "UPDATE CalendarTracks SET cycle_offset = ?1, start_date = ?2, previous_start_date = start_date, previous_cycle_offset = cycle_offset
         WHERE id = ?3",
        params![next_offset, start, id],
    )?;
    // Starting later can only narrow when it runs, but check its time window all the same.
    ensure_no_clash(&tx, id)?;
    tx.commit()
}

/// Undoes a track's last Start over: puts back the start date and run it had before, so it's where it was, with what was
/// marked done counting again. Refused once something's been marked done in the new run (see TrackState's
/// `can_undo_start_over`), or when there's nothing to undo.
pub fn undo_calendar_track_start_over(db_path: &str, id: i64) -> Result<()> {
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    let track = load_track(&tx, id)?;
    let cycles: Vec<i64> = {
        let mut stmt = tx.prepare("SELECT c.cycle FROM CalendarCompletions c JOIN CalendarEntries e ON e.id = c.entry_id WHERE e.track_id = ?1")?;
        let rows = stmt.query_map(params![id], |r| r.get(0))?;
        rows.collect::<Result<_>>()?
    };
    if !start_over_undoable(&track, cycles.into_iter()) {
        return Err(invalid(if track.previous_start_date.is_none() {
            "There's no Start over to undo on this track."
        } else {
            "Something's been marked done since it started over, so it can't go back. Uncheck it first."
        }));
    }
    tx.execute(
        "UPDATE CalendarTracks SET start_date = previous_start_date, cycle_offset = previous_cycle_offset,
             previous_start_date = NULL, previous_cycle_offset = NULL
         WHERE id = ?1",
        params![id],
    )?;
    // Back to an earlier start, it runs over more dates again: its time window mustn't clash with what's been set since.
    ensure_no_clash(&tx, id)?;
    tx.commit()
}

// ── In a Kinpak ──────────────────────────────────────────────────────────────────────────────────

/// A whole track as a Kinpak carries it (kinpak.rs): its settings, its entries in order, its terms and holiday rules, and
/// (when the export includes progress) what was marked done. Nothing in it is a row id, so it lands in any workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackPack {
    pub name: String,
    pub drive: String,
    pub advance_mode: String,
    pub loop_entries: bool,
    pub source_drive_sequence: bool,
    pub weekdays: Vec<u32>,
    pub start_date: String,
    pub archived: bool,
    pub created_at: String,
    pub time_start: Option<i64>,
    pub time_duration: Option<i64>,
    /// Where its current run starts (see CalendarTrack); 0 without progress, so it starts at round 1.
    pub cycle_offset: i64,
    pub entries: Vec<EntryPack>,
    pub terms: Vec<TermPack>,
    pub holidays: Vec<HolidayRulePack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryPack {
    pub video_id: Option<String>,
    /// The video's title when it was exported: the task's name if the video isn't there when it's imported.
    pub video_title: String,
    pub label: String,
    pub target_date: Option<String>,
    pub icon: String,
    pub description: String,
    pub priority: i64,
    /// It had a row of its own (not just a place in its Drive's sequence): see load_entries.
    pub own: bool,
    /// (cycle, when) for each time it was marked done. Empty without progress.
    pub completions: Vec<(i64, String)>,
    /// (cycle, when) for each cycle it's marked In progress in. Empty without progress.
    #[serde(default)]
    pub in_progress: Vec<(i64, String)>,
    /// A folder (see EntryView).
    #[serde(default)]
    pub is_folder: bool,
    /// The folder it's in, as that folder's index in the track's `entries`.
    #[serde(default)]
    pub folder: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TermPack {
    pub name: String,
    pub start_date: String,
    pub end_date: String,
    pub annual: bool,
}

/// A holiday rule, naming its set the way any workspace can find it: a built-in set by its `builtin` key, any other by
/// its name, with its dates (it's made when the workspace doesn't have it).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HolidayRulePack {
    pub mode: String,
    pub builtin: String,
    pub name: String,
    pub annual: bool,
    pub dates: Vec<(String, String)>,
}

/// Every track, ready for a Kinpak. `progress`: with what was marked done (and where each run starts), or as a fresh plan.
pub fn export_calendar_tracks(conn: &Connection, progress: bool) -> Result<Vec<TrackPack>> {
    let has_tables = conn
        .query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'CalendarTracks'", [], |_| Ok(()))
        .optional()?
        .is_some();
    if !has_tables {
        return Ok(vec![]);
    }
    let tracks: Vec<CalendarTrack> = {
        let mut stmt = conn.prepare(&format!("SELECT {TRACK_COLUMNS} FROM CalendarTracks ORDER BY id"))?;
        let rows = stmt.query_map([], track_from_row)?;
        rows.collect::<Result<_>>()?
    };
    let mut out = Vec::with_capacity(tracks.len());
    for track in tracks {
        let mut entries = Vec::new();
        let loaded = load_entries(conn, &track)?;
        // A folder's index in the pack, for its entries to point at.
        let index_of: HashMap<i64, usize> = loaded.iter().enumerate().filter(|(_, e)| e.is_folder).map(|(i, e)| (e.id, i)).collect();
        for e in loaded {
            let completions = if progress && e.id > 0 {
                let mut stmt = conn.prepare("SELECT cycle, completed_at FROM CalendarCompletions WHERE entry_id = ?1 ORDER BY cycle")?;
                let rows = stmt.query_map(params![e.id], |r| Ok((r.get(0)?, r.get(1)?)))?;
                rows.collect::<Result<_>>()?
            } else {
                vec![]
            };
            let in_progress = if progress && e.id > 0 {
                let mut stmt = conn.prepare("SELECT cycle, started_at FROM CalendarProgress WHERE entry_id = ?1 ORDER BY cycle")?;
                let rows = stmt.query_map(params![e.id], |r| Ok((r.get(0)?, r.get(1)?)))?;
                rows.collect::<Result<_>>()?
            } else {
                vec![]
            };
            entries.push(EntryPack {
                in_progress,
                is_folder: e.is_folder,
                folder: e.folder_id.and_then(|f| index_of.get(&f).copied()),
                video_title: if e.video_id.is_some() { e.title.clone() } else { String::new() },
                video_id: e.video_id,
                label: e.label,
                target_date: e.target_date,
                icon: e.icon,
                description: e.description,
                priority: e.priority,
                own: e.id > 0,
                completions,
            });
        }
        let terms = load_terms(conn, track.id)?
            .into_iter()
            .map(|t| TermPack { name: t.name, start_date: t.start_date, end_date: t.end_date, annual: t.annual })
            .collect();
        let mut holidays = Vec::new();
        for rule in load_rules(conn, track.id)? {
            let (builtin, name, annual): (String, String, bool) = conn.query_row(
                "SELECT builtin, name, annual FROM CalendarHolidaySets WHERE id = ?1",
                params![rule.set_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0)),
            )?;
            // A built-in set's dates are worked out, not stored: its key is enough.
            let dates = if builtin.is_empty() {
                let mut stmt = conn.prepare("SELECT date, name FROM CalendarHolidayDates WHERE set_id = ?1 ORDER BY date")?;
                let rows = stmt.query_map(params![rule.set_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
                rows.collect::<Result<_>>()?
            } else {
                vec![]
            };
            holidays.push(HolidayRulePack { mode: rule.mode, builtin, name, annual, dates });
        }
        out.push(TrackPack {
            name: track.name,
            drive: track.drive,
            advance_mode: track.advance_mode,
            loop_entries: track.loop_entries,
            source_drive_sequence: track.source_drive_sequence,
            weekdays: track.weekdays,
            start_date: track.start_date,
            archived: track.archived,
            created_at: track.created_at,
            time_start: track.time_start,
            time_duration: track.time_duration,
            cycle_offset: if progress { track.cycle_offset } else { 0 },
            entries,
            terms,
            holidays,
        });
    }
    Ok(out)
}

/// How a track from a Kinpak went.
#[derive(Debug, PartialEq)]
pub enum TrackImport {
    Added,
    /// Left out, and why (in words for the import's summary): a workspace's own tracks are never replaced.
    Skipped(String),
}

/// Adds a track from a Kinpak, on `conn` (the importer's open transaction). Left out, never replacing anything, when an
/// active track here has its name, or its time would clash with one here. A video entry whose video isn't in the library
/// becomes a task named after it, which remembers the video, so the video arriving later takes its place (the
/// reconnecting trigger above). A track following its Drive's sequence keeps doing so when that Drive has one here;
/// otherwise it becomes a list of the same entries.
pub fn import_calendar_track(conn: &Connection, p: &TrackPack) -> Result<TrackImport> {
    let input = TrackInput {
        name: p.name.clone(),
        drive: p.drive.clone(),
        advance_mode: p.advance_mode.clone(),
        loop_entries: p.loop_entries,
        source_drive_sequence: p.source_drive_sequence,
        weekdays: p.weekdays.clone(),
        start_date: Some(p.start_date.clone()),
        time_start: p.time_start,
        time_duration: p.time_duration,
    };
    let t = clean_track(&input)?;
    // The same track from an earlier import of this pack (or the workspace it came from).
    let already: bool = conn
        .query_row("SELECT 1 FROM CalendarTracks WHERE name = ?1 AND created_at = ?2", params![t.name, p.created_at], |_| Ok(()))
        .optional()?
        .is_some();
    if already {
        return Ok(TrackImport::Skipped(format!("Track \"{}\": already in this workspace.", t.name)));
    }
    if !p.archived && ensure_name_free(conn, &t.name, None).is_err() {
        return Ok(TrackImport::Skipped(format!("Track \"{}\": this workspace already has one by that name, so it was left as it is.", t.name)));
    }
    let has_video = |id: &str| -> Result<bool> {
        Ok(conn.query_row("SELECT 1 FROM Videos WHERE video_id = ?1", params![id], |_| Ok(())).optional()?.is_some())
    };
    let follows = p.source_drive_sequence
        && conn.query_row("SELECT 1 FROM DriveSequence WHERE drive = ?1 LIMIT 1", params![t.drive], |_| Ok(())).optional()?.is_some();

    conn.execute_batch("SAVEPOINT calendar_track_import")?;
    let added = (|| -> Result<std::result::Result<(), String>> {
        let created = if p.created_at.trim().is_empty() { now_stamp() } else { p.created_at.clone() };
        conn.execute(
            "INSERT INTO CalendarTracks (name, drive, advance_mode, loop_entries, source_drive_sequence, weekdays, start_date, archived, created_at, time_start, time_duration, cycle_offset)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![t.name, t.drive, t.mode, p.loop_entries as i64, follows as i64, t.weekdays, t.start, p.archived as i64, created,
                t.time.map(|(s, _)| s), t.time.map(|(_, d)| d), p.cycle_offset.max(0)],
        )?;
        let track_id = conn.last_insert_rowid();
        // Positions count within each group: the top level, and each folder (by its new id).
        let mut next_position: HashMap<Option<i64>, i64> = HashMap::new();
        // The pack's index of each folder made here, to its new id.
        let mut folder_ids: HashMap<usize, i64> = HashMap::new();
        let mut seen: HashSet<String> = HashSet::new();
        for (index, e) in p.entries.iter().enumerate() {
            // Following the sequence, only what has a row of its own needs one (the sequence gives the rest). Such a track
            // has no folders.
            if follows && (!e.own || e.is_folder) {
                continue;
            }
            if e.is_folder {
                let extras = clean_extras(&EntryExtras { icon: e.icon.clone(), description: e.description.clone(), priority: e.priority.clamp(0, MAX_PRIORITY) })
                    .unwrap_or_default();
                let n = next_position.entry(None).or_insert(0);
                *n += 1;
                let name = if e.label.trim().is_empty() { "Folder".to_string() } else { e.label.trim().to_string() };
                conn.execute(
                    "INSERT INTO CalendarEntries (track_id, video_id, label, position, icon, description, priority, is_folder) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, 1)",
                    params![track_id, name, *n, extras.icon, extras.description, extras.priority],
                )?;
                folder_ids.insert(index, conn.last_insert_rowid());
                continue;
            }
            let folder_id = if follows { None } else { e.folder.and_then(|i| folder_ids.get(&i).copied()) };
            let extras = clean_extras(&EntryExtras { icon: e.icon.clone(), description: e.description.clone(), priority: e.priority.clamp(0, MAX_PRIORITY) })
                .unwrap_or_default();
            let present = match &e.video_id {
                Some(v) => has_video(v)? && seen.insert(v.clone()),
                None => false,
            };
            if follows && !present {
                continue;
            }
            let (video_id, former, label) = match (&e.video_id, present) {
                (Some(v), true) => (Some(v.clone()), None, e.label.clone()),
                // Not in this library: a task with the video's name, remembering the video.
                (Some(v), false) => (None, Some(v.clone()), if e.label.is_empty() { if e.video_title.is_empty() { v.clone() } else { e.video_title.clone() } } else { e.label.clone() }),
                (None, _) => (None, None, e.label.clone()),
            };
            let target = e.target_date.as_deref().and_then(|d| parse_date(d).ok()).map(fmt_date);
            let position = next_position.entry(folder_id).or_insert(0);
            *position += 1;
            conn.execute(
                "INSERT INTO CalendarEntries (track_id, video_id, label, position, target_date, icon, description, priority, former_video_id, folder_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![track_id, video_id, label, *position, target, extras.icon, extras.description, extras.priority, former, folder_id],
            )?;
            let entry_id = conn.last_insert_rowid();
            for (cycle, at) in &e.completions {
                conn.execute(
                    "INSERT OR IGNORE INTO CalendarCompletions (entry_id, cycle, completed_at) VALUES (?1, ?2, ?3)",
                    params![entry_id, cycle.max(&0), at],
                )?;
            }
            for (cycle, at) in &e.in_progress {
                if e.completions.iter().any(|(c, _)| c == cycle) {
                    continue; // done is past in progress
                }
                conn.execute(
                    "INSERT OR IGNORE INTO CalendarProgress (entry_id, cycle, started_at) VALUES (?1, ?2, ?3)",
                    params![entry_id, cycle.max(&0), at],
                )?;
            }
        }
        for term in &p.terms {
            let (Ok(s), Ok(e)) = (parse_date(&term.start_date), parse_date(&term.end_date)) else { continue };
            conn.execute(
                "INSERT INTO CalendarTerms (track_id, name, start_date, end_date, annual) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![track_id, term.name.trim(), fmt_date(s), fmt_date(e), term.annual as i64],
            )?;
        }
        for rule in &p.holidays {
            if rule.mode != "exclude" && rule.mode != "include" {
                continue;
            }
            let set_id: Option<i64> = if !rule.builtin.is_empty() {
                conn.query_row("SELECT id FROM CalendarHolidaySets WHERE builtin = ?1", params![rule.builtin], |r| r.get(0)).optional()?
            } else if let Some(id) = conn
                .query_row("SELECT id FROM CalendarHolidaySets WHERE builtin = '' AND name = ?1 COLLATE NOCASE", params![rule.name.trim()], |r| r.get(0))
                .optional()?
            {
                Some(id)
            } else if !rule.name.trim().is_empty() {
                conn.execute("INSERT INTO CalendarHolidaySets (name, annual) VALUES (?1, ?2)", params![rule.name.trim(), rule.annual as i64])?;
                let id = conn.last_insert_rowid();
                for (date, name) in &rule.dates {
                    if let Ok(d) = parse_date(date) {
                        conn.execute("INSERT OR IGNORE INTO CalendarHolidayDates (set_id, date, name) VALUES (?1, ?2, ?3)", params![id, fmt_date(d), name])?;
                    }
                }
                Some(id)
            } else {
                None
            };
            if let Some(set_id) = set_id {
                conn.execute(
                    "INSERT OR REPLACE INTO CalendarTrackHolidayRules (track_id, set_id, mode) VALUES (?1, ?2, ?3)",
                    params![track_id, set_id, rule.mode],
                )?;
            }
        }
        // Its time window can't clash with a track here (an archived one isn't checked, as when it's made).
        Ok(ensure_no_clash(conn, track_id).map_err(|e| e.to_string()))
    })();
    match added {
        Ok(Ok(())) => {
            conn.execute_batch("RELEASE calendar_track_import")?;
            Ok(TrackImport::Added)
        }
        Ok(Err(clash)) => {
            conn.execute_batch("ROLLBACK TO calendar_track_import; RELEASE calendar_track_import")?;
            Ok(TrackImport::Skipped(format!("Track \"{}\": {}", t.name, clash.trim_start_matches("Invalid parameter: "))))
        }
        Err(e) => {
            conn.execute_batch("ROLLBACK TO calendar_track_import; RELEASE calendar_track_import")?;
            Err(e)
        }
    }
}

// ── What the Calendar page reads ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSummary {
    pub track: CalendarTrack,
    pub state: TrackState,
}

/// Every track (archived ones too, when asked) and where each stands on `today`.
pub fn list_calendar_tracks(db_path: &str, include_archived: bool, today: NaiveDate) -> Result<Vec<TrackSummary>> {
    let conn = Connection::open(db_path)?;
    let tracks: Vec<CalendarTrack> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT {TRACK_COLUMNS} FROM CalendarTracks WHERE ?1 OR archived = 0 ORDER BY archived, name COLLATE NOCASE, id"
        ))?;
        let rows = stmt.query_map(params![include_archived], track_from_row)?;
        rows.collect::<Result<_>>()?
    };
    tracks.into_iter().map(|track| Ok(TrackSummary { state: resolve(&conn, &track, today)?, track })).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackDetail {
    pub track: CalendarTrack,
    pub state: TrackState,
    pub terms: Vec<CalendarTerm>,
    pub rules: Vec<HolidayRule>,
}

pub fn get_calendar_track(db_path: &str, track_id: i64, today: NaiveDate) -> Result<TrackDetail> {
    let conn = Connection::open(db_path)?;
    let track = load_track(&conn, track_id)?;
    Ok(TrackDetail { state: resolve(&conn, &track, today)?, terms: load_terms(&conn, track_id)?, rules: load_rules(&conn, track_id)?, track })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_db() -> String {
        static N: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!("kinesis_cal_{}_{}.db", std::process::id(), N.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_file(&path);
        let path = path.to_string_lossy().into_owned();
        db::init_db(&path).unwrap();
        path
    }

    fn d(s: &str) -> NaiveDate {
        parse_date(s).unwrap()
    }

    fn track(path: &str, mode: &str, weekdays: &[u32], start: &str, looping: bool) -> i64 {
        // Each its own name: names are unique among active tracks.
        static NEXT: AtomicU64 = AtomicU64::new(0);
        create_calendar_track(path, &TrackInput {
            name: format!("Track {}", NEXT.fetch_add(1, Ordering::SeqCst)),
            drive: String::new(),
            advance_mode: mode.into(),
            loop_entries: looping,
            source_drive_sequence: false,
            weekdays: weekdays.to_vec(),
            start_date: Some(start.into()),
            time_start: None,
            time_duration: None,
        })
        .unwrap()
    }

    fn tasks(path: &str, track: i64, n: usize) -> Vec<i64> {
        (0..n).map(|i| add_calendar_entry(path, track, None, &format!("Task {i}"), &EntryExtras::default()).unwrap()).collect()
    }

    fn done(path: &str, track: i64, entry: i64, cycle: i64) {
        set_calendar_completion(path, track, Some(entry), None, cycle, true).unwrap();
    }

    #[test]
    fn us_federal_holidays_2026_match_the_published_dates() {
        let got: Vec<String> = us_federal_holidays(2026).iter().map(|(d, _)| fmt_date(*d)).collect();
        assert_eq!(got, vec![
            "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19",
            "2026-07-03", // July 4 is a Saturday
            "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
        ]);
        // 2028's New Year's Day is a Saturday: observed on Friday 2027-12-31.
        assert!(is_us_federal_holiday(d("2027-12-31")));
    }

    /// A folder with the given entries in it, at the end of the track.
    fn folder(path: &str, track: i64, name: &str, inside: &[i64]) -> i64 {
        let f = add_calendar_folder(path, track, name, &EntryExtras::default()).unwrap();
        let state = resolve_track(path, track, d("2026-01-01")).unwrap();
        let layout: Vec<(i64, Option<i64>)> = state
            .entries
            .iter()
            .filter(|e| !inside.contains(&e.id))
            .flat_map(|e| {
                let mut v = vec![(e.id, e.folder_id)];
                if e.id == f {
                    v.extend(inside.iter().map(|&i| (i, Some(f))));
                }
                v
            })
            .collect();
        set_calendar_entry_layout(path, track, &layout).unwrap();
        f
    }

    #[test]
    fn completing_a_video_checks_it_off_on_every_track_it_is_on() {
        let p = temp_db();
        db::save_video(&p, "vid00000001", "Lecture", "A", 600, "words", 1, "2026-01-01T00:00:00Z", "@a", None).unwrap();
        let a = track(&p, "completion", &[], "2026-01-01", false);
        let b = track(&p, "completion", &[], "2026-01-01", false);
        for t in [a, b] {
            tasks(&p, t, 1);
            add_calendar_entry(&p, t, Some("vid00000001"), "", &EntryExtras::default()).unwrap();
        }
        assert_eq!(complete_video_on_tracks(&p, "vid00000001", d("2026-01-01")).unwrap(), 2);
        for t in [a, b] {
            let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
            assert!(s.entries.iter().find(|e| e.video_id.as_deref() == Some("vid00000001")).unwrap().done);
        }
        assert_eq!(complete_video_on_tracks(&p, "vid00000001", d("2026-01-01")).unwrap(), 0, "already done everywhere");
    }

    #[test]
    fn a_folder_puts_everything_in_it_on_one_day() {
        let p = temp_db();
        // Mon/Wed/Fri from Monday 2026-09-07: Task 0 alone, then a folder of Task 1 and Task 2, then Task 3.
        let t = track(&p, "calendar", &[1, 3, 5], "2026-09-07", false);
        let e = tasks(&p, t, 4);
        let f = folder(&p, t, "Lab day", &[e[1], e[2]]);
        // Task 3 after the folder.
        set_calendar_entry_layout(&p, t, &[(e[0], None), (f, None), (e[1], Some(f)), (e[2], Some(f)), (e[3], None)]).unwrap();
        let s = resolve_track(&p, t, d("2026-09-07")).unwrap();
        let days: Vec<(String, Option<String>, i64)> = s.entries.iter().map(|e| (e.title.clone(), e.due_date.clone(), e.place)).collect();
        assert_eq!(days, vec![
            ("Task 0".into(), Some("2026-09-07".into()), 1),
            ("Lab day".into(), Some("2026-09-09".into()), 0),
            ("Task 1".into(), Some("2026-09-09".into()), 2),
            ("Task 2".into(), Some("2026-09-09".into()), 3),
            ("Task 3".into(), Some("2026-09-11".into()), 4),
        ]);
        assert_eq!(s.total, 4, "the folder itself isn't counted");
        // On the folder's day, its first entry is up and the one before is behind.
        let s = resolve_track(&p, t, d("2026-09-09")).unwrap();
        assert_eq!((s.current, s.done), (Some(2), 1));
        // The week shows both of the folder's entries on Wednesday, labeled with it.
        let wed: Vec<(String, Option<String>)> = list_calendar_days(&p, d("2026-09-09"), d("2026-09-09"), d("2026-09-07"))
            .unwrap()
            .into_iter()
            .map(|i| (i.title, i.folder))
            .collect();
        assert_eq!(wed, vec![("Task 1".into(), Some("Lab day".into())), ("Task 2".into(), Some("Lab day".into()))]);
    }

    #[test]
    fn a_folder_is_done_when_all_of_it_is_and_in_progress_before() {
        let p = temp_db();
        let t = track(&p, "completion", &[], "2026-01-01", false);
        let e = tasks(&p, t, 3);
        let f = folder(&p, t, "Warm-up", &[e[0], e[1]]);
        // The folder first, then Task 2.
        set_calendar_entry_layout(&p, t, &[(f, None), (e[0], Some(f)), (e[1], Some(f)), (e[2], None)]).unwrap();
        let view = |s: &TrackState| s.entries.iter().find(|x| x.id == f).map(|x| (x.done, x.in_progress)).unwrap();
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        assert_eq!(view(&s), (false, false));
        done(&p, t, e[0], 0);
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        assert_eq!(view(&s), (false, true), "some done: in progress");
        assert_eq!(s.entries[s.current.unwrap()].id, e[1], "the folder stays up until all of it is done");
        // Marking the folder marks everything in it.
        done(&p, t, f, 0);
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        assert_eq!(view(&s), (true, false));
        assert_eq!(s.entries[s.current.unwrap()].id, e[2]);
        assert!(set_calendar_progress(&p, t, Some(f), None, 0, true).is_err(), "a folder's In progress is its own doing");
    }

    #[test]
    fn removing_a_folder_keeps_what_was_in_it_in_its_place() {
        let p = temp_db();
        let t = track(&p, "completion", &[], "2026-01-01", false);
        let e = tasks(&p, t, 3);
        let f = folder(&p, t, "Group", &[e[1], e[2]]);
        set_calendar_entry_layout(&p, t, &[(f, None), (e[1], Some(f)), (e[2], Some(f)), (e[0], None)]).unwrap();
        remove_calendar_entry(&p, f).unwrap();
        let titles: Vec<(String, Option<i64>)> = resolve_track(&p, t, d("2026-01-01")).unwrap().entries.into_iter().map(|e| (e.title, e.folder_id)).collect();
        assert_eq!(titles, vec![("Task 1".into(), None), ("Task 2".into(), None), ("Task 0".into(), None)]);
    }

    #[test]
    fn a_layout_keeps_folders_one_level_deep() {
        let p = temp_db();
        let t = track(&p, "completion", &[], "2026-01-01", false);
        let e = tasks(&p, t, 1);
        let a = add_calendar_folder(&p, t, "A", &EntryExtras::default()).unwrap();
        let b = add_calendar_folder(&p, t, "B", &EntryExtras::default()).unwrap();
        assert!(set_calendar_entry_layout(&p, t, &[(a, None), (b, Some(a)), (e[0], None)]).is_err(), "no folder in a folder");
        assert!(set_calendar_entry_layout(&p, t, &[(a, None), (b, None), (e[0], Some(e[0]))]).is_err(), "only a folder holds entries");
        assert!(set_calendar_entry_layout(&p, t, &[(a, None), (e[0], Some(a))]).is_err(), "every entry, once");
        // An empty folder still holds a day on a dated track.
        let dated = track(&p, "calendar", &[1, 2, 3, 4, 5], "2026-09-07", false);
        add_calendar_folder(&p, dated, "Empty", &EntryExtras::default()).unwrap();
        tasks(&p, dated, 1);
        let s = resolve_track(&p, dated, d("2026-09-07")).unwrap();
        assert_eq!(s.entries[1].due_date.as_deref(), Some("2026-09-08"));
    }

    #[test]
    fn folders_travel_in_a_kinpak() {
        let p = temp_db();
        let t = track(&p, "completion", &[], "2026-01-01", false);
        let e = tasks(&p, t, 3);
        folder(&p, t, "Pair", &[e[1], e[2]]);
        let conn = Connection::open(&p).unwrap();
        let mut packs = export_calendar_tracks(&conn, false).unwrap();
        let pack = packs.iter_mut().find(|x| x.entries.iter().any(|e| e.is_folder)).unwrap();
        pack.name = "Copied".into();
        pack.created_at = "2001-01-01 00:00:00".into();
        assert_eq!(import_calendar_track(&conn, pack).unwrap(), TrackImport::Added);
        let copied: i64 = conn.query_row("SELECT id FROM CalendarTracks WHERE name = 'Copied'", [], |r| r.get(0)).unwrap();
        drop(conn);
        let laid: Vec<(String, bool, bool)> = resolve_track(&p, copied, d("2026-01-01")).unwrap()
            .entries.into_iter().map(|e| (e.title, e.is_folder, e.folder_id.is_some())).collect();
        assert_eq!(laid, vec![
            ("Task 0".into(), false, false),
            ("Pair".into(), true, false),
            ("Task 1".into(), false, true),
            ("Task 2".into(), false, true),
        ]);
    }

    #[test]
    fn completion_chain_unlocks_in_order_and_finishes() {
        let p = temp_db();
        let t = track(&p, "completion", &[], "2026-01-01", false);
        let e = tasks(&p, t, 3);
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        assert_eq!((s.current, s.done, s.total), (Some(0), 0, 3));
        done(&p, t, e[0], 0);
        done(&p, t, e[1], 0);
        assert_eq!(resolve_track(&p, t, d("2026-01-01")).unwrap().current, Some(2));
        done(&p, t, e[2], 0);
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        assert!(s.finished && s.current.is_none() && s.done == 3);
    }

    #[test]
    fn looping_rotation_starts_over() {
        let p = temp_db();
        let t = track(&p, "completion", &[], "2026-01-01", true);
        let e = tasks(&p, t, 3); // Push, Pull, Legs
        for id in &e {
            done(&p, t, *id, 0);
        }
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        assert_eq!((s.cycle, s.current, s.done, s.finished), (1, Some(0), 0, false));
        done(&p, t, e[0], 1);
        assert_eq!(resolve_track(&p, t, d("2026-01-01")).unwrap().current, Some(1));
    }

    #[test]
    fn calendar_deals_entries_onto_weekdays() {
        let p = temp_db();
        // Mon/Wed/Fri from Monday 2026-09-07 (Labor Day, but no holidays are excluded yet).
        let t = track(&p, "calendar", &[1, 3, 5], "2026-09-07", false);
        tasks(&p, t, 4);
        let s = resolve_track(&p, t, d("2026-09-06")).unwrap();
        assert_eq!((s.current, s.current_waiting), (Some(0), true));
        assert_eq!(s.current_due.as_deref(), Some("2026-09-07"));
        // Thursday the 10th: Mon and Wed have happened, so the second entry is up; the next day is Friday.
        let s = resolve_track(&p, t, d("2026-09-10")).unwrap();
        assert_eq!(s.current, Some(1));
        assert_eq!(s.next_date.as_deref(), Some("2026-09-11"));
        assert_eq!(s.entries[3].due_date.as_deref(), Some("2026-09-14"));
        // Past the fourth day, a track that doesn't loop is finished.
        assert!(resolve_track(&p, t, d("2026-09-16")).unwrap().finished);
    }

    #[test]
    fn excluded_holiday_never_uses_up_an_entry_and_include_wins() {
        let p = temp_db();
        let t = track(&p, "calendar", &[1, 3, 5], "2026-09-07", false);
        tasks(&p, t, 3);
        let sets = list_calendar_holiday_sets(&p, 2026).unwrap();
        let federal = sets.iter().find(|s| s.builtin == US_FEDERAL).unwrap().id;
        set_calendar_track_holiday_rule(&p, t, federal, Some("exclude")).unwrap();
        // Labor Day is skipped: the first entry falls on Wednesday the 9th instead.
        let s = resolve_track(&p, t, d("2026-09-08")).unwrap();
        assert_eq!(s.entries[0].due_date.as_deref(), Some("2026-09-09"));
        // A make-up Saturday, included: it happens even though it isn't one of the weekdays.
        let makeup = create_calendar_holiday_set(&p, "Make-up days", false).unwrap();
        add_calendar_holiday_date(&p, makeup, "2026-09-12", "Make-up").unwrap();
        set_calendar_track_holiday_rule(&p, t, makeup, Some("include")).unwrap();
        let s = resolve_track(&p, t, d("2026-09-08")).unwrap();
        let dates: Vec<_> = s.entries.iter().map(|e| e.due_date.clone().unwrap()).collect();
        assert_eq!(dates, vec!["2026-09-09", "2026-09-11", "2026-09-12"]);
        // Labor Day, excluded as a federal holiday, comes back once an included set has it: an include wins.
        let conn = Connection::open(&p).unwrap();
        let has_labor_day = || Schedule::load(&conn, &load_track(&conn, t).unwrap()).unwrap().has(d("2026-09-07"));
        assert!(!has_labor_day());
        add_calendar_holiday_date(&p, makeup, "2026-09-07", "Make-up for Labor Day").unwrap();
        assert!(has_labor_day());
    }

    #[test]
    fn terms_limit_the_schedule_and_annual_terms_recur() {
        let p = temp_db();
        let t = track(&p, "calendar", &[2, 4], "2026-01-01", true);
        tasks(&p, t, 2);
        add_calendar_term(&p, t, "Fall", "2026-09-01", "2026-12-15", true).unwrap();
        let conn = Connection::open(&p).unwrap();
        let sched = Schedule::load(&conn, &load_track(&conn, t).unwrap()).unwrap();
        assert!(!sched.has(d("2026-06-02"))); // a Tuesday, but outside the term
        assert!(sched.has(d("2026-09-01"))); // Tuesday, first day of Fall
        assert!(sched.has(d("2027-09-02"))); // Thursday, Fall again the next year
        assert!(!sched.has(d("2026-12-17"))); // Thursday, after Fall ends
    }

    #[test]
    fn hybrid_flags_overdue_and_waits_for_its_day() {
        let p = temp_db();
        let t = track(&p, "hybrid", &[1, 3, 5], "2026-09-07", false);
        let e = tasks(&p, t, 3);
        // Wednesday the 9th: the first entry (due Monday) isn't done, so it's overdue and still the one up.
        let s = resolve_track(&p, t, d("2026-09-09")).unwrap();
        assert_eq!((s.current, s.current_overdue), (Some(0), true));
        // Done Monday's and Wednesday's; Friday's hasn't arrived yet on Thursday.
        done(&p, t, e[0], 0);
        done(&p, t, e[1], 0);
        let s = resolve_track(&p, t, d("2026-09-10")).unwrap();
        assert_eq!((s.current, s.current_overdue, s.current_waiting), (Some(2), false, true));
    }

    #[test]
    fn deleting_a_video_keeps_its_place_and_deleting_a_track_cleans_up() {
        let p = temp_db();
        db::save_video(&p, "vid1", "A video", "Author", 60, "text", 1, "2026-01-01T00:00:00Z", "@a", None).unwrap();
        let t = track(&p, "completion", &[], "2026-01-01", false);
        let e = add_calendar_entry(&p, t, Some("vid1"), "", &EntryExtras::default()).unwrap();
        done(&p, t, e, 0);
        let conn = Connection::open(&p).unwrap();
        conn.execute("DELETE FROM Videos WHERE video_id = 'vid1'", []).unwrap();
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        assert_eq!(s.entries.len(), 1);
        assert!(s.entries[0].video_id.is_none() && s.entries[0].done);
        // It's named after the video, not left blank.
        assert_eq!(s.entries[0].title, "A video");
        // The video coming back (the Trash's restore saves it again) takes its place again, done mark and all.
        db::save_video(&p, "vid1", "A video", "Author", 60, "text", 1, "2026-01-01T00:00:00Z", "@a", None).unwrap();
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        assert_eq!((s.entries[0].video_id.as_deref(), s.entries[0].label.as_str(), s.entries[0].done), (Some("vid1"), "", true));
        // A name given by hand stays through all of it.
        let conn = Connection::open(&p).unwrap();
        conn.execute("UPDATE CalendarEntries SET label = 'Watch first' WHERE id = ?1", params![e]).unwrap();
        conn.execute("DELETE FROM Videos WHERE video_id = 'vid1'", []).unwrap();
        assert_eq!(resolve_track(&p, t, d("2026-01-01")).unwrap().entries[0].title, "Watch first");
        db::save_video(&p, "vid1", "A video", "Author", 60, "text", 1, "2026-01-01T00:00:00Z", "@a", None).unwrap();
        assert_eq!(resolve_track(&p, t, d("2026-01-01")).unwrap().entries[0].label, "Watch first");
        delete_calendar_track(&p, t).unwrap();
        let left: i64 = conn
            .query_row("SELECT (SELECT COUNT(*) FROM CalendarEntries) + (SELECT COUNT(*) FROM CalendarCompletions)", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn track_names_are_unique_among_active_tracks() {
        let p = temp_db();
        let input = |name: &str| TrackInput {
            name: name.into(),
            drive: String::new(),
            advance_mode: "completion".into(),
            loop_entries: false,
            source_drive_sequence: false,
            weekdays: vec![],
            start_date: None,
            time_start: None,
            time_duration: None,
        };
        let first = create_calendar_track(&p, &input("Data Structures")).unwrap();
        // The same name, in any case or spacing, is refused while the first is active.
        assert!(create_calendar_track(&p, &input("data  structures ")).is_err());
        let other = create_calendar_track(&p, &input("Spanish")).unwrap();
        assert!(update_calendar_track(&p, other, &input("DATA STRUCTURES")).is_err());
        // Keeping its own name on an edit is fine.
        update_calendar_track(&p, first, &input("Data Structures")).unwrap();
        // Archived, its name is free again...
        set_calendar_track_archived(&p, first, true).unwrap();
        let second = create_calendar_track(&p, &input("Data Structures")).unwrap();
        // ...but it can't come back while the new one has it.
        assert!(set_calendar_track_archived(&p, first, false).is_err());
        set_calendar_track_archived(&p, second, true).unwrap();
        set_calendar_track_archived(&p, first, false).unwrap();
    }

    #[test]
    fn exports_dated_tracks_as_ics() {
        let p = temp_db();
        // Tue/Thu 9:00-10:30 from Tuesday 2026-09-01, three entries (one with a comma and a long description).
        let class = create_calendar_track(&p, &TrackInput {
            name: "Data Structures".into(),
            drive: String::new(),
            advance_mode: "calendar".into(),
            loop_entries: false,
            source_drive_sequence: false,
            weekdays: vec![2, 4],
            start_date: Some("2026-09-01".into()),
            time_start: Some(9 * 60),
            time_duration: Some(90),
        })
        .unwrap();
        let long = "Read chapter 4; then, do every exercise at the end of it. ".repeat(3);
        add_calendar_entry(&p, class, None, "Trees, part 1", &EntryExtras { description: long, priority: 3, ..EntryExtras::default() }).unwrap();
        add_calendar_entry(&p, class, None, "Trees, part 2", &EntryExtras::default()).unwrap();
        add_calendar_entry(&p, class, None, "Graphs", &EntryExtras::default()).unwrap();
        // An all-day track on Saturdays, and an undated one (which has nothing to export).
        let anytime = track(&p, "calendar", &[6], "2026-09-01", true);
        tasks(&p, anytime, 1);
        let chain = track(&p, "completion", &[], "2026-09-01", false);
        tasks(&p, chain, 2);

        let ics = export_calendar_ics(&p, &[class, anytime, chain], d("2026-09-01"), d("2026-09-07"), d("2026-09-01")).unwrap();
        // Well-formed: CRLF lines, none longer than 75 octets, wrapped in a VCALENDAR.
        assert!(ics.starts_with("BEGIN:VCALENDAR\r\n") && ics.ends_with("END:VCALENDAR\r\n"));
        assert!(ics.split("\r\n").all(|l| l.len() <= 75), "a line wasn't folded");
        let unfolded = ics.replace("\r\n ", "");
        // Tue 1st, Thu 3rd: the class's first two entries, timed; the Saturday one all day. The third entry is next week.
        assert_eq!(unfolded.matches("BEGIN:VEVENT").count(), 3);
        assert!(unfolded.contains("DTSTART:20260901T090000\r\nDTEND:20260901T103000"));
        assert!(unfolded.contains("DTSTART;VALUE=DATE:20260905\r\nDTEND;VALUE=DATE:20260906"));
        assert!(unfolded.contains("SUMMARY:Data Structures: Trees\\, part 1"));
        assert!(unfolded.contains("PRIORITY:1"));
        assert!(unfolded.contains("then\\, do every exercise"));
        assert!(!unfolded.contains("Graphs"));
    }

    #[test]
    fn a_task_keeps_its_icon_description_and_priority() {
        let p = temp_db();
        let t = track(&p, "completion", &[], "2026-01-01", false);
        let extras = EntryExtras { icon: "tree-palm".into(), description: "  Beach week  ".into(), priority: 3 };
        let id = add_calendar_entry(&p, t, None, "Fall Break", &extras).unwrap();
        let e = &resolve_track(&p, t, d("2026-01-01")).unwrap().entries[0];
        assert_eq!((e.icon.as_str(), e.description.as_str(), e.priority), ("tree-palm", "Beach week", 3));
        update_calendar_entry(&p, id, "Fall Break", None, &EntryExtras { priority: 1, ..EntryExtras::default() }).unwrap();
        let e = &resolve_track(&p, t, d("2026-01-01")).unwrap().entries[0];
        assert_eq!((e.icon.as_str(), e.priority), ("", 1));
        // Out of range, or not an icon name: refused.
        assert!(add_calendar_entry(&p, t, None, "X", &EntryExtras { priority: 4, ..EntryExtras::default() }).is_err());
        assert!(add_calendar_entry(&p, t, None, "X", &EntryExtras { icon: "<script>".into(), ..EntryExtras::default() }).is_err());
    }

    #[test]
    fn starting_over_keeps_history_and_begins_again() {
        let p = temp_db();
        // A rotation two rounds in: round 1 done, and the first entry of round 2.
        let rotation = track(&p, "completion", &[], "2026-01-01", true);
        let e = tasks(&p, rotation, 3);
        for id in &e {
            done(&p, rotation, *id, 0);
        }
        done(&p, rotation, e[0], 1);
        let before = resolve_track(&p, rotation, d("2026-02-01")).unwrap();
        assert_eq!((before.round, before.current), (1, Some(1)));
        start_calendar_track_over(&p, rotation, d("2026-02-01")).unwrap();
        let after = resolve_track(&p, rotation, d("2026-02-01")).unwrap();
        // Round 1 again, first entry up, nothing marked: a fresh run.
        assert_eq!((after.round, after.current, after.done), (0, Some(0), 0));
        assert!(after.entries.iter().all(|x| !x.done));
        // The earlier completions are still there, as history.
        let kept: i64 = Connection::open(&p).unwrap().query_row("SELECT COUNT(*) FROM CalendarCompletions", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 4);
        // Marking in the new run uses its own cycle.
        done(&p, rotation, e[0], after.cycle);
        assert_eq!(resolve_track(&p, rotation, d("2026-02-01")).unwrap().current, Some(1));

        // A Mon/Wed/Fri schedule, three weeks along, started over on Thursday 2026-09-24: the first entry is Friday's.
        let class = track(&p, "calendar", &[1, 3, 5], "2026-09-07", false);
        tasks(&p, class, 20);
        assert_eq!(resolve_track(&p, class, d("2026-09-24")).unwrap().current, Some(7));
        start_calendar_track_over(&p, class, d("2026-09-24")).unwrap();
        let s = resolve_track(&p, class, d("2026-09-24")).unwrap();
        assert_eq!((s.current, s.round, s.current_waiting), (Some(0), 0, true));
        assert_eq!(s.entries[0].due_date.as_deref(), Some("2026-09-25"));
    }

    #[test]
    fn in_progress_is_a_marker_that_done_clears() {
        let p = temp_db();
        let t = track(&p, "completion", &[], "2026-01-01", false);
        let e = tasks(&p, t, 2);
        set_calendar_progress(&p, t, Some(e[0]), None, 0, true).unwrap();
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        // Marked, but it doesn't move the track along.
        assert!(s.entries[0].in_progress && !s.entries[0].done);
        assert_eq!(s.current, Some(0));
        // Done clears it; and a done entry can't be put back to in progress.
        done(&p, t, e[0], 0);
        let s = resolve_track(&p, t, d("2026-01-01")).unwrap();
        assert!(!s.entries[0].in_progress && s.entries[0].done);
        assert!(set_calendar_progress(&p, t, Some(e[0]), None, 0, true).is_err());
        // Taking the mark off, and the mark going with its entry.
        set_calendar_progress(&p, t, Some(e[1]), None, 0, true).unwrap();
        set_calendar_progress(&p, t, Some(e[1]), None, 0, false).unwrap();
        assert!(!resolve_track(&p, t, d("2026-01-01")).unwrap().entries[1].in_progress);
        set_calendar_progress(&p, t, Some(e[1]), None, 0, true).unwrap();
        remove_calendar_entry(&p, e[1]).unwrap();
        let left: i64 = Connection::open(&p).unwrap().query_row("SELECT COUNT(*) FROM CalendarProgress", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn a_start_over_can_be_undone_until_something_is_marked() {
        let p = temp_db();
        // The Mon/Wed/Fri class again: started over on 2026-09-24, then undone, it's back where it was.
        let class = track(&p, "calendar", &[1, 3, 5], "2026-09-07", false);
        let e = tasks(&p, class, 20);
        done(&p, class, e[0], 0);
        assert!(!resolve_track(&p, class, d("2026-09-24")).unwrap().can_undo_start_over);
        assert!(undo_calendar_track_start_over(&p, class).is_err());
        start_calendar_track_over(&p, class, d("2026-09-24")).unwrap();
        assert!(resolve_track(&p, class, d("2026-09-24")).unwrap().can_undo_start_over);
        undo_calendar_track_start_over(&p, class).unwrap();
        let s = resolve_track(&p, class, d("2026-09-24")).unwrap();
        assert_eq!((s.current, s.round, s.cycle, s.can_undo_start_over), (Some(7), 0, 0, false));
        assert_eq!(get_calendar_track(&p, class, d("2026-09-24")).unwrap().track.start_date, "2026-09-07");
        assert!(s.entries[0].done, "what was marked before counts again");

        // Once something's marked in the new run, it can't go back (until that's unchecked).
        start_calendar_track_over(&p, class, d("2026-09-24")).unwrap();
        let cycle = resolve_track(&p, class, d("2026-09-24")).unwrap().cycle;
        done(&p, class, e[0], cycle);
        assert!(!resolve_track(&p, class, d("2026-09-24")).unwrap().can_undo_start_over);
        assert!(undo_calendar_track_start_over(&p, class).is_err());
        set_calendar_completion(&p, class, Some(e[0]), None, cycle, false).unwrap();
        assert!(resolve_track(&p, class, d("2026-09-24")).unwrap().can_undo_start_over);

        // A new start date set by hand replaces what the Start over set: nothing to undo then.
        let input = TrackInput {
            name: get_calendar_track(&p, class, d("2026-09-24")).unwrap().track.name,
            drive: String::new(),
            advance_mode: "calendar".into(),
            loop_entries: false,
            source_drive_sequence: false,
            weekdays: vec![1, 3, 5],
            start_date: Some("2026-10-01".into()),
            time_start: None,
            time_duration: None,
        };
        update_calendar_track(&p, class, &input).unwrap();
        assert!(!resolve_track(&p, class, d("2026-09-24")).unwrap().can_undo_start_over);
    }

    #[test]
    fn time_windows_cannot_clash() {
        let p = temp_db();
        let timed = |name: &str, days: &[u32], start: i64, duration: i64| TrackInput {
            name: name.into(),
            drive: String::new(),
            advance_mode: "calendar".into(),
            loop_entries: false,
            source_drive_sequence: false,
            weekdays: days.to_vec(),
            start_date: Some("2026-09-01".into()),
            time_start: Some(start),
            time_duration: Some(duration),
        };
        // Tue/Thu 9:00-10:30.
        let class = create_calendar_track(&p, &timed("Class", &[2, 4], 9 * 60, 90)).unwrap();
        // Overlapping on Thursday: refused, naming the other track.
        let err = create_calendar_track(&p, &timed("Gym", &[4, 6], 10 * 60, 60)).unwrap_err().to_string();
        assert!(err.contains("Class"), "{err}");
        // Back to back is fine, and so is the same time on days it doesn't share.
        create_calendar_track(&p, &timed("Reading", &[2, 4], 10 * 60 + 30, 30)).unwrap();
        let gym = create_calendar_track(&p, &timed("Gym", &[1, 3], 9 * 60, 60)).unwrap();
        // "Any time that day" never clashes.
        create_calendar_track(&p, &TrackInput { time_start: None, time_duration: None, ..timed("Anytime", &[2, 4], 0, 0) }).unwrap();
        // Editing into a clash is refused, and leaves the track as it was.
        assert!(update_calendar_track(&p, gym, &timed("Gym", &[2], 9 * 60 + 30, 60)).is_err());
        assert_eq!(load_track(&Connection::open(&p).unwrap(), gym).unwrap().weekdays, vec![1, 3]);
        // A track that only runs in the fall doesn't clash with one that only runs in the spring...
        add_calendar_term(&p, class, "Fall", "2026-09-01", "2026-12-15", false).unwrap();
        let spring = create_calendar_track(&p, &TrackInput { start_date: Some("2027-01-10".into()), ..timed("Spring class", &[2, 4], 9 * 60, 90) }).unwrap();
        // ...but removing the fall's term (so the first runs on forever) would make them clash.
        let term = load_terms(&Connection::open(&p).unwrap(), class).unwrap()[0].id;
        assert!(remove_calendar_term(&p, term).is_err());
        // An archived track's time is free; unarchiving it into a clash is refused.
        set_calendar_track_archived(&p, spring, true).unwrap();
        remove_calendar_term(&p, term).unwrap();
        assert!(set_calendar_track_archived(&p, spring, false).is_err());
        // Times stay within their day.
        assert!(create_calendar_track(&p, &timed("Late", &[7], 23 * 60, 90)).is_err());
    }

    #[test]
    fn days_list_every_cycle_and_undated_completions() {
        let p = temp_db();
        // A looping Mon/Wed/Fri track of 2, from Monday 2026-09-07: the week holds entry 0, 1, 0 (round 2 on Friday).
        let dated = track(&p, "hybrid", &[1, 3, 5], "2026-09-07", true);
        let e = tasks(&p, dated, 2);
        done(&p, dated, e[0], 0);
        // An undated track with one entry done.
        let chain = track(&p, "completion", &[], "2026-01-01", false);
        let c = tasks(&p, chain, 2);
        done(&p, chain, c[0], 0);
        let today = local_today();
        let week = list_calendar_days(&p, d("2026-09-07"), d("2026-09-13"), d("2026-09-10")).unwrap();
        let scheduled: Vec<_> = week.iter().filter(|i| i.track_id == dated).map(|i| (i.date.as_str(), i.title.as_str(), i.cycle, i.done, i.overdue)).collect();
        assert_eq!(scheduled, vec![
            ("2026-09-07", "Task 0", 0, true, false),
            ("2026-09-09", "Task 1", 0, false, true), // Wednesday, not done by Thursday the 10th
            ("2026-09-11", "Task 0", 1, false, false),
        ]);
        // The chain's done entry is on the day it was done (today, when the test runs).
        let on_today = list_calendar_days(&p, today, today, today).unwrap();
        assert!(on_today.iter().any(|i| i.track_id == chain && i.kind == "completed" && i.title == "Task 0"));
    }

    #[test]
    fn a_track_can_follow_its_drives_sequence() {
        let p = temp_db();
        for id in ["a", "b", "c"] {
            db::save_video(&p, id, &format!("Title {id}"), "Author", 60, "text", 1, "2026-01-01T00:00:00Z", "@a", None).unwrap();
            db::update_video_wdbs(&p, id, "θψCS_DSA").unwrap();
        }
        db::add_to_drive_sequence(&p, ":CS-DSA", &["b".into(), "a".into(), "c".into()]).unwrap();
        let t = create_calendar_track(&p, &TrackInput {
            name: "DSA".into(),
            drive: ":cs-dsa".into(),
            advance_mode: "completion".into(),
            loop_entries: false,
            source_drive_sequence: true,
            weekdays: vec![],
            start_date: None,
            time_start: None,
            time_duration: None,
        })
        .unwrap();
        let s = resolve_track(&p, t, local_today()).unwrap();
        let order: Vec<_> = s.entries.iter().map(|e| e.video_id.clone().unwrap()).collect();
        assert_eq!(order, vec!["b", "a", "c"]);
        assert!(s.entries.iter().all(|e| e.id == 0));
        // Marking one done by its video makes its row then.
        set_calendar_completion(&p, t, None, Some("b"), 0, true).unwrap();
        let s = resolve_track(&p, t, local_today()).unwrap();
        assert_eq!(s.current, Some(1));
        assert!(s.entries[0].id > 0 && s.entries[0].done);
    }
}
