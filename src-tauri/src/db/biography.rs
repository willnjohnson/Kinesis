use rusqlite::{params, Connection, Result};

/// Fixed field order returned by get_biographies/get_biography_by_handle: (handle, display_name,
/// bio, wikipedia, website, twitter, instagram, facebook, threads, youtube, tiktok, twitch,
/// reddit, discord, alias).
pub type BiographyRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);

/// Ensures a biography row exists for `handle`, seeding it with `display_name`. If a row already
/// exists, `display_name` is only applied when the existing one is empty — this never overwrites
/// a display name a user has already set (e.g. via manual edit), only fills in a blank one.
///
/// `channel_id`/`subscriber_count` are only ever written on the INSERT branch (first time this
/// handle is seen) — the ON CONFLICT branch intentionally omits them from its SET list, so they
/// are never touched again on a later save. channel_id is YouTube's immutable channel ID, which
/// must be captured at the outset since (unlike handle) it can't be recovered later once missed;
/// subscriber_count is meant to be kept in sync by a separate backend routine going forward, not
/// by Kinesis's own video-save flow. See commands::youtube::library::ensure_biography_seeded for
/// the caller that resolves these before calling in.
pub fn upsert_biography_from_video(
    db_path: &str,
    handle: &str,
    display_name: &str,
    channel_id: Option<&str>,
    subscriber_count: i64,
) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let cleaned_handle = handle.trim();
    if cleaned_handle.is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO Biographies (handle, display_name, channel_id, subscriber_count)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(handle) DO UPDATE SET
           display_name = CASE
             WHEN Biographies.display_name IS NULL OR TRIM(Biographies.display_name) = ''
             THEN excluded.display_name
             ELSE Biographies.display_name
           END",
        params![cleaned_handle, display_name.trim(), channel_id.unwrap_or("").trim(), subscriber_count],
    )?;
    Ok(())
}

/// Returns all biography rows, sorted by display_name (falling back to handle when display_name
/// is blank), case-insensitively.
pub fn get_biographies(db_path: &str) -> Result<Vec<BiographyRow>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT handle, display_name, bio, wikipedia, website, twitter, instagram, facebook, threads, youtube, tiktok, twitch, reddit, discord, alias
         FROM Biographies
         ORDER BY
           CASE WHEN TRIM(display_name) = '' THEN handle ELSE display_name END COLLATE NOCASE",
    )?;
    let mut rows = stmt.query([])?;
    let mut entries = Vec::new();
    while let Some(row) = rows.next()? {
        entries.push((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
            row.get(10)?,
            row.get(11)?,
            row.get(12)?,
            row.get(13)?,
            row.get(14)?,
        ));
    }
    Ok(entries)
}

/// Looks up one biography row by handle, case-insensitively.
pub fn get_biography_by_handle(db_path: &str, handle: &str) -> Result<Option<BiographyRow>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT handle, display_name, bio, wikipedia, website, twitter, instagram, facebook, threads, youtube, tiktok, twitch, reddit, discord, alias
         FROM Biographies
         WHERE LOWER(LTRIM(handle, '@')) = LOWER(?)",
    )?;
    // The leading "@" is optional on either side: "@Name", "Name" and "name" all find the same
    // biography (links to a biography, see db/links.rs, carry the handle without it).
    let mut rows = stmt.query(params![handle.trim().trim_start_matches('@')])?;
    if let Some(row) = rows.next()? {
        Ok(Some((
            row.get(0)?,
            row.get(1)?,
            row.get(2)?,
            row.get(3)?,
            row.get(4)?,
            row.get(5)?,
            row.get(6)?,
            row.get(7)?,
            row.get(8)?,
            row.get(9)?,
            row.get(10)?,
            row.get(11)?,
            row.get(12)?,
            row.get(13)?,
            row.get(14)?,
        )))
    } else {
        Ok(None)
    }
}

/// Updates the editable fields for a handle: its alias, bio and socials. Does not touch `handle` or
/// `display_name` — those are only ever set via upsert_biography_from_video.
#[allow(clippy::too_many_arguments)]
pub fn update_biography_details(
    db_path: &str,
    handle: &str,
    bio: &str,
    wikipedia: &str,
    website: &str,
    twitter: &str,
    instagram: &str,
    facebook: &str,
    threads: &str,
    youtube: &str,
    tiktok: &str,
    twitch: &str,
    reddit: &str,
    discord: &str,
    alias: &str,
) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "UPDATE Biographies
         SET alias = ?14,
             bio = ?2,
             wikipedia = ?3,
             website = ?4,
             twitter = ?5,
             instagram = ?6,
             facebook = ?7,
             threads = ?8,
             youtube = ?9,
             tiktok = ?10,
             twitch = ?11,
             reddit = ?12,
             discord = ?13
         WHERE LOWER(handle) = LOWER(?1)",
        params![
            handle.trim(),
            bio,
            wikipedia,
            website,
            twitter,
            instagram,
            facebook,
            threads,
            youtube,
            tiktok,
            twitch,
            reddit,
            discord,
            alias.trim()
        ],
    )?;
    Ok(())
}

