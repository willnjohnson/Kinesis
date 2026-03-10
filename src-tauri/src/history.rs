use rusqlite::{Connection, Result, params};

/// Add (or update the timestamp of) a query in history.
/// Deduplication: same query just updates `searched_at`.
pub fn add_history(path: &str, query: &str) -> Result<()> {
    let conn = Connection::open(path)?;
    conn.execute(
        "INSERT INTO search_history (query, searched_at)
         VALUES (?1, datetime('now', 'localtime'))
         ON CONFLICT(query) DO UPDATE SET searched_at = datetime('now', 'localtime')",
        params![query],
    )?;
    Ok(())
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: i64,
    pub query: String,
    #[serde(rename = "searchedAt")]
    pub searched_at: String,
}

/// Return the N most recent history entries.
pub fn get_history(path: &str, limit: i64) -> Result<Vec<HistoryEntry>> {
    let conn = Connection::open(path)?;
    let mut stmt = conn.prepare(
        "SELECT id, query, searched_at FROM search_history
         ORDER BY searched_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(HistoryEntry {
            id: row.get(0)?,
            query: row.get(1)?,
            searched_at: row.get(2)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Delete all entries on or before the given date (YYYY-MM-DD).
pub fn clear_history_before(path: &str, date: &str) -> Result<usize> {
    let conn = Connection::open(path)?;
    let n = conn.execute(
        "DELETE FROM search_history WHERE date(searched_at) <= date(?1)",
        params![date],
    )?;
    Ok(n)
}

/// Delete a single entry by id.
pub fn delete_history_entry(path: &str, id: i64) -> Result<()> {
    let conn = Connection::open(path)?;
    conn.execute("DELETE FROM search_history WHERE id = ?1", params![id])?;
    Ok(())
}

/// Clear the entire history table.
pub fn clear_all_history(path: &str) -> Result<()> {
    let conn = Connection::open(path)?;
    conn.execute_batch("DELETE FROM search_history;")?;
    Ok(())
}
