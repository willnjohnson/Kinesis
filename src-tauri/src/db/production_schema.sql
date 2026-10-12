/*
The production schema, as the maintainer's regeneration script leaves it in an empty database: generated from
kinesis_regeneration_script.sql (0.5.3), with these differences, which are what the script needs next and are in
the proposed 0.5.4 copy of it:
  - Notes and PersonalNotes, their indexes and their four CalendarEntries triggers;
  - Workbooks, PersonalWorkbooks, WorkbookNotes, Logs and LogEntries, and their indexes;
  - CalendarEntries.note_id / former_note_id and CalendarTracks.repeat_kind / repeat_every / repeat_ordinal;
  - no hand-written FTS5 sync in trgWDBS_BeforeUPD_Videos_MergeValidate or trgVideosBeforeINS_Videos_SyncBioHandle
    (Videos' own triggers fire from inside them and keep the index; the extra sync indexed each row twice).

db/production_tests.rs runs Kinesis on this: init_db has to leave it exactly as it is, and every operation has to
work on it. When the script changes, this file is made again from it (not edited by hand), so the two can't drift.

Names: tables in mixed case (tblWDBS keeps its prefix, since it has a column named WDBS); columns in lower case
except WDBS, which is upper case everywhere; every table STRICT.
*/

CREATE TABLE Settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT
) STRICT;

CREATE TABLE Glossary (
    term       TEXT NOT NULL COLLATE NOCASE,
    definition TEXT NOT NULL,
    drives     TEXT NOT NULL DEFAULT (''),
    CONSTRAINT GLOSSARY_PK PRIMARY KEY (term, drives)
) STRICT;

CREATE TABLE StopWords (
    culls TEXT NOT NULL,
    CONSTRAINT pkStopWords PRIMARY KEY (culls)
) STRICT;

CREATE TABLE CustomPrompts (
    handle             TEXT NOT NULL PRIMARY KEY,
    local_prompt_text  TEXT,
    cloud_prompt_text  TEXT
) STRICT;

CREATE TABLE SearchHistory (
    id            INTEGER PRIMARY KEY,
    search_query  TEXT NOT NULL,
    searched_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    UNIQUE(search_query)
) STRICT;

CREATE TABLE SyncItems (
    kind         TEXT NOT NULL,
    item_key     TEXT NOT NULL,
    rev          INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL DEFAULT (''),
    synced_at    TEXT DEFAULT (CURRENT_TIMESTAMP),
    seen         INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (kind, item_key)
) STRICT;

