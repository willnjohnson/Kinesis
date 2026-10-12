//! Logs: a plain record of what was done, day by day (the Logs section). A log is a name the reader gives it; its
//! entries each have the day they were made, a title and a description. Unlike the Calendar, nothing here is planned or
//! ticked off: it's written after the fact.
//!
//! A day has one row in a log (`idxLogEntriesDay`), named by its date, which is never changed; its entry (`title` in
//! the data) and description can be, at any time, for any day past or to come. More to say about a day is another line
//! of its description. The description is plain text with a little emphasis
//! (bold, italic, strikethrough, highlight) and nothing else: no links, so these columns aren't among the texts the app
//! scans and rewrites links in (db/links.rs).
//!
//! Logs are the reader's own, like pins and personal notes: one table set, never exported in a Kinpak or synced.

use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The longest name a log can have, and the longest title an entry can.
pub const MAX_LOG_NAME: usize = 80;
pub const MAX_LOG_TITLE: usize = 200;
/// The longest a day's description can be. Room for a long day; a log is a record, not a document.
pub const MAX_LOG_DESCRIPTION: usize = 5000;

fn invalid(msg: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, msg.into())))
}

/// Creates the two tables (called from init_db). STRICT, like every table here.
pub fn ensure_logs_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS Logs (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            remind INTEGER NOT NULL DEFAULT 0,
            entry_template TEXT NOT NULL DEFAULT ''
        ) STRICT;
        CREATE TABLE IF NOT EXISTS LogEntries (
            id INTEGER PRIMARY KEY,
            log_id TEXT NOT NULL,
            date TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        ) STRICT;
        DROP INDEX IF EXISTS idxLogEntriesLog;",
    )?;
    // The bell (a log from before there was one has it off).
    if !super::schema::column_exists(conn, "Logs", "remind")? {
        conn.execute_batch("ALTER TABLE Logs ADD COLUMN remind INTEGER NOT NULL DEFAULT 0;")?;
    }
    // What a day's Entry starts as (EntryTemplate, as JSON; '' for none).
    if !super::schema::column_exists(conn, "Logs", "entry_template")? {
        conn.execute_batch("ALTER TABLE Logs ADD COLUMN entry_template TEXT NOT NULL DEFAULT '';")?;
    }
    // A day is one row. Rows from before that was the rule are put together first (the unique index can't be made
    // over two rows for a day): the first one made is kept, with the first entry there was and every description, in
    // the order they were written, a line each.
    let doubled: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT log_id, date FROM LogEntries GROUP BY log_id, date HAVING COUNT(*) > 1")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_>>()?
    };
    for (log_id, date) in doubled {
        let rows: Vec<(i64, String, String)> = {
            let mut stmt = conn.prepare("SELECT id, title, description FROM LogEntries WHERE log_id = ?1 AND date = ?2 ORDER BY id")?;
            let found = stmt.query_map(params![log_id, date], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            found.collect::<Result<_>>()?
        };
        let title = rows.iter().map(|r| r.1.trim()).find(|t| !t.is_empty()).unwrap_or("").to_string();
        let description = rows.iter().map(|r| r.2.trim()).filter(|d| !d.is_empty()).collect::<Vec<_>>().join("\n");
        conn.execute("UPDATE LogEntries SET title = ?1, description = ?2 WHERE id = ?3", params![title, description, rows[0].0])?;
        conn.execute("DELETE FROM LogEntries WHERE log_id = ?1 AND date = ?2 AND id != ?3", params![log_id, date, rows[0].0])?;
    }
    conn.execute_batch("CREATE UNIQUE INDEX IF NOT EXISTS idxLogEntriesDay ON LogEntries(log_id, date);")
}

/// What a day's Entry starts as in a log, before anything is written for that day: `all` for any day, and `days`
/// (seven, Sunday first) for a weekday that has its own; a weekday left empty uses `all`. So a training log can say
/// "Push" on Mondays and "Rest" on Sundays without it being typed each week. Only what the sheet shows in a day with
/// no row: nothing is stored for a day until it's written in. `{{weekday}}` and `{{date}}` in a text are filled in
/// by the sheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct EntryTemplate {
    pub all: String,
    pub days: Vec<String>,
}

