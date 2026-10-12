//! Workbooks: notes put in an order of the author's choosing, to be read through a page at a time (the Notes section's
//! Workbooks). A workbook is only a name and that order: it holds no text of its own, a note can be in several or in
//! none, and deleting a workbook never deletes its notes.
//!
//! Like notes, two tables of one shape: `Workbooks` (shared) and `PersonalWorkbooks` (the reader's own), with a
//! workbook's id the same in either, so moving it between them keeps links to it. One table, `WorkbookNotes`, holds
//! every workbook's notes in order. A shared workbook holds shared notes only: what's shared has to be whole for whoever
//! it's shared with, and a personal note never leaves this reader. Adding a personal note to one is refused, saying so.
//!
//! Nothing here follows a note being deleted: its row in `WorkbookNotes` stays, and is simply not listed while the note
//! is gone (or, in a shared workbook, while it's personal). So a note restored from the Trash, or shared again, is back
//! in its place without anything having had to remember where that was.

use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{params, Connection, OptionalExtension, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::links::{apply_link_edits, LinkEdit, LinkKind};
use super::notes::{PERSONAL_NOTES, SHARED_NOTES};

pub const SHARED_WORKBOOKS: &str = "Workbooks";
pub const PERSONAL_WORKBOOKS: &str = "PersonalWorkbooks";
const TABLES: [&str; 2] = [SHARED_WORKBOOKS, PERSONAL_WORKBOOKS];

/// The longest title a workbook can have.
pub const MAX_WORKBOOK_TITLE: usize = 120;

fn invalid(msg: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, msg.into())))
}

/// Creates the three tables (called from init_db). STRICT, like every table here.
pub fn ensure_workbooks_schema(conn: &Connection) -> Result<()> {
    for table in TABLES {
        conn.execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {table} (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            ) STRICT;"
        ))?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS WorkbookNotes (
            workbook_id TEXT NOT NULL,
            note_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (workbook_id, note_id)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS idxWorkbookNotesOrder ON WorkbookNotes(workbook_id, position);",
    )
}

/// A workbook, with its notes in order (the ones there are to read: see the module notes).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workbook {
    pub id: String,
    pub title: String,
    pub shared: bool,
    pub note_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

fn now() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut hash = Sha256::new();
    hash.update(b"workbook");
    hash.update(chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default().to_le_bytes());
    hash.update(std::process::id().to_le_bytes());
    hash.update(COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    hash.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

fn clean_title(title: &str) -> Result<String> {
    let one_line = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.is_empty() {
        return Err(invalid("A workbook needs a name."));
    }
    if one_line.chars().count() > MAX_WORKBOOK_TITLE {
        return Err(invalid(format!("A workbook's name can be at most {MAX_WORKBOOK_TITLE} characters.")));
    }
    Ok(one_line)
}

fn table_for(shared: bool) -> &'static str {
    if shared { SHARED_WORKBOOKS } else { PERSONAL_WORKBOOKS }
}

/// A workbook's notes in order: every one that exists for a personal workbook, the shared ones for a shared workbook.
fn note_ids(conn: &Connection, id: &str, shared: bool) -> Result<Vec<String>> {
    let exists = if shared {
        format!("EXISTS (SELECT 1 FROM {SHARED_NOTES} n WHERE n.id = w.note_id)")
    } else {
        format!("(EXISTS (SELECT 1 FROM {SHARED_NOTES} n WHERE n.id = w.note_id) OR EXISTS (SELECT 1 FROM {PERSONAL_NOTES} n WHERE n.id = w.note_id))")
    };
    let mut stmt = conn.prepare(&format!("SELECT w.note_id FROM WorkbookNotes w WHERE w.workbook_id = ?1 AND {exists} ORDER BY w.position, w.note_id"))?;
    let rows = stmt.query_map(params![id], |r| r.get(0))?;
    rows.collect()
}

