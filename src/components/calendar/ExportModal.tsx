import { useState } from 'react';
import { Download } from 'lucide-react';
import { exportCalendarIcs, type CalendarTrack } from '../../api';
import { useWorkspace } from '../../hooks/useWorkspace';
import { workspaceFileStem } from '../../lib/workspace';
import { Modal } from '../Modal';
import { DateInput } from '../ui/DateInput';
import { SecondaryButton } from '../ui/Button';
import { trackColor, parseDay, isoDay, niceDate, trackTime } from './shared';

/** Export to Calendar (from a track's right-click menu): which scheduled tracks, from which day to which, then where to
 *  save the .ics file. More tracks can be ticked to go in the same file. (A track that goes one after another has no days,
 *  so it isn't offered.) */
export function ExportModal({ tracks, preselected, weekStart, onClose, onExported }: {
    tracks: CalendarTrack[];
    /** Ticked to begin with: the track it was opened from (all of them, if that isn't one of `tracks`). */
    preselected: Set<number>;
    weekStart: string;
    onClose: () => void;
    onExported: (path: string) => void;
}) {
    const { labels } = useWorkspace();
    const [chosen, setChosen] = useState<Set<number>>(() => {
        const shownDated = tracks.filter(t => preselected.has(t.id)).map(t => t.id);
        return new Set(shownDated.length ? shownDated : tracks.map(t => t.id));
    });
    const [from, setFrom] = useState(weekStart);
    // The last day, to begin with three months on from the first, less a day.
    const [to, setTo] = useState(() => { const d = parseDay(weekStart); d.setMonth(d.getMonth() + 3); d.setDate(d.getDate() - 1); return isoDay(d); });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const toggle = (id: number) => setChosen(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    // ISO dates compare as text. The To picker can't go before From (min), but a date can still be typed in.
    const backwards = to < from;
    // The backend's limit (commands/calendar.rs): a period of up to two years.
    const tooLong = !backwards && (parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000 > 2 * 366;
    const latest = (() => { const d = parseDay(from); d.setDate(d.getDate() + 2 * 366); return isoDay(d); })();
    const field = 'block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2';

    const run = async () => {
        setBusy(true);
        setError(null);
        try {
            const stem = workspaceFileStem(labels.workspaceName) || 'Kinesis';
            const path = await exportCalendarIcs(tracks.filter(t => chosen.has(t.id)).map(t => t.id), from, to, `${stem}_Calendar.ics`);
            if (path) onExported(path);
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal
            onClose={onClose}
            icon={Download}
            title="Export to Calendar"
            subtitle="An .ics file for Google Calendar, Apple Calendar or Outlook"
            size="sm"
            onSubmit={e => { e.preventDefault(); void run(); }}
            bodyClassName="p-6 space-y-5"
            footer={
                <>
                    <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
                    <button type="submit" disabled={busy || chosen.size === 0 || backwards || tooLong} className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                        {busy ? 'Exporting...' : 'Export'}
                    </button>
                </>
            }
        >
            <div>
                <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Tracks</label>
                    <button type="button" onClick={() => setChosen(chosen.size === tracks.length ? new Set() : new Set(tracks.map(t => t.id)))} className="text-[11px] font-semibold text-gray-400 hover:text-white cursor-pointer">
                        {chosen.size === tracks.length ? 'Select none' : 'Select all'}
                    </button>
                </div>
                <div className="bg-[#121212] border border-[#272727] rounded-xl p-1.5 max-h-48 overflow-y-auto custom-scrollbar space-y-0.5">
                    {tracks.map(t => (
                        <label key={t.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#1a1a1a] cursor-pointer">
                            <input type="checkbox" checked={chosen.has(t.id)} onChange={() => toggle(t.id)} className="cursor-pointer" />
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: trackColor(t.id) }} />
                            <span className="text-sm text-gray-200 truncate flex-1">{t.name}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">{trackTime(t) ?? 'all day'}</span>
                        </label>
                    ))}
                </div>
                {chosen.size === 0 && <p className="text-[11px] text-red-400 mt-1.5">Pick at least one track.</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className={field}>From</label>
                    <DateInput
                        value={from}
                        // Moving From past To takes To along, so the period never runs backwards.
                        onValueChange={v => { if (!v) return; setFrom(v); if (to < v) setTo(v); }}
                        className="w-full bg-[#121212] border border-[#333] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600 [color-scheme:dark]"
                    />
                </div>
                <div>
                    <label className={field}>To</label>
                    <DateInput
                        value={to}
                        min={from}
                        max={latest}
                        onValueChange={v => { if (v) setTo(v); }}
                        className={`w-full bg-[#121212] border text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600 [color-scheme:dark] ${backwards || tooLong ? 'border-red-500/60' : 'border-[#333]'}`}
                    />
                </div>
            </div>
            {backwards && <p className="text-[11px] text-red-400 -mt-3">To can't be before From.</p>}
            {tooLong && <p className="text-[11px] text-red-400 -mt-3">Pick a period of up to two years.</p>}
            <p className="text-[11px] text-gray-500 leading-relaxed">
                {niceDate(from)} to {niceDate(to)}, both days included. Each scheduled item becomes an event: timed for a track with a set time, all day otherwise.
                It's a copy as of now: Export again after changing a track, and re-importing updates the events instead of doubling them.
            </p>
            {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
        </Modal>
    );
}
