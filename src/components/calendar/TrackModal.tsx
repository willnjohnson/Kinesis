import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { createCalendarTrack, getWdbsTree, decodeWdbs, updateCalendarTrack, calendarToday, type CalendarAdvanceMode, type CalendarTrack, type CalendarTrackInput } from '../../api';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useFlags } from '../../hooks/useFlags';
import { handlePlainContextMenu } from '../../lib/markdown-editor';
import { Modal } from '../Modal';
import { SecondaryButton } from '../ui/Button';
import { Select } from '../ui/Select';
import { MODES, WEEKDAYS, parseClockText, parseDurationText, MIN_DURATION, clockLabel, durationLabel, flattenDrives } from './shared';

/** New track, or editing one: its name, how it advances, its days and start (dated ones), looping, and its Drive. */
export function TrackModal({ track, onClose, onSaved }: { track: CalendarTrack | null; onClose: () => void; onSaved: (id: number | null) => void }) {
    const { labels } = useWorkspace();
    const { flags } = useFlags();
    const [name, setName] = useState(track?.name ?? '');
    const [mode, setMode] = useState<CalendarAdvanceMode>(track?.advanceMode ?? 'completion');
    const [weekdays, setWeekdays] = useState<number[]>(track?.weekdays.length ? track.weekdays : [1, 3, 5]);
    const [startDate, setStartDate] = useState(track?.startDate ?? calendarToday());
    // Any time that day, or a window. Typed, not picked: the start ("9:30 AM") and the length ("1h 30m"), read by
    // parseClockText / parseDurationText.
    const [specificTime, setSpecificTime] = useState(track?.timeStart != null);
    const [startText, setStartText] = useState(track?.timeStart != null ? clockLabel(track.timeStart) : clockLabel(9 * 60));
    const [durationText, setDurationText] = useState(durationLabel(track?.timeDuration ?? 60));
    const startMinutes = parseClockText(startText);
    const durationMinutes = parseDurationText(durationText);
    // Why the time can't be saved as typed, if it can't (shown under the boxes, so Create Track is never held back unseen).
    const timeProblem = !specificTime ? null
        : startMinutes === null ? 'Type a start time, like 9:30 or 2pm.'
        : durationMinutes === null ? 'Type a length, like 45m, 1h 30m or 90.'
        : durationMinutes < MIN_DURATION ? `It has to last at least ${MIN_DURATION} minutes.`
        : startMinutes + durationMinutes > 24 * 60 ? "It can't run past midnight."
        : null;
    const [loop, setLoop] = useState(track?.loopEntries ?? false);
    const [drive, setDrive] = useState(track?.drive ?? '');
    const [followSequence, setFollowSequence] = useState(track?.sourceDriveSequence ?? false);
    const [drives, setDrives] = useState<{ path: string; label: string }[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!flags.showDrive) return;
        getWdbsTree()
            .then(tree => setDrives(flattenDrives(tree).map(n => {
                const path = decodeWdbs(n.path).toUpperCase();
                return { path, label: n.alias ? `${path} (${n.alias})` : path };
            }).filter(d => d.path)))
            .catch(() => {});
    }, [flags.showDrive]);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        const input: CalendarTrackInput = {
            name: name.trim(),
            drive,
            advanceMode: mode,
            loopEntries: loop,
            sourceDriveSequence: Boolean(drive) && followSequence,
            weekdays: mode === 'completion' ? [] : weekdays,
            startDate: mode === 'completion' ? undefined : startDate,
            timeStart: mode !== 'completion' && specificTime ? startMinutes : null,
            timeDuration: mode !== 'completion' && specificTime ? durationMinutes : null,
        };
        setSaving(true);
        try {
            if (track) {
                await updateCalendarTrack(track.id, input);
                onSaved(track.id);
            } else {
                onSaved(await createCalendarTrack(input));
            }
        } catch (err) {
            setError(String(err));
        } finally {
            setSaving(false);
        }
    };

    const toggleDay = (day: number) => setWeekdays(ds => (ds.includes(day) ? ds.filter(d => d !== day) : [...ds, day].sort()));
    const field = 'block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2';
    // Everything past the name, once there is one (an existing track already has one, so editing shows it all at once).
    const showRest = track !== null || name.trim() !== '';

    return (
        <Modal
            onClose={onClose}
            icon={track ? Pencil : Plus}
            title={track ? 'Edit Track' : 'New Track'}
            size="lg"
            onSubmit={save}
            bodyClassName="p-6 space-y-6"
            footer={
                <>
                    <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
                    <button type="submit" disabled={saving || !name.trim() || (mode !== 'completion' && (weekdays.length === 0 || timeProblem !== null))} className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                        {saving ? 'Saving...' : track ? 'Save Changes' : 'Create Track'}
                    </button>
                </>
            }
        >
            <div>
                <label className={field}>Name</label>
                <input
                    autoFocus
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onContextMenu={handlePlainContextMenu}
                    placeholder='e.g. "Data Structures, Fall" or "Push / Pull / Legs"'
                    className="w-full bg-[#121212] border border-[#333] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-600 transition-all placeholder-gray-600"
                />
            </div>

            {/* A new track's other settings appear once it has a name, so Create Track is never disabled for a reason
                that isn't on screen. */}
            {showRest && (
            <div className="space-y-6 animate-in fade-in duration-200">
            <div>
                <label className={field}>How it moves along</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {MODES.map(m => (
                        <button
                            key={m.mode}
                            type="button"
                            onClick={() => setMode(m.mode)}
                            className={`text-left rounded-xl border px-3 py-2.5 transition-colors cursor-pointer ${mode === m.mode ? 'border-[var(--k-accent)] bg-[#1a1a1a]' : 'border-[#333] hover:border-[#505050]'}`}
                        >
                            <span className="block text-sm font-semibold text-white">{m.label}</span>
                            <span className="block text-[11px] text-gray-500 mt-0.5 leading-snug">{m.hint}</span>
                        </button>
                    ))}
                </div>
            </div>

            {mode !== 'completion' && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-4">
                    <div>
                        <label className={field}>Days</label>
                        <div className="flex gap-1">
                            {WEEKDAYS.map(w => (
                                <button
                                    key={w.day}
                                    type="button"
                                    onClick={() => toggleDay(w.day)}
                                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${weekdays.includes(w.day) ? 'bg-red-600 text-white' : 'bg-[#1b1b1b] border border-[#333] text-gray-400 hover:text-white'}`}
                                >
                                    {w.short}
                                </button>
                            ))}
                        </div>
                        {/* The other thing that holds Create Track back: said, rather than leaving the button greyed out. */}
                        {weekdays.length === 0 && <p className="text-[11px] text-red-400 mt-1.5">Pick at least one day.</p>}
                    </div>
                    <div>
                        <label className={field}>Starts</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                            className="bg-[#121212] border border-[#333] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600 [color-scheme:dark]"
                        />
                    </div>
                </div>
            )}

            {mode !== 'completion' && (
                <div>
                    <label className={field}>Time</label>
                    <div className="flex gap-1 mb-3">
                        {[{ on: false, label: 'Any time that day' }, { on: true, label: 'Specific time' }].map(opt => (
                            <button
                                key={opt.label}
                                type="button"
                                onClick={() => setSpecificTime(opt.on)}
                                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${specificTime === opt.on ? 'bg-red-600 text-white' : 'bg-[#1b1b1b] border border-[#333] text-gray-400 hover:text-white'}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    {specificTime && (
                        <div className="flex items-center gap-2 flex-wrap">
                            {/* Plain boxes to type into (no clock picker, no fixed list of lengths). Leaving one tidies what
                                was typed into the usual form ("930" -> "9:30 AM", "90" -> "1h 30m"). */}
                            <input
                                value={startText}
                                onChange={e => setStartText(e.target.value)}
                                onBlur={() => { if (startMinutes !== null) setStartText(clockLabel(startMinutes)); }}
                                onContextMenu={handlePlainContextMenu}
                                placeholder="9:30 AM"
                                aria-label="Start time"
                                className={`w-28 bg-[#121212] border text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600 placeholder-gray-600 ${startMinutes === null ? 'border-red-500/60' : 'border-[#333]'}`}
                            />
                            <span className="text-sm text-gray-500">for</span>
                            <input
                                value={durationText}
                                onChange={e => setDurationText(e.target.value)}
                                onBlur={() => { if (durationMinutes !== null) setDurationText(durationLabel(durationMinutes)); }}
                                onContextMenu={handlePlainContextMenu}
                                placeholder="1h 30m"
                                aria-label="How long"
                                className={`w-28 bg-[#121212] border text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-600 placeholder-gray-600 ${durationMinutes === null ? 'border-red-500/60' : 'border-[#333]'}`}
                            />
                            {!timeProblem && startMinutes !== null && durationMinutes !== null && (
                                <span className="text-[11px] text-gray-500">until {clockLabel(startMinutes + durationMinutes)}</span>
                            )}
                        </div>
                    )}
                    {specificTime && (
                        timeProblem
                            ? <p className="text-[11px] text-red-400 mt-2">{timeProblem}</p>
                            : <p className="text-[11px] text-gray-500 mt-2">Two tracks can't share a time on the same day while both are running.</p>
                    )}
                </div>
            )}

            <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} className="mt-0.5 cursor-pointer" />
                <span>
                    <span className="block text-sm font-semibold text-white">Start over after the last one</span>
                    <span className="block text-[11px] text-gray-500">For a rotation, like Push / Pull / Legs.</span>
                </span>
            </label>

            {flags.showDrive && (
                <div>
                    <label className={field}>{labels.aliasDriveName}</label>
                    <Select look="field" value={drive} onValueChange={setDrive}>
                        <option value="">None</option>
                        {drive && !drives.some(d => d.path === drive) && <option value={drive}>{drive}</option>}
                        {drives.map(d => <option key={d.path} value={d.path}>{d.label}</option>)}
                    </Select>
                    {drive && (
                        <label className="flex items-start gap-3 cursor-pointer mt-3">
                            <input type="checkbox" checked={followSequence} onChange={e => setFollowSequence(e.target.checked)} className="mt-0.5 cursor-pointer" />
                            <span>
                                <span className="block text-sm font-semibold text-white">Follow this {labels.aliasDriveName.toLowerCase()}'s {labels.aliasSequence.toLowerCase()}</span>
                                <span className="block text-[11px] text-gray-500">The track's videos and their order come straight from the {labels.aliasSequence.toLowerCase()}, and stay in step with it.</span>
                            </span>
                        </label>
                    )}
                </div>
            )}
            </div>
            )}

            {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
        </Modal>
    );
}