CREATE TABLE SyncPolicy (
    key    TEXT NOT NULL PRIMARY KEY,
    value  TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE WorkspaceLabels (
    key   TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;

CREATE TABLE AttachmentBlobs (
    hash        TEXT NOT NULL PRIMARY KEY,
    compression TEXT NOT NULL DEFAULT 'none',
    size        INTEGER NOT NULL,
    stored_size INTEGER NOT NULL,
    data        BLOB NOT NULL
) STRICT;

CREATE TABLE Biographies (
    handle           TEXT COLLATE NOCASE NOT NULL,
    channel_id       TEXT NOT NULL,
    subscriber_count INTEGER,
    display_name     TEXT DEFAULT ('') NOT NULL,
    alias            TEXT DEFAULT ('') NOT NULL,
    bio              TEXT DEFAULT ('') NOT NULL,
    wikipedia        TEXT DEFAULT ('') NOT NULL,
    website          TEXT DEFAULT ('') NOT NULL,
    twitter          TEXT DEFAULT ('') NOT NULL,
    instagram        TEXT DEFAULT ('') NOT NULL,
    facebook         TEXT DEFAULT ('') NOT NULL,
    threads          TEXT DEFAULT ('') NOT NULL,
    youtube          TEXT DEFAULT ('') NOT NULL,
    tiktok           TEXT DEFAULT ('') NOT NULL,
    twitch           TEXT DEFAULT ('') NOT NULL,
    reddit           TEXT DEFAULT ('') NOT NULL,
    discord          TEXT DEFAULT ('') NOT NULL,
    CONSTRAINT BIOGRAPHIES_PK PRIMARY KEY (handle)
) STRICT;

CREATE TABLE tblWDBS (
    WDBS      TEXT NOT NULL,
    lev       INTEGER NOT NULL,
    WDID      TEXT NOT NULL,
    WDInfo    TEXT NOT NULL,
    WDDefault INTEGER DEFAULT (0) NOT NULL,
    WDIcon    TEXT NOT NULL DEFAULT (''),
    WDColor   TEXT NOT NULL DEFAULT (''),
    WDShape   TEXT NOT NULL DEFAULT (''),
    CONSTRAINT tblWDBS_PK PRIMARY KEY (WDBS),
    CONSTRAINT tblWDBS_upper CHECK (WDBS = UPPER(WDBS))
) STRICT;

CREATE TABLE Videos (
    video_id       TEXT NOT NULL,
    title          TEXT,
    author         TEXT,
    handle         TEXT NOT NULL COLLATE NOCASE CHECK(handle <> ''),
    length_seconds INTEGER CHECK(length_seconds >= 0),
    transcript     TEXT,
    summary        TEXT,
    WDBS           TEXT NOT NULL DEFAULT('θψ'),
    fkWDBS         TEXT GENERATED ALWAYS AS (REPLACE(REPLACE(WDBS, 'θψ', ':'), '_', '-')) STORED,
    view_count     INTEGER DEFAULT (0),
    published_at   TEXT,
    date_added     TEXT DEFAULT (CURRENT_TIMESTAMP),
    tags           TEXT DEFAULT (''),
    tokens         TEXT DEFAULT (''),
    CONSTRAINT VIDEOS_PK PRIMARY KEY (video_id),
    FOREIGN KEY (handle) REFERENCES Biographies(handle) ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY (fkWDBS) REFERENCES tblWDBS(WDBS) ON DELETE RESTRICT
) STRICT;

CREATE TABLE VideoWDBSLinks (
    video_id TEXT NOT NULL,
    WDBS     TEXT NOT NULL,
    PRIMARY KEY (video_id, WDBS)
) STRICT;

CREATE TABLE VideoAttachments (
    id       INTEGER PRIMARY KEY,
    video_id TEXT NOT NULL,
    name     TEXT NOT NULL,
    ext      TEXT NOT NULL,
    hash     TEXT NOT NULL,
    added_at TEXT NOT NULL,
    position INTEGER
) STRICT;

CREATE TABLE VideoNotes (
    video_id   TEXT NOT NULL PRIMARY KEY,
    note       TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE DriveSequence (
    drive    TEXT NOT NULL,
    video_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (drive, video_id)
) STRICT;

CREATE TABLE VideoLinkedTerms (
    video_id TEXT NOT NULL,
    term     TEXT NOT NULL,
    PRIMARY KEY (video_id, term)
) STRICT;

CREATE TABLE CalendarTracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    drive TEXT NOT NULL DEFAULT (''),
    advance_mode TEXT NOT NULL DEFAULT ('completion') CHECK (advance_mode IN ('completion', 'calendar', 'hybrid')),
    loop_entries INTEGER NOT NULL DEFAULT 0,
    source_drive_sequence INTEGER NOT NULL DEFAULT 0,
    weekdays TEXT NOT NULL DEFAULT (''),
    start_date TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    time_start INTEGER,
    time_duration INTEGER,
    cycle_offset INTEGER NOT NULL DEFAULT 0,
    previous_start_date TEXT,
    previous_cycle_offset INTEGER,
    repeat_kind TEXT NOT NULL DEFAULT 'weekly',
    repeat_every INTEGER NOT NULL DEFAULT 1,
    repeat_ordinal INTEGER NOT NULL DEFAULT 1
) STRICT;

CREATE TABLE CalendarEntries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL,
    video_id TEXT,
    label TEXT NOT NULL DEFAULT (''),
    position INTEGER,
    target_date TEXT,
    icon TEXT NOT NULL DEFAULT (''),
    description TEXT NOT NULL DEFAULT (''),
    priority INTEGER NOT NULL DEFAULT 0,
    former_video_id TEXT,
    is_folder INTEGER NOT NULL DEFAULT 0,
    folder_id INTEGER,
    note_id TEXT,
    former_note_id TEXT,
    workbook_id TEXT,
    UNIQUE (track_id, video_id)
) STRICT;

CREATE TABLE CalendarCompletions (
    entry_id INTEGER NOT NULL,
    cycle INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT NOT NULL,
    PRIMARY KEY (entry_id, cycle)
) STRICT;

CREATE TABLE CalendarTerms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT (''),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    annual INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE CalendarHolidaySets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    annual INTEGER NOT NULL DEFAULT 0,
    builtin TEXT NOT NULL DEFAULT ('')
) STRICT;

