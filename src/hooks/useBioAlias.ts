import { useEffect, useState } from 'react';
import { BIOGRAPHY_CHANGED_EVENT, getBiographies, getSetting, setSetting } from '../api';

/**
 * Channels' aliases (the optional name a reader gives a channel in Edit Bio, shown as a badge before its display name),
 * and whether they show. The aliases are loaded once and kept in step with edits (`BIOGRAPHY_CHANGED_EVENT`), so a
 * summary's "Channel Info:" badge (MarkdownLink.tsx) needs no lookup of its own.
 */

const SHOW_KEY = 'showBioAlias';
const SHOW_EVENT = 'kinesis-show-bio-alias';
const ALIAS_ONLY_KEY = 'bioAliasOnly';

/** handle (lowercased, no "@") → alias, for the channels that have one. */
let aliases: Map<string, string> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const keyOf = (handle: string) => handle.trim().replace(/^@/, '').toLowerCase();

function load(): Promise<void> {
    loading ??= getBiographies()
        .then(rows => { aliases = new Map(rows.filter(r => r.alias.trim()).map(r => [keyOf(r.handle), r.alias.trim()])); })
        .catch(() => { aliases ??= new Map(); })
        .finally(() => { loading = null; listeners.forEach(l => l()); });
    return loading;
}

if (typeof window !== 'undefined') {
    window.addEventListener(BIOGRAPHY_CHANGED_EVENT, () => { void load(); });
}

/** A channel's alias, or '' when it has none (or aliases are still loading). */
export function useBioAlias(handle: string): string {
    const [, rerender] = useState(0);
    useEffect(() => {
        const l = () => rerender(n => n + 1);
        listeners.add(l);
        if (!aliases) void load();
        return () => { listeners.delete(l); };
    }, []);
    return handle ? aliases?.get(keyOf(handle)) ?? '' : '';
}

/** The last value of each switch seen this run, so a part of the page that mounts later starts on it without a flicker. */
const known: Record<string, boolean> = {};

/** A switch the reader sets for themselves, kept in the workspace's Settings table (so it's still set after a restart,
 *  and each workspace keeps its own), and in step across every part of the page that shows it. Not a shared setting:
 *  its key isn't on the list a Kinpak or a sync server carries. */
function useSwitch(key: string, fallback: boolean): [boolean, (on: boolean) => void] {
    const [on, setOn] = useState(() => known[key] ?? fallback);
    useEffect(() => {
        let live = true;
        getSetting(key)
            .then(v => {
                const value = v === null ? fallback : v === 'true';
                known[key] = value;
                if (live) setOn(value);
            })
            .catch(() => { /* keeps what it has */ });
        const sync = () => { if (key in known) setOn(known[key]); };
        window.addEventListener(SHOW_EVENT, sync);
        return () => { live = false; window.removeEventListener(SHOW_EVENT, sync); };
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
    const set = (value: boolean) => {
        known[key] = value;
        setOn(value);
        window.dispatchEvent(new Event(SHOW_EVENT));
        setSetting(key, String(value)).catch(() => { /* this run keeps it, as above */ });
    };
    return [on, set];
}

/** Show Alias (the Biography status bar's switch; on by default): aliases show, and lead the list's order. */
export function useShowAlias(): [boolean, (on: boolean) => void] {
    return useSwitch(SHOW_KEY, true);
}

/** Alias Only (beside Show Alias; off by default): a channel with an alias shows just its alias, not its own name too.
 *  Only while Show Alias is on. */
export function useAliasOnly(): [boolean, (on: boolean) => void] {
    return useSwitch(ALIAS_ONLY_KEY, false);
}