/// A biography's YouTube channel ID ("" when it was never captured), by handle.
pub fn get_biography_channel_id(db_path: &str, handle: &str) -> Result<Option<(String, String, String)>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT handle, channel_id, display_name FROM Biographies WHERE LOWER(LTRIM(handle, '@')) = LOWER(?1)",
    )?;
    let mut rows = stmt.query(params![handle.trim().trim_start_matches('@')])?;
    match rows.next()? {
        Some(row) => Ok(Some((row.get(0)?, row.get(1)?, row.get(2)?))),
        None => Ok(None),
    }
}

/// A biography's subscriber count catching up with the channel's page (found as the biography is opened): stored when
/// it differs, and returned then (None when it's the same, or there's no such biography). The "separate routine" the
/// note on upsert_biography_from_video speaks of: that one writes the count once, as the biography is made.
pub fn update_biography_subscribers(db_path: &str, handle: &str, subscribers: i64) -> Result<Option<i64>> {
    if subscribers < 0 {
        return Ok(None);
    }
    let conn = Connection::open(db_path)?;
    let changed = conn.execute(
        "UPDATE Biographies SET subscriber_count = ?1 WHERE LOWER(handle) = LOWER(?2) AND IFNULL(subscriber_count, -1) != ?1",
        params![subscribers, handle.trim()],
    )?;
    Ok((changed > 0).then_some(subscribers))
}

/// Records a biography's channel ID, only where none was captured yet (it never changes once known).
pub fn set_biography_channel_id(db_path: &str, handle: &str, channel_id: &str) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "UPDATE Biographies SET channel_id = ?1 WHERE LOWER(handle) = LOWER(?2) AND TRIM(channel_id) = ''",
        params![channel_id.trim(), handle.trim()],
    )?;
    Ok(())
}

/// The handle `typed` in Edit Bio, checked against the stored `handle`: only its capitals may differ (@john to @John).
/// The "@" follows the stored handle whether or not it was typed. A different handle, or no change at all, is refused.
pub fn handle_case_change(handle: &str, typed: &str) -> std::result::Result<String, String> {
    let stored = handle.trim();
    let bare = typed.trim().trim_start_matches('@');
    if bare.is_empty() {
        return Err("Type the channel's handle.".into());
    }
    if !bare.eq_ignore_ascii_case(stored.trim_start_matches('@')) && bare.to_lowercase() != stored.trim_start_matches('@').to_lowercase() {
        return Err(format!("Only the capitals can change: It has to stay {stored}."));
    }
    let new = if stored.starts_with('@') { format!("@{bare}") } else { bare.to_string() };
    if new == stored {
        return Err("That's the handle it has already.".into());
    }
    Ok(new)
}

/// The channel changed its handle on YouTube: everything that knows it by the old one follows (its biography, its
/// videos, its custom prompt, links to it in any text, and its videos' Channel Info footers). Returns false, changing
/// nothing, when another biography already has the new handle (two rows can't be merged here).
pub fn rename_biography_handle(db_path: &str, old: &str, new: &str) -> Result<bool> {
    let (old, new) = (old.trim(), new.trim());
    let bare = |h: &str| h.trim_start_matches('@').to_string();
    {
        let mut conn = Connection::open(db_path)?;
        conn.busy_timeout(std::time::Duration::from_secs(10))?;
        let tx = conn.transaction()?;
        let taken: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM Biographies WHERE LOWER(handle) = LOWER(?1) AND LOWER(handle) != LOWER(?2))",
            params![new, old],
            |r| r.get(0),
        )?;
        if taken {
            return Ok(false);
        }
        tx.execute("UPDATE Biographies SET handle = ?1 WHERE LOWER(handle) = LOWER(?2)", params![new, old])?;
        // A maintained database's foreign key already carried this over (ON UPDATE CASCADE); the app's own has none.
        tx.execute("UPDATE Videos SET handle = ?1 WHERE LOWER(handle) = LOWER(?2)", params![new, old])?;
        tx.execute(
            "UPDATE CustomPrompts SET handle = ?1 WHERE LOWER(handle) = LOWER(?2)
               AND NOT EXISTS (SELECT 1 FROM CustomPrompts WHERE LOWER(handle) = LOWER(?1))",
            params![new, old],
        )?;
        tx.commit()?;
    }
    super::links::apply_link_edits(db_path, &[super::links::LinkEdit::Retarget(super::links::LinkKind::Bio, bare(old), bare(new))])?;
    super::summaries::relink_channel_info_footers_of(db_path, new)?;
    Ok(true)
}