CREATE TABLE CalendarHolidayDates (
    set_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT (''),
    PRIMARY KEY (set_id, date)
) STRICT;

CREATE TABLE CalendarTrackHolidayRules (
    track_id INTEGER NOT NULL,
    set_id INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('exclude', 'include')),
    PRIMARY KEY (track_id, set_id)
) STRICT;

CREATE TABLE CalendarProgress (
    entry_id INTEGER NOT NULL,
    cycle INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    PRIMARY KEY (entry_id, cycle)
) STRICT;

CREATE TABLE PinnedVideos (
    video_id TEXT NOT NULL PRIMARY KEY,
    pinned_at TEXT NOT NULL
) STRICT;

CREATE TABLE OrphanedVideos (
    video_id TEXT NOT NULL PRIMARY KEY,
    reason TEXT NOT NULL DEFAULT (''),
    found_at TEXT NOT NULL
) STRICT;

CREATE TABLE VideoPositions (
    video_id TEXT NOT NULL PRIMARY KEY,
    seconds REAL NOT NULL,
    duration REAL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE VideoWatched (
    video_id TEXT NOT NULL PRIMARY KEY,
    watched_at TEXT NOT NULL
) STRICT;

CREATE TABLE Notes (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            drives TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE PersonalNotes (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            drives TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE Workbooks (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            ) STRICT;

CREATE TABLE PersonalWorkbooks (
                id TEXT PRIMARY KEY NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            ) STRICT;

CREATE TABLE WorkbookNotes (
            workbook_id TEXT NOT NULL,
            note_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            PRIMARY KEY (workbook_id, note_id)
        ) STRICT;

CREATE TABLE Logs (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            remind INTEGER NOT NULL DEFAULT 0,
            entry_template TEXT NOT NULL DEFAULT ''
        ) STRICT;

CREATE TABLE LogEntries (
            id INTEGER PRIMARY KEY,
            log_id TEXT NOT NULL,
            date TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        ) STRICT;

CREATE INDEX idxVideoAttachmentsVideoID ON VideoAttachments(video_id);

CREATE INDEX idxVideoAttachmentsOrder   ON VideoAttachments(video_id, position);

CREATE INDEX idxDriveSequenceOrder ON DriveSequence(drive, position);

CREATE INDEX idxDriveSequenceVideo ON DriveSequence(video_id);

CREATE INDEX idxVideosViewCount   ON Videos(view_count);

CREATE INDEX idxVideosPublishedAt ON Videos(published_at);

CREATE INDEX idxVideosDateAdded   ON Videos(date_added);

CREATE INDEX idxVideosHandle      ON Videos(handle);

CREATE INDEX idxVideosTags        ON Videos(tags);

CREATE INDEX idxVideosWDBS        ON Videos(WDBS);

CREATE INDEX idxCalendarEntriesTrack ON CalendarEntries(track_id, position);

CREATE INDEX idxCalendarEntriesVideo ON CalendarEntries(video_id);

CREATE INDEX idxCalendarTermsTrack ON CalendarTerms(track_id);

CREATE UNIQUE INDEX idxCalendarHolidaySetsBuiltin ON CalendarHolidaySets(builtin) WHERE builtin != '';

CREATE INDEX idxNotesUpdated ON Notes(updated_at);

CREATE INDEX idxPersonalNotesUpdated ON PersonalNotes(updated_at);

CREATE INDEX idxWorkbookNotesOrder ON WorkbookNotes(workbook_id, position);

CREATE UNIQUE INDEX idxLogEntriesDay ON LogEntries(log_id, date);

CREATE VIRTUAL TABLE ftsVideos USING fts5(
    title,
    summary,
    tokens,
    WDBS,
    content='Videos'
);

CREATE TRIGGER trgWDBS_BeforeDEL_WDBS_CascadeSafeOrphans
BEFORE DELETE ON tblWDBS
FOR EACH ROW
BEGIN
    -- Universal guard: abort cleanly if the WDBS being deleted is
    -- directly referenced by any video, regardless of lev.
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM Videos WHERE fkWDBS = OLD.WDBS)
            THEN RAISE(ABORT, 'Cannot delete WDBS still referenced by videos')
    END;
    SELECT CASE
        WHEN OLD.lev = 0
            THEN RAISE(ABORT, 'Cannot delete root WDBS (Lev 0)')
    END;
    DELETE FROM tblWDBS
    WHERE lev = 4
      AND WDBS LIKE OLD.WDBS || '-%'
      AND NOT EXISTS (SELECT 1 FROM Videos WHERE fkWDBS = tblWDBS.WDBS);
    DELETE FROM tblWDBS
    WHERE lev = 3
      AND WDBS LIKE OLD.WDBS || '-%'
      AND NOT EXISTS (SELECT 1 FROM Videos WHERE fkWDBS = tblWDBS.WDBS)
      AND NOT EXISTS (
          SELECT 1 FROM tblWDBS child
          WHERE child.lev = 4
            AND child.WDBS LIKE tblWDBS.WDBS || '-%'
      );
    DELETE FROM tblWDBS
    WHERE lev = 2
      AND WDBS LIKE OLD.WDBS || '-%'
      AND NOT EXISTS (SELECT 1 FROM Videos WHERE fkWDBS = tblWDBS.WDBS)
      AND NOT EXISTS (
          SELECT 1 FROM tblWDBS child
          WHERE child.lev = 3
            AND child.WDBS LIKE tblWDBS.WDBS || '-%'
      );
    SELECT CASE
        WHEN OLD.lev IN (1, 2, 3) AND EXISTS (
            SELECT 1 FROM tblWDBS
            WHERE WDBS LIKE OLD.WDBS || '-%'
        )
            THEN RAISE(FAIL, 'WDBS not deleted: some subordinate entries are referenced by videos')
    END;
END;

CREATE TRIGGER trgWDBS_BeforeUPD_Videos_MergeValidate
BEFORE UPDATE OF WDBS ON tblWDBS
FOR EACH ROW
WHEN OLD.WDBS != NEW.WDBS
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM tblWDBS WHERE WDBS = NEW.WDBS)
        THEN RAISE(ABORT, 'Value must already exist in Warp Drive to permit WDBS change.')
    END;

    -- Perform the merge. Videos' own triggers move each row in the FTS5 index (they do fire from here).
    UPDATE Videos
    SET WDBS = REPLACE(REPLACE(NEW.WDBS, ':', 'θψ'), '-', '_')
    WHERE WDBS = REPLACE(REPLACE(OLD.WDBS, ':', 'θψ'), '-', '_');

    SELECT RAISE(IGNORE);
END;

CREATE TRIGGER trgWDBSAfterINS_WDBS_SyncWDInfo
AFTER INSERT ON tblWDBS
FOR EACH ROW
WHEN NEW.lev = 3
    AND EXISTS (
        SELECT 1 FROM tblWDBS
        WHERE WDID = NEW.WDID
          AND rowid != NEW.rowid
    )
BEGIN
    UPDATE tblWDBS
    SET WDInfo = (
        SELECT WDInfo FROM tblWDBS
        WHERE WDID = NEW.WDID
          AND rowid != NEW.rowid
        LIMIT 1
    )
    WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER trgWDBSAfterUPD_WDBS_SyncWDInfo
AFTER UPDATE OF WDID ON tblWDBS
FOR EACH ROW
WHEN NEW.lev = 3
    AND NEW.WDID != OLD.WDID
    AND EXISTS (
        SELECT 1 FROM tblWDBS
        WHERE WDID = NEW.WDID
          AND rowid != NEW.rowid
    )
BEGIN
    UPDATE tblWDBS
    SET WDInfo = (
        SELECT WDInfo FROM tblWDBS
        WHERE WDID = NEW.WDID
          AND rowid != NEW.rowid
        LIMIT 1
    )
    WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER trgBiographiesAfterUPD_Videos_SyncVideosHandle
AFTER UPDATE OF handle ON Biographies
WHEN NEW.handle IS NOT OLD.handle COLLATE BINARY
BEGIN
    UPDATE Videos
    SET handle = NEW.handle
    WHERE handle = OLD.handle;
END;

CREATE TRIGGER trgVideosBeforeINS_Videos_ValidateWDBS
BEFORE INSERT ON Videos
WHEN NEW.WDBS IS NOT NULL
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM tblWDBS WHERE WDBS = REPLACE(REPLACE(NEW.WDBS, 'θψ', ':'), '_', '-'))
        THEN RAISE(ABORT, 'Referential integrity violation: WDBS value not found in Warp Drive')
    END;
