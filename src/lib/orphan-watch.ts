import { checkVideoIdentity, listOrphanedVideos, ORPHANS_CHANGED_EVENT } from '../api';

/**
 * Orphaned videos found from the Library's thumbnails, so nobody has to open each one. A saved video's thumbnail is a
 * hint: YouTube answers a removed video's with a 404 and a 120x90 gray placeholder (a live one is 480x360). A broken
 * thumbnail, or a good one on a video that's marked orphaned (its thumbnail came back), queues the video for the same
 * check the sidebar does (src-tauri/src/commands/orphans.rs), which decides: gone is marked orphaned, there again is
 * taken off. The thumbnail alone never decides, so a passing hiccup can't orphan a video.
 *
 * One at a time, a moment apart, each video at most once a session, so a page of broken thumbnails doesn't flood YouTube.
 * Offline, every thumbnail fails, so nothing is asked then: those videos wait, and are asked once the computer is back
 * online. A check only counts once YouTube answered; one that couldn't reach it waits the same way.
 */

const GAP_MS = 400;
/** Asked this session, with an answer (or on its way to one). */
const asked = new Set<string>();
const queue: string[] = [];
let running = false;
/** Seen while offline, or asked without reaching YouTube: asked once the computer is back online. */
const waiting = new Set<string>();
/** The videos marked orphaned, to know which good thumbnails are worth a look. */
let orphaned: Set<string> | null = null;
/** Good thumbnails seen before that list arrived, looked at once it has. */
const seenGood: string[] = [];

const online = () => typeof navigator === 'undefined' || navigator.onLine;

function loadOrphaned() {
    listOrphanedVideos()
        .then(list => { orphaned = new Set(list.map(v => v.videoId)); })
        .catch(() => { orphaned ??= new Set(); })
        .finally(() => { seenGood.splice(0).forEach(id => { if (orphaned?.has(id)) enqueue(id); }); });
}
if (typeof window !== 'undefined') {
    window.addEventListener(ORPHANS_CHANGED_EVENT, loadOrphaned);
    // Back online: what waited is asked now.
    window.addEventListener('online', () => {
        const ids = [...waiting];
        waiting.clear();
        ids.forEach(enqueue);
    });
    loadOrphaned();
}

async function drain() {
    if (running) return;
    running = true;
    while (queue.length) {
        const id = queue.shift()!;
        if (!online()) {
            // Went offline with this still queued: it waits too.
            asked.delete(id);
            waiting.add(id);
            continue;
        }
        try {
            await checkVideoIdentity(id);
        } catch {
            // YouTube couldn't be reached: not an answer, so it doesn't count. Asked again after the next reconnect.
            asked.delete(id);
            waiting.add(id);
        }
        await new Promise(r => setTimeout(r, GAP_MS));
    }
    running = false;
}

function enqueue(videoId: string) {
    if (asked.has(videoId)) return;
    if (!online()) {
        waiting.add(videoId);
        return;
    }
    asked.add(videoId);
    queue.push(videoId);
    void drain();
}

/** A saved video's thumbnail finished loading (`ok`: a real picture) or failed / came back as the placeholder. */
export function reportThumbnail(videoId: string, ok: boolean) {
    if (!ok) enqueue(videoId);
    else if (!orphaned) seenGood.push(videoId);
    else if (orphaned.has(videoId)) enqueue(videoId);
}
