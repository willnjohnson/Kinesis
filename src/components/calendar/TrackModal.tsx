import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { createCalendarTrack, getWdbsTree, decodeWdbs, updateCalendarTrack, calendarToday, type CalendarAdvanceMode, type CalendarRepeat, type CalendarRepeatKind, type CalendarTrack, type CalendarTrackInput } from '../../api';
import { useWorkspace } from '../../hooks/useWorkspace';
import { useFlags } from '../../hooks/useFlags';
import { handlePlainContextMenu } from '../../lib/markdown-editor';
import { Modal } from '../Modal';
import { SecondaryButton } from '../ui/Button';
import { Select } from '../ui/Select';
import { DateInput } from '../ui/DateInput';
import { UnsavedChangesModal } from '../UnsavedChangesModal';
import { MODES, WEEKDAYS, DEFAULT_REPEAT, ORDINALS, repeatLabel, firstDays, weekdayOf, niceDate, parseClockText, parseDurationText, MIN_DURATION, clockLabel, durationLabel, flattenDrives } from './shared';

/** What "Start over after the last one" does, said in full when it's hovered: the checkbox's own words leave open what
 *  starts over and when. It differs by how the track moves along, so each way has its own. */
const LOOP_INFO: Record<CalendarAdvanceMode, string> = {
    completion: 'On: Once the last item is done, the first one is up again and the list runs through another time, with everything unchecked for the new round.\nOff: The track is finished after its last item.',
    calendar: "On: The scheduled day after the last item's goes to the first item again, and the list keeps going round for as long as the track runs.\nOff: The track ends on its last item's day.",
    hybrid: 'On: Once the last item is done, the list runs through again from the first item, on the scheduled days that follow, with everything unchecked for the new round.\nOff: The track is finished after its last item.',
};

/** The patterns most schedules are, by name (the Repeats dropdown). One without `days` keeps whichever days are picked:
 *  "Every other week" is those days, every second week. Anything else is made under Custom. */
const PRESETS: { id: string; label: string; kind: CalendarRepeatKind; every?: number; ordinal?: number; days?: number[] }[] = [
    { id: 'daily', label: 'Every day', kind: 'weekly', every: 1, days: [1, 2, 3, 4, 5, 6, 7] },
    { id: 'weekdays', label: 'Weekdays (Mon to Fri)', kind: 'weekly', every: 1, days: [1, 2, 3, 4, 5] },
    { id: 'mwf', label: 'Mon/Wed/Fri', kind: 'weekly', every: 1, days: [1, 3, 5] },
    { id: 'tth', label: 'Tue/Thu', kind: 'weekly', every: 1, days: [2, 4] },
    { id: 'other-day', label: 'Every other day', kind: 'interval', every: 2 },
    { id: 'other-week', label: 'Every other week', kind: 'weekly', every: 2 },
    { id: 'first-monday', label: 'First Monday of the month', kind: 'monthly', ordinal: 1, days: [1] },
];
const KINDS: { value: CalendarRepeatKind; label: string }[] = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'interval', label: 'Daily' },
    { value: 'monthly', label: 'Monthly' },
];
/** The longest gaps a pattern can have (MAX_REPEAT_WEEKS / MAX_REPEAT_DAYS in db/calendar.rs). */
const MAX_EVERY: Record<CalendarRepeatKind, number> = { weekly: 52, interval: 365, monthly: 1 };

// The window's settings are laid out as rows: what each is on the left, its control on the right (stacked, when the
// window is too narrow for the two side by side). The controls in a row share one height.
const ROWS = 'grid grid-cols-1 sm:grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-3.5';
const INPUT = 'bg-[#121212] border text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-red-600 placeholder-gray-600';

/** One of those rows. Its name sits level with the text in its control's first line, whatever comes under that (a hint,
 *  a second control); `text`: the row is plain text (a checkbox and its words), which has no box to be level with. */
function Row({ label, text = false, children }: { label: string; text?: boolean; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5 sm:contents">
            <span className={`text-sm text-gray-400 sm:self-start ${text ? '' : 'sm:pt-1.5'}`}>{label}</span>
            <div className="min-w-0">{children}</div>
        </div>
    );
}

/** What each way of moving along is for, in full (More Info, beside "How it moves along"): how it behaves, and the kind
 *  of plan it suits. The cards themselves keep the one-line version (MODES). */