fn find(conn: &Connection, id: &str) -> Result<Option<Workbook>> {
    for table in TABLES {
        let shared = table == SHARED_WORKBOOKS;
        let row: Option<(String, String, String, String)> = conn
            .query_row(&format!("SELECT id, title, created_at, updated_at FROM {table} WHERE id = ?1"), params![id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .optional()?;
        if let Some((id, title, created_at, updated_at)) = row {
            let note_ids = note_ids(conn, &id, shared)?;
            return Ok(Some(Workbook { id, title, shared, note_ids, created_at, updated_at }));
        }
    }
    Ok(None)
}

fn need(conn: &Connection, id: &str) -> Result<Workbook> {
    find(conn, id)?.ok_or_else(|| invalid("That workbook doesn't exist any more."))
}

fn touch(conn: &Connection, book: &Workbook) -> Result<()> {
    conn.execute(&format!("UPDATE {} SET updated_at = ?1 WHERE id = ?2", table_for(book.shared)), params![now(), book.id])?;
    Ok(())
}

/// Every workbook, shared and personal, by name.
pub fn list_workbooks(db_path: &str) -> Result<Vec<Workbook>> {
    let conn = Connection::open(db_path)?;
    let mut ids: Vec<String> = Vec::new();
    for table in TABLES {
        let mut stmt = conn.prepare(&format!("SELECT id FROM {table}"))?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        ids.extend(rows.collect::<Result<Vec<String>>>()?);
    }
    let mut all = ids.iter().map(|id| need(&conn, id)).collect::<Result<Vec<_>>>()?;
    all.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()).then_with(|| a.id.cmp(&b.id)));
    Ok(all)
}

pub fn get_workbook(db_path: &str, id: &str) -> Result<Option<Workbook>> {
    find(&Connection::open(db_path)?, id)
}

/// Makes an empty workbook.
pub fn create_workbook(db_path: &str, shared: bool, title: &str) -> Result<Workbook> {
    let title = clean_title(title)?;
    let conn = Connection::open(db_path)?;
    let (id, at) = (new_id(), now());
    conn.execute(&format!("INSERT INTO {} (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)", table_for(shared)), params![id, title, at])?;
    need(&conn, &id)
}

pub fn rename_workbook(db_path: &str, id: &str, title: &str) -> Result<Workbook> {
    let title = clean_title(title)?;
    let conn = Connection::open(db_path)?;
    let book = need(&conn, id)?;
    conn.execute(&format!("UPDATE {} SET title = ?1, updated_at = ?2 WHERE id = ?3", table_for(book.shared)), params![title, now(), id])?;
    need(&conn, id)
}

/// How many of a workbook's notes are personal (the ones a shared workbook can't hold).
fn personal_notes_in(conn: &Connection, id: &str) -> Result<i64> {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM WorkbookNotes w WHERE w.workbook_id = ?1 AND EXISTS (SELECT 1 FROM {PERSONAL_NOTES} n WHERE n.id = w.note_id)"),
        params![id],
        |r| r.get(0),
    )
}

/// Makes a workbook shared or personal, keeping its id. With `with_notes`, its notes go with it (each one shared, or
/// made personal, as the workbook is), and it's all one transaction: every note and the workbook, or none of it.
/// Without it, sharing a workbook that holds personal notes is refused: they'd be left behind, and the workbook
/// shared with holes in it.
pub fn set_workbook_shared(db_path: &str, id: &str, shared: bool, with_notes: bool) -> Result<Workbook> {
    let mut conn = Connection::open(db_path)?;
    let book = need(&conn, id)?;
    if book.shared == shared && !with_notes {
        return Ok(book);
    }
    if shared && !with_notes {
        let personal = personal_notes_in(&conn, id)?;
        if personal > 0 {
            return Err(invalid(format!(
                "{personal} of this workbook's notes {} personal. Share {} first (or take {} out): a shared workbook holds shared notes only.",
                if personal == 1 { "is" } else { "are" },
                if personal == 1 { "it" } else { "them" },
                if personal == 1 { "it" } else { "them" },
            )));
        }
    }
    let tx = conn.transaction()?;
    if with_notes {
        // Every note it has a place for, listed or not (a personal one in a shared workbook isn't listed, and is one of
        // the ones to bring along).
        let note_ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT note_id FROM WorkbookNotes WHERE workbook_id = ?1 ORDER BY position")?;
            let rows = stmt.query_map(params![id], |r| r.get(0))?;
            rows.collect::<Result<_>>()?
        };
        for note_id in &note_ids {
            super::notes::move_note(&tx, note_id, shared)?;
        }
    }
    if book.shared != shared {
        tx.execute(&format!("DELETE FROM {} WHERE id = ?1", table_for(book.shared)), params![id])?;
        tx.execute(
            &format!("INSERT INTO {} (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)", table_for(shared)),
            params![book.id, book.title, book.created_at, now()],
        )?;
    }
    tx.commit()?;
    need(&conn, id)
}