impl Default for EntryTemplate {
    fn default() -> Self {
        EntryTemplate { all: String::new(), days: vec![String::new(); 7] }
    }
}

impl EntryTemplate {
    fn is_empty(&self) -> bool {
        self.all.is_empty() && self.days.iter().all(String::is_empty)
    }

    /// As it's stored: JSON, or '' for none (which is what list_logs_due looks at).
    fn stored(&self) -> String {
        if self.is_empty() { String::new() } else { serde_json::to_string(self).unwrap_or_default() }
    }

    /// From what's stored. Anything unreadable is no template.
    fn read(stored: &str) -> Self {
        let mut t: EntryTemplate = serde_json::from_str(stored).unwrap_or_default();
        t.days.resize(7, String::new());
        t
    }
}

/// A log, with how much is in it (so the ones in use are plain to see without opening each).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Log {
    pub id: String,
    pub name: String,
    pub entries: i64,
    /// The date of its latest entry ("2026-10-10"), or None while it has none.
    pub last_date: Option<String>,
    pub created_at: String,
    /// Its bell: on a day nothing's been written in it, the pin menu says so (list_logs_due).
    pub remind: bool,
    /// What a day's Entry starts as (all empty for none).
    pub entry_template: EntryTemplate,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: i64,
    pub log_id: String,
    /// The day it was made ("2026-10-10"). Never changed.
    pub date: String,
    pub title: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
}

fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut hash = Sha256::new();
    hash.update(b"log");
    hash.update(chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default().to_le_bytes());
    hash.update(std::process::id().to_le_bytes());
    hash.update(COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    hash.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

fn clean_name(name: &str) -> Result<String> {
    let one_line = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.is_empty() {
        return Err(invalid("A log needs a name."));
    }
    if one_line.chars().count() > MAX_LOG_NAME {
        return Err(invalid(format!("A log's name can be at most {MAX_LOG_NAME} characters.")));
    }
    Ok(one_line)
}

fn clean_title(title: &str) -> Result<String> {
    let one_line = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() > MAX_LOG_TITLE {
        return Err(invalid(format!("An entry can be at most {MAX_LOG_TITLE} characters.")));
    }
    Ok(one_line)
}

/// A name is one log's: two called the same (in any capitals) couldn't be told apart in the list.
fn name_taken(conn: &Connection, name: &str, except: Option<&str>) -> Result<bool> {
    let found: Option<String> = conn
        .query_row("SELECT id FROM Logs WHERE name = ?1 COLLATE NOCASE", params![name], |r| r.get(0))
        .optional()?;
    Ok(found.is_some_and(|id| Some(id.as_str()) != except))
}

const LOG_SELECT: &str = "SELECT l.id, l.name, (SELECT COUNT(*) FROM LogEntries e WHERE e.log_id = l.id),
            (SELECT MAX(e.date) FROM LogEntries e WHERE e.log_id = l.id), l.created_at, l.remind, l.entry_template FROM Logs l";

fn read_log(r: &rusqlite::Row) -> Result<Log> {
    Ok(Log { id: r.get(0)?, name: r.get(1)?, entries: r.get(2)?, last_date: r.get(3)?, created_at: r.get(4)?, remind: r.get::<_, i64>(5)? != 0, entry_template: EntryTemplate::read(&r.get::<_, String>(6)?) })
}

fn need_log(conn: &Connection, id: &str) -> Result<Log> {
    conn.query_row(&format!("{LOG_SELECT} WHERE l.id = ?1"), params![id], read_log)
        .optional()?
        .ok_or_else(|| invalid("That log doesn't exist any more."))
}

/// Every log: the ones with entries first (latest entry first), then the empty ones by name.
pub fn list_logs(db_path: &str) -> Result<Vec<Log>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(LOG_SELECT)?;
    let mut all = stmt.query_map([], read_log)?.collect::<Result<Vec<_>>>()?;
    all.sort_by(|a, b| {
        b.last_date.is_some().cmp(&a.last_date.is_some())
            .then_with(|| b.last_date.cmp(&a.last_date))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(all)
}

pub fn create_log(db_path: &str, name: &str) -> Result<Log> {
    let name = clean_name(name)?;
    let conn = Connection::open(db_path)?;
    if name_taken(&conn, &name, None)? {
        return Err(invalid(format!("There's already a log called \"{name}\".")));
    }
    let id = new_id();
    conn.execute("INSERT INTO Logs (id, name, created_at) VALUES (?1, ?2, ?3)", params![id, name, now()])?;
    need_log(&conn, &id)
}

pub fn rename_log(db_path: &str, id: &str, name: &str) -> Result<Log> {
    let name = clean_name(name)?;
    let conn = Connection::open(db_path)?;
    need_log(&conn, id)?;
    if name_taken(&conn, &name, Some(id))? {
        return Err(invalid(format!("There's already a log called \"{name}\".")));
    }
    conn.execute("UPDATE Logs SET name = ?1 WHERE id = ?2", params![name, id])?;
    need_log(&conn, id)
}

/// Turns a log's bell on or off.
pub fn set_log_remind(db_path: &str, id: &str, remind: bool) -> Result<Log> {
    let conn = Connection::open(db_path)?;
    need_log(&conn, id)?;
    conn.execute("UPDATE Logs SET remind = ?1 WHERE id = ?2", params![remind as i64, id])?;
    need_log(&conn, id)
}

/// Sets (or, all empty, clears) what a day's Entry starts as in a log.
pub fn set_log_entry_template(db_path: &str, id: &str, template: &EntryTemplate) -> Result<Log> {
    let mut clean = EntryTemplate { all: clean_title(&template.all)?, days: Vec::with_capacity(7) };
    for day in 0..7 {
        clean.days.push(clean_title(template.days.get(day).map(String::as_str).unwrap_or(""))?);
    }
    let conn = Connection::open(db_path)?;
    need_log(&conn, id)?;
    conn.execute("UPDATE Logs SET entry_template = ?1 WHERE id = ?2", params![clean.stored(), id])?;
    need_log(&conn, id)
}

/// The logs to be reminded of on `today` ("2026-10-10", the reader's own day): the ones with their bell on that
/// haven't been written in for that day. For a log with an entry template that means a description: its Entry is
/// there before anything is typed, so a row with only that says nothing was done. Without a template, any row for
/// the day counts. By name.
pub fn list_logs_due(db_path: &str, today: &str) -> Result<Vec<Log>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(&format!(
        "{LOG_SELECT} WHERE l.remind = 1 AND NOT EXISTS (
             SELECT 1 FROM LogEntries e WHERE e.log_id = l.id AND e.date = ?1 AND (l.entry_template = '' OR TRIM(e.description) != ''))
         ORDER BY l.name COLLATE NOCASE"
    ))?;
    let rows = stmt.query_map(params![today.trim()], read_log)?;
    rows.collect()
}

