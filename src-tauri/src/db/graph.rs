//! The graph view (components/GraphModal.tsx): videos, glossary terms and people as nodes, and what connects them as
//! edges. A link edge is an in-app link (`[text](kinesis://...)`) from one thing's text to another: a video's summary,
//! transcript or note, a person's bio, a term's definition (the same texts Backlinks reads, db/links.rs). A creator edge
//! is a video to the person whose channel it's from. Drive and playlist links aren't drawn: a Drive is a folder, not a
//! thing that links back.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, Result};
use serde::Serialize;

use super::links::{find_links, LinkKind, SCHEME};
use super::schema::table_exists;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// "video", "glossary" or "bio".
    pub kind: &'static str,
    /// What opening it is given (a video id, a term, a handle), as an in-app link would be.
    pub key: String,
    pub label: String,
    /// Whether it exists here (a link can point at a term or person with no entry yet, or a video not in the library).
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub a: usize,
    pub b: usize,
    /// "link" or "creator".
    pub kind: &'static str,
}

#[derive(Debug, Default, Serialize)]
pub struct LinkGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

/// Builds the graph up node by node: a thing is one node however it's spelled (a handle with or without "@", a term in
/// any case).
#[derive(Default)]
struct Builder {
    graph: LinkGraph,
    index: HashMap<(&'static str, String), usize>,
    seen: HashSet<(usize, usize, &'static str)>,
}

fn kind_str(kind: LinkKind) -> Option<&'static str> {
    match kind {
        LinkKind::Video => Some("video"),
        LinkKind::Glossary => Some("glossary"),
        LinkKind::Bio => Some("bio"),
        LinkKind::Drive | LinkKind::Playlist => None,
    }
}

fn norm(kind: &str, key: &str) -> String {
    match kind {
        "bio" => key.trim().trim_start_matches('@').to_lowercase(),
        "glossary" => key.trim().to_lowercase(),
        _ => key.trim().to_string(),
    }
}

impl Builder {
    /// The node for a thing, made if needed. `label` and `exists` from the thing itself win over a link's guess.
    fn node(&mut self, kind: &'static str, key: &str, label: &str, exists: bool) -> usize {
        let id = (kind, norm(kind, key));
        if let Some(&i) = self.index.get(&id) {
            if exists && !self.graph.nodes[i].exists {
                self.graph.nodes[i].exists = true;
                self.graph.nodes[i].label = label.to_string();
                self.graph.nodes[i].key = key.to_string();
            }
            return i;
        }
        let i = self.graph.nodes.len();
        self.graph.nodes.push(GraphNode { kind, key: key.to_string(), label: label.to_string(), exists });
        self.index.insert(id, i);
        i
    }

    fn edge(&mut self, a: usize, b: usize, kind: &'static str) {
        if a == b {
            return;
        }
        let (x, y) = if a < b { (a, b) } else { (b, a) };
        if self.seen.insert((x, y, kind)) {
            self.graph.edges.push(GraphEdge { a: x, b: y, kind });
        }
    }