END;

CREATE TRIGGER trgVideosBeforeINS_Videos_SyncBioHandle
BEFORE INSERT ON Videos
WHEN NEW.handle IS NULL
  OR NEW.handle IS NOT (SELECT handle FROM Biographies WHERE handle = NEW.handle LIMIT 1) COLLATE BINARY
BEGIN
    SELECT CASE
        WHEN NEW.handle IS NULL OR NEW.handle = ''
            THEN RAISE(ABORT, 'Referential integrity violation: handle is required')
        WHEN NOT EXISTS (SELECT 1 FROM Biographies WHERE handle = NEW.handle)
            THEN RAISE(ABORT, 'Referential integrity violation: handle not found in Biographies')
    END;
    SELECT CASE
        WHEN NEW.WDBS IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM tblWDBS WHERE WDBS = REPLACE(REPLACE(NEW.WDBS, 'θψ', ':'), '_', '-'))
            THEN RAISE(ABORT, 'Referential integrity violation: WDBS value not found in Warp Drive')
    END;
    INSERT INTO Videos(handle, video_id, title, author, length_seconds, transcript, summary, WDBS, view_count, published_at, date_added, tags, tokens)
    SELECT
        (SELECT handle FROM Biographies WHERE handle = NEW.handle LIMIT 1),
        NEW.video_id,
        NEW.title,
        NEW.author,
        NEW.length_seconds,
        NEW.transcript,
        NEW.summary,
        NEW.WDBS,
        NEW.view_count,
        NEW.published_at,
        NEW.date_added,
        NEW.tags,
        NEW.tokens;
    SELECT RAISE(IGNORE);