/// Deletes a log and everything written in it.
pub fn delete_log(db_path: &str, id: &str) -> Result<()> {
    let mut conn = Connection::open(db_path)?;
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM LogEntries WHERE log_id = ?1", params![id])?;
    tx.execute("DELETE FROM Logs WHERE id = ?1", params![id])?;
    tx.commit()
}

const ENTRY_COLUMNS: &str = "id, log_id, date, title, description, created_at, updated_at";

fn read_entry(r: &rusqlite::Row) -> Result<LogEntry> {
    Ok(LogEntry { id: r.get(0)?, log_id: r.get(1)?, date: r.get(2)?, title: r.get(3)?, description: r.get(4)?, created_at: r.get(5)?, updated_at: r.get(6)? })
}

/// A log's entries, the latest day first, and within a day the one made last first.
pub fn list_log_entries(db_path: &str, log_id: &str) -> Result<Vec<LogEntry>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(&format!("SELECT {ENTRY_COLUMNS} FROM LogEntries WHERE log_id = ?1 ORDER BY date DESC, id DESC"))?;
    let rows = stmt.query_map(params![log_id], read_entry)?;
    rows.collect()
}

/// Writes a log's day: its entry and description, for the day `date` ("2026-10-10"). A day has one row, so this is
/// the whole of it: the row is made if the day had none, changed if it had one, and removed when both are left empty
/// (None is then what's returned). The date is the row's own: it's what says which row, and is never changed.
pub fn write_log_day(db_path: &str, log_id: &str, date: &str, title: &str, description: &str) -> Result<Option<LogEntry>> {
    let title = clean_title(title)?;
    let description = description.trim();
    if description.chars().count() > MAX_LOG_DESCRIPTION {
        return Err(invalid(format!("A description can be at most {MAX_LOG_DESCRIPTION} characters.")));
    }
    let date = chrono::NaiveDate::parse_from_str(date.trim(), "%Y-%m-%d").map_err(|_| invalid("That isn't a date."))?.format("%Y-%m-%d").to_string();
    let conn = Connection::open(db_path)?;
    need_log(&conn, log_id)?;
    if title.is_empty() && description.is_empty() {
        conn.execute("DELETE FROM LogEntries WHERE log_id = ?1 AND date = ?2", params![log_id, date])?;
        return Ok(None);
    }
    let at = now();
    conn.execute(
        "INSERT INTO LogEntries (log_id, date, title, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT (log_id, date) DO UPDATE SET title = excluded.title, description = excluded.description, updated_at = excluded.updated_at",
        params![log_id, date, title, description, at],
    )?;
    conn.query_row(&format!("SELECT {ENTRY_COLUMNS} FROM LogEntries WHERE log_id = ?1 AND date = ?2"), params![log_id, date], read_entry).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_db;

    fn temp_db(name: &str) -> String {
        let path = std::env::temp_dir().join(format!("kinesis_logs_{name}_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let p = path.to_string_lossy().to_string();
        init_db(&p).unwrap();
        p
    }

    #[test]
    fn a_log_has_one_row_a_day_and_keeps_its_dates() {
        let p = temp_db("days");
        let training = create_log(&p, "  Training  ").unwrap();
        let empty = create_log(&p, "Reading").unwrap();
        assert_eq!((training.name.as_str(), training.entries, training.last_date.clone()), ("Training", 0, None));
        assert!(create_log(&p, "training").is_err(), "a name is one log's, whatever its capitals");
        assert!(create_log(&p, " ").is_err());

        let a = write_log_day(&p, &training.id, "2026-10-09", "Legs", "Squats, **heavy**.").unwrap().unwrap();
        write_log_day(&p, &training.id, "2026-10-10", "Pull", "").unwrap().unwrap();
        // Written again, a day is the same row with other words: never a second row.
        let again = write_log_day(&p, &training.id, "2026-10-09", "Leg day", "Squats.\nThen lunges.").unwrap().unwrap();
        assert_eq!((again.id, again.date.as_str(), again.title.as_str()), (a.id, "2026-10-09", "Leg day"));
        assert!(write_log_day(&p, &training.id, "yesterday", "x", "").is_err());
        assert!(write_log_day(&p, &training.id, "2026-10-09", &"x".repeat(MAX_LOG_TITLE + 1), "").is_err());
        assert!(write_log_day(&p, &training.id, "2026-10-09", "x", &"x".repeat(MAX_LOG_DESCRIPTION + 1)).is_err());
        assert!(write_log_day(&p, "nope", "2026-10-10", "x", "").is_err());
        // The latest day first.
        assert_eq!(list_log_entries(&p, &training.id).unwrap().iter().map(|e| e.date.as_str()).collect::<Vec<_>>(), vec!["2026-10-10", "2026-10-09"]);

        // The log in use is listed first, with what it holds.
        let logs = list_logs(&p).unwrap();
        assert_eq!(logs.iter().map(|l| (l.name.as_str(), l.entries, l.last_date.as_deref())).collect::<Vec<_>>(),
            vec![("Training", 2, Some("2026-10-10")), ("Reading", 0, None)]);

        // Emptied, the day's row goes.
        assert!(write_log_day(&p, &training.id, "2026-10-10", " ", " ").unwrap().is_none());
        assert_eq!(list_log_entries(&p, &training.id).unwrap().len(), 1);
        assert_eq!(rename_log(&p, &empty.id, "Books").unwrap().name, "Books");
        assert!(rename_log(&p, &empty.id, "TRAINING").is_err());
        delete_log(&p, &training.id).unwrap();
        assert!(list_log_entries(&p, &training.id).unwrap().is_empty());
        assert_eq!(list_logs(&p).unwrap().len(), 1);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn a_log_with_its_bell_on_is_due_until_its_day_is_written() {
        let p = temp_db("bell");
        let training = create_log(&p, "Training").unwrap();
        let reading = create_log(&p, "Reading").unwrap();
        assert!(!training.remind);
        assert!(list_logs_due(&p, "2026-10-10").unwrap().is_empty(), "no bell, no reminder");
        assert!(set_log_remind(&p, &training.id, true).unwrap().remind);
        set_log_remind(&p, &reading.id, true).unwrap();
        let due = |day: &str| list_logs_due(&p, day).unwrap().into_iter().map(|l| l.name).collect::<Vec<_>>();
        assert_eq!(due("2026-10-10"), vec!["Reading", "Training"]);
        // A row for another day (one ahead, even) doesn't count: it's today's that's asked after.
        write_log_day(&p, &training.id, "2026-10-11", "Planned", "").unwrap();
        assert_eq!(due("2026-10-10"), vec!["Reading", "Training"]);
        write_log_day(&p, &training.id, "2026-10-10", "Legs", "").unwrap();
        assert_eq!(due("2026-10-10"), vec!["Reading"]);
        // Emptied again, it's due again; with the bell off, it isn't.
        write_log_day(&p, &training.id, "2026-10-10", "", "").unwrap();
        assert_eq!(due("2026-10-10"), vec!["Reading", "Training"]);
        set_log_remind(&p, &reading.id, false).unwrap();
        assert_eq!(due("2026-10-10"), vec!["Training"]);

        // With an entry template, the day's Entry is there already: it's the description that answers the bell.
        let mut days = vec![String::new(); 7];
        days[6] = "Long run".into();
        let set = set_log_entry_template(&p, &training.id, &EntryTemplate { all: "  Gym   session ".into(), days: days.clone() }).unwrap();
        assert_eq!((set.entry_template.all.as_str(), set.entry_template.days[6].as_str()), ("Gym session", "Long run"));
        write_log_day(&p, &training.id, "2026-10-10", "Long run", "").unwrap();
        assert_eq!(due("2026-10-10"), vec!["Training"], "an entry alone isn't the day written");
        write_log_day(&p, &training.id, "2026-10-10", "Long run", "12 km, easy.").unwrap();
        assert!(due("2026-10-10").is_empty());
        // Cleared, the log is as it was: any row counts again.
        let cleared = set_log_entry_template(&p, &training.id, &EntryTemplate::default()).unwrap();
        assert_eq!(cleared.entry_template, EntryTemplate::default());
        write_log_day(&p, &training.id, "2026-10-10", "Long run", "").unwrap();
        assert!(due("2026-10-10").is_empty());
        assert!(set_log_entry_template(&p, &training.id, &EntryTemplate { all: "x".repeat(MAX_LOG_TITLE + 1), days }).is_err());

        // A database from before the bell and the template gets the columns, off and empty.
        let conn = Connection::open(&p).unwrap();
        conn.execute_batch("ALTER TABLE Logs DROP COLUMN remind; ALTER TABLE Logs DROP COLUMN entry_template;").unwrap();
        ensure_logs_schema(&conn).unwrap();
        assert!(list_logs(&p).unwrap().iter().all(|l| !l.remind && l.entry_template == EntryTemplate::default()));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn days_written_twice_before_the_rule_are_merged() {
        let p = temp_db("merge");
        let log = create_log(&p, "Old").unwrap();
        let conn = Connection::open(&p).unwrap();
        // As a database from before a day was one row: no unique index, and two rows for a day.
        conn.execute_batch("DROP INDEX idxLogEntriesDay;").unwrap();
        for (title, description) in [("", "First."), ("Run", ""), ("Later", "Second.")] {
            conn.execute(
                "INSERT INTO LogEntries (log_id, date, title, description, created_at, updated_at) VALUES (?1, '2026-10-10', ?2, ?3, 't', 't')",
                params![log.id, title, description],
            ).unwrap();
        }
        ensure_logs_schema(&conn).unwrap();
        let rows = list_log_entries(&p, &log.id).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].title.as_str(), rows[0].description.as_str()), ("Run", "First.\nSecond."));
        let _ = std::fs::remove_file(&p);
    }
}