    /// Edges from `from` to everything `text` links to.
    fn links_in(&mut self, from: usize, text: &str) {
        for link in find_links(text) {
            let Some(kind) = kind_str(link.kind) else { continue };
            let label = match kind {
                "bio" => format!("@{}", link.key.trim_start_matches('@')),
                "glossary" => link.key.clone(),
                _ => if link.text.trim().is_empty() { link.key.clone() } else { link.text.clone() },
            };
            let to = self.node(kind, &link.key, &label, false);
            self.edge(from, to, "link");
        }
    }
}

/// Everything in the workspace as a graph: every video, term (with a definition) and person, and the links and creators
/// that connect them. Things with no connection are included (the view can hide them).
pub fn link_graph(db_path: &str) -> Result<LinkGraph> {
    let conn = Connection::open(db_path)?;
    conn.busy_timeout(std::time::Duration::from_secs(10))?;
    let mut b = Builder::default();

    // The things themselves first, so their own names label them.
    if table_exists(&conn, "Biographies")? {
        let mut stmt = conn.prepare("SELECT handle, COALESCE(NULLIF(TRIM(display_name), ''), handle) FROM Biographies")?;
        let rows: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.filter_map(|r| r.ok()).collect();
        for (handle, name) in rows {
            if !handle.trim().is_empty() {
                b.node("bio", &handle, &name, true);
            }
        }
    }
    if table_exists(&conn, "Glossary")? {
        let mut stmt = conn.prepare("SELECT DISTINCT term FROM Glossary WHERE TRIM(definition) != ''")?;
        let rows: Vec<String> = stmt.query_map([], |r| r.get(0))?.filter_map(|r| r.ok()).collect();
        for term in rows {
            b.node("glossary", &term, &term, true);
        }
    }
    let mut videos: Vec<(String, Option<String>, Option<String>, Option<String>)> = Vec::new();
    if table_exists(&conn, "Videos")? {
        let mut stmt = conn.prepare(&format!(
            "SELECT video_id, COALESCE(NULLIF(title, ''), video_id), handle,
                    CASE WHEN INSTR(summary, '{SCHEME}') > 0 THEN summary END,
                    CASE WHEN INSTR(transcript, '{SCHEME}') > 0 THEN transcript END
             FROM Videos"
        ))?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?))
        })?;
        for (id, title, handle, summary, transcript) in rows.filter_map(|r| r.ok()) {
            b.node("video", &id, &title, true);
            videos.push((id, handle, summary, transcript));
        }
    }

    // A video and its creator (only when that person has an entry: a bare handle would just be another dot per channel).
    for (id, handle, summary, transcript) in &videos {
        let v = b.index[&("video", id.clone())];
        if let Some(h) = handle.as_deref().filter(|h| !h.trim().is_empty()) {
            if let Some(&p) = b.index.get(&("bio", norm("bio", h))) {
                b.edge(v, p, "creator");
            }
        }
        if let Some(text) = summary {
            // Not the "Channel Info: [Creator](kinesis://bio/...)" footer every summary has: that's the creator edge.
            let body = text.find(super::summaries::CHANNEL_INFO).map_or(text.as_str(), |at| &text[..at]);
            b.links_in(v, body);
        }
        if let Some(text) = transcript {
            b.links_in(v, text);
        }
    }
    if table_exists(&conn, "VideoNotes")? {
        let mut stmt = conn.prepare(&format!("SELECT video_id, note FROM VideoNotes WHERE INSTR(note, '{SCHEME}') > 0"))?;
        let rows: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.filter_map(|r| r.ok()).collect();
        for (id, note) in rows {
            if let Some(&v) = b.index.get(&("video", id)) {
                b.links_in(v, &note);
            }
        }
    }
    if table_exists(&conn, "Biographies")? {
        let mut stmt = conn.prepare(&format!("SELECT handle, bio FROM Biographies WHERE INSTR(bio, '{SCHEME}') > 0"))?;
        let rows: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.filter_map(|r| r.ok()).collect();
        for (handle, bio) in rows {
            if let Some(&p) = b.index.get(&("bio", norm("bio", &handle))) {
                b.links_in(p, &bio);
            }
        }
    }
    if table_exists(&conn, "Glossary")? {
        let mut stmt = conn.prepare(&format!("SELECT term, definition FROM Glossary WHERE INSTR(definition, '{SCHEME}') > 0"))?;
        let rows: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.filter_map(|r| r.ok()).collect();
        for (term, definition) in rows {
            if let Some(&t) = b.index.get(&("glossary", norm("glossary", &term))) {
                b.links_in(t, &definition);
            }
        }
    }
    Ok(b.graph)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{init_db, save_glossary_term, save_video};

    #[test]
    fn links_and_creators_become_edges_one_node_per_thing() {
        let path = std::env::temp_dir().join(format!("kinesis_graph_{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let p = path.to_string_lossy().to_string();
        init_db(&p).unwrap();
        save_video(&p, "v1", "First", "Ann", 60, "See [mTOR](kinesis://glossary/mTOR).", 1, "2026-01-01T00:00:00Z", "@ann", None).unwrap();
        save_glossary_term(&p, None, "MTOR", "Named by [Ann](kinesis://bio/ANN) in [this](kinesis://video/v1).", "").unwrap();
        let conn = Connection::open(&p).unwrap();
        conn.execute("INSERT OR REPLACE INTO Biographies (handle, display_name, bio) VALUES ('@ann', 'Ann', 'Mentions [Nobody](kinesis://bio/nobody).')", []).unwrap();

        let g = link_graph(&p).unwrap();
        let find = |kind: &str, label: &str| g.nodes.iter().position(|n| n.kind == kind && n.label == label).unwrap_or_else(|| panic!("{kind} {label}: {:?}", g.nodes));
        let (v, t, ann, nobody) = (find("video", "First"), find("glossary", "MTOR"), find("bio", "Ann"), find("bio", "@nobody"));
        // "mTOR" and "MTOR" are one term, "ANN" and "@ann" one person.
        assert_eq!(g.nodes.iter().filter(|n| n.kind == "glossary").count(), 1);
        assert!(!g.nodes[nobody].exists && g.nodes[ann].exists);
        let has = |x: usize, y: usize, kind: &str| g.edges.iter().any(|e| ((e.a == x && e.b == y) || (e.a == y && e.b == x)) && e.kind == kind);
        assert!(has(v, t, "link"), "video to term, and the term back to the video: one edge");
        assert!(has(t, ann, "link") && has(ann, nobody, "link"));
        assert!(has(v, ann, "creator"));
        assert_eq!(g.edges.iter().filter(|e| e.kind == "link" && ((e.a == v && e.b == t) || (e.a == t && e.b == v))).count(), 1);
        let _ = std::fs::remove_file(&path);
    }
}