END;

CREATE TRIGGER trgVideosBeforeUPD_Videos_ValidateWDBS
BEFORE UPDATE ON Videos
WHEN NEW.WDBS IS NOT NULL AND NEW.WDBS != OLD.WDBS
BEGIN
    SELECT CASE
        WHEN NOT EXISTS (SELECT 1 FROM tblWDBS WHERE WDBS = REPLACE(REPLACE(NEW.WDBS, 'θψ', ':'), '_', '-'))
        THEN RAISE(ABORT, 'Referential integrity violation: WDBS value not found in Warp Drive')
    END;
END;

CREATE TRIGGER trgVideosBeforeDEL_ftsVideos_DeleteTokens
BEFORE DELETE ON Videos
BEGIN
    INSERT INTO ftsVideos(ftsVideos, rowid, title, summary, tokens, WDBS)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.summary, OLD.tokens, OLD.WDBS);
END;

CREATE TRIGGER trgVideosAfterINS_ftsVideos_InsertTokens
AFTER INSERT ON Videos
BEGIN
    INSERT INTO ftsVideos(rowid, title, summary, tokens, WDBS)
    VALUES (NEW.rowid, NEW.title, NEW.summary, NEW.tokens, NEW.WDBS);
END;

CREATE TRIGGER trgVideosAfterUPD_ftsVideos_UpdateTokens
AFTER UPDATE ON Videos
WHEN OLD.title IS NOT NEW.title
  OR OLD.summary IS NOT NEW.summary
  OR OLD.tokens IS NOT NEW.tokens
  OR OLD.WDBS IS NOT NEW.WDBS