const MODE_INFO: { mode: CalendarAdvanceMode; how: string; examples: string[] }[] = [
    {
        mode: 'completion',
        how: "There are no dates. One item is up at a time, and the next comes up when you mark it done. Take a week off and nothing is late: It's waiting where you left it.",
        examples: [
            'A course you take at your own pace, one lecture after the last.',
            'A reading list, or a series to watch in order.',
            'A workout rotation (with "Start over after the last one"): Push, Pull, Legs, and round again, whenever you train.',
        ],
    },
    {
        mode: 'calendar',
        how: 'Each scheduled day has its item, whether or not the last one was done. Miss a day and the track moves on without you, the way a class does. Nothing is ever overdue.',
        examples: [
            'A class that meets Mon/Wed/Fri: Lecture 7 is Wednesday whether or not you watched Lecture 6.',
            'A daily habit, where today is what matters and yesterday is gone.',
            'A rotation tied to days: Legs every Tuesday.',
        ],
    },
    {
        mode: 'hybrid',
        how: "Each item has a day, and also waits for the one before it to be done. Fall behind and the item that's up shows as overdue until you finish it; the rest keep their days.",
        examples: [
            'Homework and problem sets, each due on its day and none to be skipped.',
            'A study plan before an exam, where falling behind should be visible.',
            'A project with steps that build on each other, on a timeline.',
        ],
    },
];

/** New track, or editing one, in three parts: its name and how it moves along; its Schedule, for one that follows
 *  dates (how its days repeat, from when, at what time); and its Options (looping, its Drive). */