/// Deletes a workbook (its notes stay), and turns links to it back into plain words.
pub fn delete_workbook(db_path: &str, id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let Some(book) = find(&conn, id)? else { return Ok(()) };
    conn.execute(&format!("DELETE FROM {} WHERE id = ?1", table_for(book.shared)), params![id])?;
    conn.execute("DELETE FROM WorkbookNotes WHERE workbook_id = ?1", params![id])?;
    // Its pages on Calendar tracks stay, as the notes they are; they just no longer open in it.
    conn.execute("UPDATE CalendarEntries SET workbook_id = NULL WHERE workbook_id = ?1", params![id])?;
    drop(conn);
    apply_link_edits(db_path, &[LinkEdit::Unlink(LinkKind::Workbook, id.to_string())]).map(|_| ())
}

/// Adds a note to the end of a workbook. A personal note isn't taken into a shared workbook.
pub fn add_note_to_workbook(db_path: &str, id: &str, note_id: &str) -> Result<Workbook> {
    let conn = Connection::open(db_path)?;
    let book = need(&conn, id)?;
    let note = super::notes::get_note(db_path, note_id)?.ok_or_else(|| invalid("That note doesn't exist any more."))?;
    if book.shared && !note.shared {
        return Err(invalid(format!(
            "\"{}\" is a shared workbook, and this note is personal. Share the note first: a shared workbook holds shared notes only.",
            book.title
        )));
    }
    if book.note_ids.iter().any(|n| n == note_id) {
        return Err(invalid(format!("That note is already in \"{}\".", book.title)));
    }
    let position: i64 = conn.query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM WorkbookNotes WHERE workbook_id = ?1", params![id], |r| r.get(0))?;
    // OR REPLACE: a row left from when the note was last here (see the module notes) gives way to the new place.
    conn.execute("INSERT OR REPLACE INTO WorkbookNotes (workbook_id, note_id, position) VALUES (?1, ?2, ?3)", params![id, note_id, position])?;
    touch(&conn, &book)?;
    need(&conn, id)
}

pub fn remove_note_from_workbook(db_path: &str, id: &str, note_id: &str) -> Result<Workbook> {
    let conn = Connection::open(db_path)?;
    let book = need(&conn, id)?;
    conn.execute("DELETE FROM WorkbookNotes WHERE workbook_id = ?1 AND note_id = ?2", params![id, note_id])?;
    touch(&conn, &book)?;
    need(&conn, id)
}