/// The channel changed its name on YouTube: the biography takes the new one. With `keep_old_as_alias`, the old name
/// becomes its alias (replacing any it had), so it's still recognizable by the name the reader knew. Its videos'
/// Channel Info footers then say the new name.
pub fn rename_biography_display_name(db_path: &str, handle: &str, new_name: &str, keep_old_as_alias: bool) -> Result<()> {
    let conn = Connection::open(db_path)?;
    let sql = if keep_old_as_alias {
        "UPDATE Biographies SET alias = display_name, display_name = ?1 WHERE LOWER(handle) = LOWER(?2) AND TRIM(display_name) != ''"
    } else {
        "UPDATE Biographies SET display_name = ?1 WHERE LOWER(handle) = LOWER(?2)"
    };
    let changed = conn.execute(sql, params![new_name.trim(), handle.trim()])?;
    if changed == 0 && keep_old_as_alias {
        // No old name to keep: just the new one.
        conn.execute("UPDATE Biographies SET display_name = ?1 WHERE LOWER(handle) = LOWER(?2)", params![new_name.trim(), handle.trim()])?;
    }
    drop(conn);
    super::summaries::relink_channel_info_footers_of(db_path, handle)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db(name: &str) -> String {
        let path = std::env::temp_dir()
            .join(format!("kinesis_bio_rename_{name}_{}_{}.db", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
            .to_string_lossy()
            .to_string();
        crate::db::init_db(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute("INSERT INTO Biographies (handle, display_name, channel_id) VALUES ('@Old', 'Old Name', 'UCabcdefghijklmnopqrstuv')", []).unwrap();
        conn.execute("INSERT INTO Biographies (handle, display_name, bio) VALUES ('@Friend', 'Friend', 'Knows [Old Name](kinesis://bio/Old).')", []).unwrap();
        conn.execute(
            "INSERT INTO Videos (video_id, title, author, handle, summary) VALUES ('v1', 'T', 'Old Name', '@Old', 'Body.\n\nChannel Info: [Old Name](kinesis://bio/Old)')",
            [],
        )
        .unwrap();
        path
    }

    fn text(path: &str, sql: &str) -> String {
        Connection::open(path).unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_new_handle_carries_over_to_videos_links_and_footers() {
        let path = db("handle");
        assert!(rename_biography_handle(&path, "@Old", "@New").unwrap());
        assert_eq!(text(&path, "SELECT handle FROM Biographies WHERE channel_id = 'UCabcdefghijklmnopqrstuv'"), "@New");
        assert_eq!(text(&path, "SELECT handle FROM Videos WHERE video_id = 'v1'"), "@New");
        assert_eq!(text(&path, "SELECT bio FROM Biographies WHERE handle = '@Friend'"), "Knows [Old Name](kinesis://bio/New).");
        assert_eq!(text(&path, "SELECT summary FROM Videos WHERE video_id = 'v1'"), "Body.\n\nChannel Info: [Old Name](kinesis://bio/New)");
        // Taken by another biography: left alone.
        assert!(!rename_biography_handle(&path, "@New", "@Friend").unwrap());
        assert_eq!(text(&path, "SELECT handle FROM Videos WHERE video_id = 'v1'"), "@New");
    }

    #[test]
    fn only_the_capitals_of_a_handle_can_be_changed_by_hand() {
        assert_eq!(handle_case_change("@john", "@John"), Ok("@John".to_string()));
        assert_eq!(handle_case_change("@john", "JOHN"), Ok("@JOHN".to_string()), "the @ follows the stored handle");
        assert!(handle_case_change("@john", "@jean").is_err());
        assert!(handle_case_change("@john", "@john").is_err(), "no change");
        assert!(handle_case_change("@john", "  ").is_err());

        // Carried through like a rename from YouTube: videos, links and footers take the new capitals.
        let path = db("case");
        assert!(rename_biography_handle(&path, "@Old", "@OLD").unwrap());
        assert_eq!(text(&path, "SELECT handle FROM Videos WHERE video_id = 'v1'"), "@OLD");
        assert_eq!(text(&path, "SELECT bio FROM Biographies WHERE handle = '@Friend'"), "Knows [Old Name](kinesis://bio/OLD).");
    }

    #[test]
    fn a_new_name_can_keep_the_old_one_as_its_alias() {
        let path = db("name");
        rename_biography_display_name(&path, "@Old", "New Name", true).unwrap();
        assert_eq!(text(&path, "SELECT display_name || '|' || alias FROM Biographies WHERE handle = '@Old'"), "New Name|Old Name");
        assert_eq!(text(&path, "SELECT summary FROM Videos WHERE video_id = 'v1'"), "Body.\n\nChannel Info: [New Name](kinesis://bio/Old)");
        rename_biography_display_name(&path, "@Old", "Newer", false).unwrap();
        assert_eq!(text(&path, "SELECT display_name || '|' || alias FROM Biographies WHERE handle = '@Old'"), "Newer|Old Name");
    }
}