BEGIN
    INSERT INTO ftsVideos(ftsVideos, rowid, title, summary, tokens, WDBS)
    VALUES ('delete', OLD.rowid, OLD.title, OLD.summary, OLD.tokens, OLD.WDBS);
    INSERT INTO ftsVideos(rowid, title, summary, tokens, WDBS)
    VALUES (NEW.rowid, NEW.title, NEW.summary, NEW.tokens, NEW.WDBS);
END;

CREATE TRIGGER trgVideosAfterDEL_VideoWDBSLinks_CascadeDelete
AFTER DELETE ON Videos
BEGIN
    DELETE FROM VideoWDBSLinks WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgVideosAfterDEL_VideoNotes_CascadeDelete
AFTER DELETE ON Videos
BEGIN
    DELETE FROM VideoNotes WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgVideosAfterDEL_Attachments_CascadeDelete
AFTER DELETE ON Videos
BEGIN
    DELETE FROM AttachmentBlobs
    WHERE hash IN (SELECT hash FROM VideoAttachments WHERE video_id = OLD.video_id)
      AND hash NOT IN (SELECT hash FROM VideoAttachments WHERE video_id != OLD.video_id);
    DELETE FROM VideoAttachments WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgVideosAfterDEL_Biographies_PurgeOrphanBio
AFTER DELETE ON Videos
BEGIN
    DELETE FROM Biographies
    WHERE handle = OLD.handle
      AND NOT EXISTS (SELECT 1 FROM Videos WHERE handle = OLD.handle);
END;

CREATE TRIGGER trgVideosAfterDEL_DriveSequence_CascadeDelete
AFTER DELETE ON Videos
BEGIN
    DELETE FROM DriveSequence WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgVideosAfterDEL_VideoLinkedTerms_CascadeDelete
AFTER DELETE ON Videos
BEGIN
    DELETE FROM VideoLinkedTerms WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgCalendarTracksAfterDEL_CascadeDelete
AFTER DELETE ON CalendarTracks
BEGIN
    DELETE FROM CalendarCompletions WHERE entry_id IN (SELECT id FROM CalendarEntries WHERE track_id = OLD.id);
    DELETE FROM CalendarEntries WHERE track_id = OLD.id;
    DELETE FROM CalendarTerms WHERE track_id = OLD.id;
    DELETE FROM CalendarTrackHolidayRules WHERE track_id = OLD.id;
END;

CREATE TRIGGER trgCalendarEntriesAfterDEL_CascadeDelete
AFTER DELETE ON CalendarEntries
BEGIN
    DELETE FROM CalendarCompletions WHERE entry_id = OLD.id;
END;

CREATE TRIGGER trgCalendarHolidaySetsAfterDEL_CascadeDelete
AFTER DELETE ON CalendarHolidaySets
BEGIN
    DELETE FROM CalendarHolidayDates WHERE set_id = OLD.id;
    DELETE FROM CalendarTrackHolidayRules WHERE set_id = OLD.id;