/// Puts a workbook's notes in the order given. Every note it lists has to be named once: an order that leaves one out,
/// or names one it doesn't have, is refused rather than guessed at.
pub fn reorder_workbook(db_path: &str, id: &str, order: &[String]) -> Result<Workbook> {
    let mut conn = Connection::open(db_path)?;
    let book = need(&conn, id)?;
    let mut given: Vec<&String> = order.iter().collect();
    let mut have: Vec<&String> = book.note_ids.iter().collect();
    given.sort();
    have.sort();
    if given != have {
        return Err(invalid("The workbook has changed since. Try again."));
    }
    let tx = conn.transaction()?;
    for (i, note_id) in order.iter().enumerate() {
        tx.execute("UPDATE WorkbookNotes SET position = ?1 WHERE workbook_id = ?2 AND note_id = ?3", params![i as i64 + 1, id, note_id])?;
    }
    tx.commit()?;
    touch(&conn, &book)?;
    need(&conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{create_note, delete_note_recorded, init_db, restore_note, set_note_shared};

    fn temp_db(name: &str) -> String {
        let path = std::env::temp_dir().join(format!("kinesis_workbooks_{name}_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let p = path.to_string_lossy().to_string();
        init_db(&p).unwrap();
        p
    }

    #[test]
    fn a_workbook_keeps_its_notes_in_the_authors_order() {
        let p = temp_db("order");
        let ids: Vec<String> = ["One", "Two", "Three"].iter().map(|t| create_note(&p, false, t, "", &[]).unwrap().id).collect();
        let book = create_workbook(&p, false, "  German   A1 ").unwrap();
        assert_eq!((book.title.as_str(), book.shared, book.note_ids.len()), ("German A1", false, 0));
        assert!(create_workbook(&p, false, "  ").is_err());
        for id in &ids {
            add_note_to_workbook(&p, &book.id, id).unwrap();
        }
        assert!(add_note_to_workbook(&p, &book.id, &ids[0]).is_err(), "a note is in a workbook once");
        let order = vec![ids[2].clone(), ids[0].clone(), ids[1].clone()];
        assert_eq!(reorder_workbook(&p, &book.id, &order).unwrap().note_ids, order);
        assert!(reorder_workbook(&p, &book.id, &order[..2]).is_err(), "an order has to name every note");

        // A deleted note isn't listed, and is back in its place when it's restored.
        let (gone, _) = delete_note_recorded(&p, &ids[0]).unwrap().unwrap();
        assert_eq!(get_workbook(&p, &book.id).unwrap().unwrap().note_ids, vec![ids[2].clone(), ids[1].clone()]);
        restore_note(&p, &gone).unwrap();
        assert_eq!(get_workbook(&p, &book.id).unwrap().unwrap().note_ids, order);

        assert_eq!(remove_note_from_workbook(&p, &book.id, &ids[2]).unwrap().note_ids, vec![ids[0].clone(), ids[1].clone()]);
        assert_eq!(rename_workbook(&p, &book.id, "German A2").unwrap().title, "German A2");
        delete_workbook(&p, &book.id).unwrap();
        assert!(get_workbook(&p, &book.id).unwrap().is_none());
        assert!(crate::db::get_note(&p, &ids[1]).unwrap().is_some(), "its notes stay");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn a_shared_workbook_holds_shared_notes_only() {
        let p = temp_db("shared");
        let personal = create_note(&p, false, "Mine", "", &[]).unwrap();
        let shared = create_note(&p, true, "Ours", "", &[]).unwrap();
        let book = create_workbook(&p, true, "Course").unwrap();
        let err = add_note_to_workbook(&p, &book.id, &personal.id).unwrap_err().to_string();
        assert!(err.contains("Share the note first"), "{err}");
        add_note_to_workbook(&p, &book.id, &shared.id).unwrap();

        // A personal workbook takes either, and can't be shared while it holds a personal note.
        let own = create_workbook(&p, false, "Scratch").unwrap();
        add_note_to_workbook(&p, &own.id, &personal.id).unwrap();
        add_note_to_workbook(&p, &own.id, &shared.id).unwrap();
        assert!(set_workbook_shared(&p, &own.id, true, false).is_err());
        set_note_shared(&p, &personal.id, true).unwrap();
        let moved = set_workbook_shared(&p, &own.id, true, false).unwrap();
        assert_eq!((moved.id.as_str(), moved.shared, moved.note_ids.len()), (own.id.as_str(), true, 2));

        // A note made personal again drops out of the shared workbook's list, and comes back when it's shared again.
        set_note_shared(&p, &personal.id, false).unwrap();
        assert_eq!(get_workbook(&p, &own.id).unwrap().unwrap().note_ids, vec![shared.id.clone()]);
        set_note_shared(&p, &personal.id, true).unwrap();
        assert_eq!(get_workbook(&p, &own.id).unwrap().unwrap().note_ids.len(), 2);
        assert_eq!(list_workbooks(&p).unwrap().len(), 2);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn a_workbook_and_its_notes_can_be_shared_together() {
        let p = temp_db("together");
        let a = create_note(&p, false, "A", "", &[]).unwrap();
        let b = create_note(&p, true, "B", "", &[]).unwrap();
        let book = create_workbook(&p, false, "Course").unwrap();
        add_note_to_workbook(&p, &book.id, &a.id).unwrap();
        add_note_to_workbook(&p, &book.id, &b.id).unwrap();

        let shared = set_workbook_shared(&p, &book.id, true, true).unwrap();
        assert_eq!((shared.shared, shared.note_ids.len()), (true, 2));
        assert!(crate::db::list_notes(&p).unwrap().iter().all(|n| n.shared));
        // And back: the workbook and both notes are personal again, in the same order.
        let own = set_workbook_shared(&p, &book.id, false, true).unwrap();
        assert_eq!((own.shared, own.note_ids.clone()), (false, vec![a.id.clone(), b.id.clone()]));
        assert!(crate::db::list_notes(&p).unwrap().iter().all(|n| !n.shared));
        let _ = std::fs::remove_file(&p);
    }
}