export function TrackModal({ track, onClose, onSaved }: { track: CalendarTrack | null; onClose: () => void; onSaved: (id: number | null) => void }) {
    const { labels } = useWorkspace();
    const { flags } = useFlags();
    const [name, setName] = useState(track?.name ?? '');
    const [mode, setMode] = useState<CalendarAdvanceMode>(track?.advanceMode ?? 'completion');
    const [weekdays, setWeekdays] = useState<number[]>(track?.weekdays.length ? track.weekdays : [1, 3, 5]);
    const [startDate, setStartDate] = useState(track?.startDate ?? calendarToday());
    // How the days repeat (CalendarRepeat). "Every" is typed, so it's kept as text and read when it's needed.
    const [kind, setKind] = useState<CalendarRepeatKind>(track?.repeat.kind ?? 'weekly');
    const [everyText, setEveryText] = useState(String(track?.repeat.every ?? 1));
    const [ordinal, setOrdinal] = useState(track?.repeat.ordinal ?? 1);
    const [custom, setCustom] = useState(false);
    const everyTyped = /^\d+$/.test(everyText) ? Number(everyText) : null;
    const repeatProblem = kind === 'monthly' || (everyTyped !== null && everyTyped >= 1 && everyTyped <= MAX_EVERY[kind])
        ? null
        : `Type a number from 1 to ${MAX_EVERY[kind]}.`;
    const repeat: CalendarRepeat = { kind, every: kind === 'monthly' ? 1 : everyTyped ?? 1, ordinal: kind === 'monthly' ? ordinal : 1 };
    // Every N days counts from Starts, so it has no days of the week to pick.
    const usesDays = kind !== 'interval';
    const dayKey = [...weekdays].sort().join();
    const daysProblem = usesDays && weekdays.length === 0;
    // The pattern as one string: what's compared to tell whether it's been changed.
    const patternKey = `${kind}|${kind === 'monthly' ? ordinal : everyText}|${usesDays ? dayKey : ''}`;
    // The preset the pattern is, if it's one of them. Custom is what's picked when it's none, or when Custom was chosen.
    const preset = PRESETS.find(p => p.kind === kind
        && (kind === 'monthly' ? p.ordinal === ordinal : p.every === everyTyped)
        && (!p.days || !usesDays || p.days.join() === dayKey))?.id ?? null;
    const showCustom = custom || preset === null;
    const applyPreset = (p: typeof PRESETS[number]) => {
        setCustom(false);
        setKind(p.kind);
        setEveryText(String(p.every ?? 1));
        setOrdinal(p.ordinal ?? 1);
        if (p.days) setWeekdays(p.days);
        else if (p.kind !== 'interval' && weekdays.length === 0) setWeekdays([weekdayOf(startDate)]);
    };
    const pickRepeat = (id: string) => {
        const p = PRESETS.find(x => x.id === id);
        if (p) applyPreset(p);
        else setCustom(true);
    };
    // The Days row: under Custom, and for a preset that leaves the days open (Every other week).
    const showDays = showCustom || (usesDays && !PRESETS.find(p => p.id === preset)?.days);
    const pickKind = (k: CalendarRepeatKind) => {
        if (k === kind) return;
        setKind(k);
        setEveryText(k === 'interval' ? '2' : '1');
    };
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
    const [moreInfo, setMoreInfo] = useState(false);
    // Closing with changes unsaved (a click outside, Esc, the X) asks first, as the task window does. Cancel discards on
    // purpose. What's compared is what would be saved: each field as it started (the track's, or a new track's defaults).
    const [confirmClose, setConfirmClose] = useState(false);
    const started = useRef({ name, mode, patternKey, startDate, specificTime, startText, durationText, loop, drive, followSequence });
    const s = started.current;
    const dirty = name !== s.name || mode !== s.mode || loop !== s.loop || drive !== s.drive || followSequence !== s.followSequence
        || (mode !== 'completion' && (patternKey !== s.patternKey || startDate !== s.startDate || specificTime !== s.specificTime
            || (specificTime && (startText !== s.startText || durationText !== s.durationText))));
    const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };
    // An existing track being given another way of moving along: said, before it's saved, since it changes what the
    // track's items do.
    const modeChanged = track !== null && mode !== track.advanceMode;

    useEffect(() => {
        if (!flags.showDrive) return;
        getWdbsTree()
            .then(tree => setDrives(flattenDrives(tree).map(n => {
                const path = decodeWdbs(n.path).toUpperCase();
                return { path, label: n.alias ? `${path} (${n.alias})` : path };
            }).filter(d => d.path)))
            .catch(() => {});
    }, [flags.showDrive]);

    const save = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const input: CalendarTrackInput = {
            name: name.trim(),
            drive,
            advanceMode: mode,
            loopEntries: loop,
            sourceDriveSequence: Boolean(drive) && followSequence,
            weekdays: mode === 'completion' || !usesDays ? [] : weekdays,
            repeat: mode === 'completion' ? DEFAULT_REPEAT : repeat,
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
    // The words between a row's controls ("every [2] weeks").
    const between = 'text-sm text-gray-500';
    // The pattern's first few days, to check it against what was meant.
    const preview = mode !== 'completion' && !repeatProblem && !daysProblem ? firstDays(repeat, startDate, weekdays, 4) : [];
    // Everything past the name, once there is one (an existing track already has one, so editing shows it all at once).
    const showRest = track !== null || name.trim() !== '';

    return (
        <>
        <Modal
            onClose={requestClose}
            icon={track ? Pencil : Plus}
            title={track ? 'Edit Track' : 'New Track'}
            size="lg"
            onSubmit={save}
            bodyClassName="p-6 space-y-6"
            footer={
                <>
                    <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
                    <button type="submit" disabled={saving || !name.trim() || (mode !== 'completion' && (daysProblem || repeatProblem !== null || timeProblem !== null))} className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
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
                    maxLength={80}
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
                <div className="flex items-center justify-between mb-2">
                    <label className={`${field} mb-0`}>How it moves along</label>
                    <button
                        type="button"
                        onClick={() => setMoreInfo(o => !o)}
                        aria-expanded={moreInfo}
                        className={`flex items-center gap-1 text-[11px] font-semibold transition-colors cursor-pointer ${moreInfo ? 'text-white' : 'text-gray-500 hover:text-white'}`}
                    >
                        <Info className="w-3.5 h-3.5" /> {moreInfo ? 'Less Info' : 'More Info'}
                    </button>
                </div>
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
                {/* Each card in full, under it (the same three columns, so each explanation sits under its card). */}
                {moreInfo && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 animate-in fade-in duration-150">
                        {MODE_INFO.map(info => (
                            <div key={info.mode} className={`rounded-xl border px-3 py-2.5 ${mode === info.mode ? 'border-[#444] bg-[#161616]' : 'border-[#262626]'}`}>
                                <p className="text-[11px] text-gray-300 leading-snug">{info.how}</p>
                                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mt-2.5 mb-1">Good for</p>
                                <ul className="space-y-1">
                                    {info.examples.map(ex => (
                                        <li key={ex} className="flex gap-1.5 text-[11px] text-gray-400 leading-snug">
                                            <span className="text-gray-600">•</span><span>{ex}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                )}
                {modeChanged && (
                    <div className="flex gap-2 mt-2 text-[11px] text-amber-300 bg-amber-900/15 border border-amber-500/30 rounded-lg px-3 py-2 leading-snug">
                        <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                            This track is "{MODES.find(m => m.mode === track!.advanceMode)?.label}" now. Changing how it moves along changes what's up next and which days its
                            items fall on{mode === 'completion' ? ' (it will have no days at all)' : track!.advanceMode === 'completion' ? ' (they get days, counted from Starts)' : ''}. What's been marked done is kept.
                        </span>
                    </div>
                )}
            </div>

            {/* Everything about its days in one block, a row to a setting: how they repeat, which days, from when, and at
                what time. */}
            {mode !== 'completion' && (
                <div>
                    <label className={field}>Schedule</label>
                    <div className={ROWS}>
                        <Row label="Repeats">
                            {/* The usual patterns by name; Custom opens the rule itself beside it (and is what's picked
                                whenever the pattern isn't one of the usual ones). */}
                            <div className="flex items-center gap-2 flex-wrap">
                                {/* The picker is as wide as its longest name; on Custom it's cut to that word, leaving the row
                                    to the rule beside it. */}
                                <Select look="setting" value={showCustom ? 'custom' : preset ?? 'custom'} onValueChange={pickRepeat} className={showCustom ? 'w-28' : ''} aria-label="How its days repeat">
                                    {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                                    <option value="custom">Custom</option>
                                </Select>
                                {showCustom && (
                                    <>
                                        <Select look="setting" value={kind} onValueChange={v => pickKind(v as CalendarRepeatKind)} aria-label="Kind of pattern">
                                            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                                        </Select>
                                        {kind === 'monthly' ? (
                                            // Read with the Days under it: "Monthly, on the last [Mon] [Thu]".
                                            <Select look="setting" value={String(ordinal)} onValueChange={v => setOrdinal(Number(v))} aria-label="Which one in the month">
                                                {ORDINALS.map((label, i) => <option key={label} value={i + 1}>on the {label.toLowerCase()}</option>)}
                                            </Select>
                                        ) : (
                                            // Kept together, so "weeks" is never left on a line of its own.
                                            <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                                <span className={between}>every</span>
                                                <input
                                                    value={everyText}
                                                    onChange={e => setEveryText(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                                                    onContextMenu={handlePlainContextMenu}
                                                    inputMode="numeric"
                                                    aria-label={kind === 'interval' ? 'How many days apart' : 'How many weeks apart'}
                                                    className={`w-14 text-center ${INPUT} ${repeatProblem ? 'border-red-500/60' : 'border-[#333]'}`}
                                                />
                                                <span className={between}>{kind === 'interval' ? (everyTyped === 1 ? 'day' : 'days') : (everyTyped === 1 ? 'week' : 'weeks')}</span>
                                            </span>
                                        )}
                                    </>
                                )}
                            </div>
                            {showCustom && repeatProblem && <p className="text-[11px] text-red-400 mt-1.5">{repeatProblem}</p>}
                        </Row>
                        {/* Only where there are days to pick: a pattern named for its days (Mon/Wed/Fri) already says them.
                            Under Custom the row stays put, greyed out for a daily count, which lands on whatever day it does. */}
                        {showDays && (
                            <Row label="Days">
                                <div className="flex items-center gap-x-3 gap-y-1.5 flex-wrap">
                                    <div className={`flex gap-1 ${usesDays ? '' : 'opacity-35'}`}>
                                        {WEEKDAYS.map(w => (
                                            <button
                                                key={w.day}
                                                type="button"
                                                disabled={!usesDays}
                                                aria-pressed={usesDays && weekdays.includes(w.day)}
                                                onClick={() => toggleDay(w.day)}
                                                className={`w-11 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:cursor-default ${usesDays && weekdays.includes(w.day) ? 'bg-red-600 text-white' : `bg-[#1b1b1b] border border-[#333] text-gray-400 ${usesDays ? 'hover:text-white' : ''}`}`}
                                            >
                                                {w.short}
                                            </button>
                                        ))}
                                    </div>
                                    {!usesDays && <span className="text-[11px] text-gray-500">Not used: the days are counted from Starts.</span>}
                                    {/* The other thing that holds Create Track back: said, rather than leaving the button greyed out. */}
                                    {daysProblem && <span className="text-[11px] text-red-400">Pick at least one day.</span>}
                                </div>
                            </Row>
                        )}
                        <Row label="Starts">
                            <DateInput value={startDate} onValueChange={setStartDate} className={`${INPUT} border-[#333] [color-scheme:dark]`} />
                        </Row>
                        <Row label="Time">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Select look="setting" value={specificTime ? 'specific' : 'any'} onValueChange={v => setSpecificTime(v === 'specific')} aria-label="Time of day">
                                    <option value="any">Any time that day</option>
                                    <option value="specific">Specific time</option>
                                </Select>
                                {specificTime && (
                                    <>
                                        {/* Plain boxes to type into (no clock picker, no fixed list of lengths). Leaving one tidies
                                            what was typed into the usual form ("930" -> "9:30 AM", "90" -> "1h 30m"). */}
                                        <input
                                            value={startText}
                                            onChange={e => setStartText(e.target.value)}
                                            onBlur={() => { if (startMinutes !== null) setStartText(clockLabel(startMinutes)); }}
                                            onContextMenu={handlePlainContextMenu}
                                            placeholder="9:30 AM"
                                            aria-label="Start time"
                                            className={`w-24 ${INPUT} ${startMinutes === null ? 'border-red-500/60' : 'border-[#333]'}`}
                                        />
                                        <span className={between}>for</span>
                                        <input
                                            value={durationText}
                                            onChange={e => setDurationText(e.target.value)}
                                            onBlur={() => { if (durationMinutes !== null) setDurationText(durationLabel(durationMinutes)); }}
                                            onContextMenu={handlePlainContextMenu}
                                            placeholder="1h 30m"
                                            aria-label="How long"
                                            className={`w-24 ${INPUT} ${durationMinutes === null ? 'border-red-500/60' : 'border-[#333]'}`}
                                        />
                                        {!timeProblem && startMinutes !== null && durationMinutes !== null && (
                                            <span className="text-[11px] text-gray-500">until {clockLabel(startMinutes + durationMinutes)}</span>
                                        )}
                                    </>
                                )}
                            </div>
                            {specificTime && (
                                timeProblem
                                    ? <p className="text-[11px] text-red-400 mt-1.5">{timeProblem}</p>
                                    : <p className="text-[11px] text-gray-500 mt-1.5">Two tracks can't share a time on the same day while both are running.</p>
                            )}
                        </Row>
                    </div>
                    {/* The schedule said back, with its first days: what was picked is easy to get subtly wrong (which week
                        "every other week" starts on), and this shows it. */}
                    {preview.length > 0 && (
                        <p className="mt-3 text-[11px] text-gray-500 leading-snug bg-[#141414] border border-[#262626] rounded-lg px-3 py-2">
                            <span className="text-gray-300 font-semibold">{repeatLabel(repeat, usesDays ? weekdays : [])}</span>
                            {kind === 'weekly' && repeat.every > 1 && ', counting weeks from the week it starts in'}
                            {'. First days: '}{preview.map(niceDate).join(' · ')}.
                        </p>
                    )}
                </div>
            )}

            <div>
                <label className={field}>Options</label>
                <div className={ROWS}>
                    <Row label="Rotation" text>
                        <label className="flex items-start gap-3 cursor-pointer" title={LOOP_INFO[mode]}>
                            <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} className="mt-0.5 cursor-pointer" />
                            <span>
                                <span className="block text-sm font-semibold text-white">Start over after the last one</span>
                                <span className="block text-[11px] text-gray-500">For a rotation, like Push / Pull / Legs.</span>
                            </span>
                        </label>
                    </Row>
                    {flags.showDrive && (
                        <Row label={labels.aliasDriveName}>
                            <Select look="setting" value={drive} onValueChange={setDrive} wrapperClassName="max-w-full" className="max-w-full" aria-label={labels.aliasDriveName}>
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
                        </Row>
                    )}
                </div>
            </div>
            </div>
            )}

            {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
        </Modal>
        {confirmClose && (
            <UnsavedChangesModal
                message={<>You have unsaved changes to this track. Save them before closing?</>}
                saving={saving}
                onCancel={() => setConfirmClose(false)}
                onDiscard={() => { setConfirmClose(false); onClose(); }}
                onSave={() => { setConfirmClose(false); void save(); }}
            />
        )}
        </>
    );
}