END;

CREATE TRIGGER trgCalendarEntriesAfterDEL_Progress
AFTER DELETE ON CalendarEntries
BEGIN
    DELETE FROM CalendarProgress WHERE entry_id = OLD.id;
END;

CREATE TRIGGER trgCalendarTracksAfterDEL_Progress
AFTER DELETE ON CalendarTracks
BEGIN
    DELETE FROM CalendarProgress WHERE entry_id IN (SELECT id FROM CalendarEntries WHERE track_id = OLD.id);
END;

CREATE TRIGGER trgVideosAfterDEL_CalendarEntries_KeepPlace
AFTER DELETE ON Videos
BEGIN
    UPDATE CalendarEntries
    SET label = CASE WHEN label = '' THEN COALESCE(NULLIF(OLD.title, ''), OLD.video_id) ELSE label END,
        former_video_id = OLD.video_id,
        video_id = NULL
    WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgVideosAfterINS_CalendarEntries_Reconnect
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
END;

CREATE TRIGGER trgVideosAfterDEL_PinnedVideos
AFTER DELETE ON Videos
BEGIN
    DELETE FROM PinnedVideos WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgVideosAfterDEL_OrphanedVideos
AFTER DELETE ON Videos
BEGIN
    DELETE FROM OrphanedVideos WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgVideosAfterDEL_VideoPositions
AFTER DELETE ON Videos
BEGIN
    DELETE FROM VideoPositions WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgVideosAfterDEL_VideoWatched
AFTER DELETE ON Videos
BEGIN
    DELETE FROM VideoWatched WHERE video_id = OLD.video_id;
END;

CREATE TRIGGER trgNotesAfterDEL_CalendarEntries_KeepPlace
            AFTER DELETE ON Notes
            BEGIN
                UPDATE CalendarEntries
                SET label = CASE WHEN label = '' THEN COALESCE(NULLIF(OLD.title, ''), 'Untitled') ELSE label END,
                    former_note_id = OLD.id,
                    note_id = NULL
                WHERE note_id = OLD.id;
END;

CREATE TRIGGER trgNotesAfterINS_CalendarEntries_Reconnect
            AFTER INSERT ON Notes
            BEGIN
                UPDATE CalendarEntries
                SET note_id = NEW.id,
                    former_note_id = NULL,
                    label = CASE WHEN label = COALESCE(NULLIF(NEW.title, ''), 'Untitled') THEN '' ELSE label END
                WHERE id IN (
                    SELECT MIN(id) FROM CalendarEntries
                    WHERE former_note_id = NEW.id
                      AND track_id NOT IN (SELECT track_id FROM CalendarEntries WHERE note_id = NEW.id)
                    GROUP BY track_id
                );
END;

CREATE TRIGGER trgPersonalNotesAfterDEL_CalendarEntries_KeepPlace
            AFTER DELETE ON PersonalNotes
            BEGIN
                UPDATE CalendarEntries
                SET label = CASE WHEN label = '' THEN COALESCE(NULLIF(OLD.title, ''), 'Untitled') ELSE label END,
                    former_note_id = OLD.id,
                    note_id = NULL
                WHERE note_id = OLD.id;
END;

CREATE TRIGGER trgPersonalNotesAfterINS_CalendarEntries_Reconnect
            AFTER INSERT ON PersonalNotes
            BEGIN
                UPDATE CalendarEntries
                SET note_id = NEW.id,
                    former_note_id = NULL,
                    label = CASE WHEN label = COALESCE(NULLIF(NEW.title, ''), 'Untitled') THEN '' ELSE label END
                WHERE id IN (
                    SELECT MIN(id) FROM CalendarEntries
                    WHERE former_note_id = NEW.id
                      AND track_id NOT IN (SELECT track_id FROM CalendarEntries WHERE note_id = NEW.id)
                    GROUP BY track_id
                );
END;

