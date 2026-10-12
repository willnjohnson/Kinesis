import { useState } from 'react';
import { Folder, FolderPlus, ListPlus, ListTodo, NotebookPen, Pencil, Video as VideoIcon } from 'lucide-react';
import type { CalendarEntry } from '../../api';
import { handlePlainContextMenu } from '../../lib/markdown-editor';
import { Modal } from '../Modal';
import { UnsavedChangesModal } from '../UnsavedChangesModal';
import { CALENDAR_ICON_GROUPS, PRIORITIES, calendarIcon } from '../../lib/calendar-icons';
import { SecondaryButton } from '../ui/Button';
import { MarkdownField } from '../MarkdownField';

/** A task, new or being edited: its name, an icon that says what kind of thing it is (a reading, a workout, a vacation...),
 *  and a description. Closing it with changes unsaved (a click outside, Esc, the X) asks first, as other editors do.
 *  A video already on a track opens it too, as Edit Video: its name is the video's and its icon the video icon, so only
 *  its priority and description are edited. A folder opens it as Add Folder or Edit Folder: just a name (what's in it
 *  has its own priority and description). */
export function TaskModal({ entry, folder = false, trackName, onClose, onSave }: {
    entry: CalendarEntry | null;
    /** A new folder (an existing one is told by its entry). */
    folder?: boolean;
    trackName: string;
    onClose: () => void;
    onSave: (task: { label: string; icon: string; description: string; priority: number }) => Promise<void>;
}) {
    const [label, setLabel] = useState(entry?.label ?? '');
    const [icon, setIcon] = useState(entry?.icon ?? '');
    const [description, setDescription] = useState(entry?.description ?? '');
    const [priority, setPriority] = useState(entry?.priority ?? 0);
    // The icon tab on show: the one holding the task's icon, else the first.
    const [iconTab, setIconTab] = useState(() => CALENDAR_ICON_GROUPS.find(g => g.icons.some(i => i.name === entry?.icon))?.label ?? CALENDAR_ICON_GROUPS[0].label);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmClose, setConfirmClose] = useState(false);
    const dirty = label !== (entry?.label ?? '') || icon !== (entry?.icon ?? '') || description !== (entry?.description ?? '') || priority !== (entry?.priority ?? 0);
    const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };
    // A new task's other settings appear once it has a name, as with a new track (an existing task shows them all at once).
    const showRest = entry !== null || label.trim() !== '';
    // A video's entry, or a note's: named after itself when it has no label of its own.
    const isVideo = !!entry?.videoId || !!entry?.noteId;
    const isFolder = folder || !!entry?.isFolder;
    const noun = isFolder ? 'Folder' : 'Task';
    // A folder is only its name: priority, icon and description are its entries' own.
    const tabIcons = CALENDAR_ICON_GROUPS.find(g => g.label === iconTab)?.icons ?? [];

    const save = async () => {
        if (!isVideo && !label.trim()) return;
        setSaving(true);
        try {
            // A video keeps the label and icon it has (neither is shown here).
            await onSave({ label: label.trim(), icon, description: description.trim(), priority });
        } catch (e) {
            setError(String(e));
            setSaving(false);
        }
    };
    const field = 'block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2';
    const Picked = calendarIcon(icon);

    return (
        <>
            <Modal
                onClose={requestClose}
                icon={isFolder ? (entry ? Folder : FolderPlus) : entry ? Pencil : ListPlus}
                title={entry?.noteId ? 'Edit Note' : isVideo ? 'Edit Video' : entry ? `Edit ${noun}` : `Add ${noun}`}
                subtitle={trackName}
                size="lg"
                onSubmit={e => { e.preventDefault(); void save(); }}
                bodyClassName="p-6 space-y-6"
                footer={
                    <>
                        <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
                        <button type="submit" disabled={saving || (!isVideo && !label.trim())} className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                            {saving ? 'Saving...' : entry ? 'Save Changes' : `Add ${noun}`}
                        </button>
                    </>
                }
            >
                {isVideo ? (
                    <div>
                        <label className={field}>{entry?.noteId ? 'Note' : 'Video'}</label>
                        <div className="flex items-center gap-3">
                            <span className="w-11 h-11 shrink-0 rounded-xl bg-[#1b1b1b] border border-[#333] flex items-center justify-center text-gray-300">
                                {entry?.noteId ? <NotebookPen className="w-5 h-5" /> : <VideoIcon className="w-5 h-5" />}
                            </span>
                            <span className="flex-1 min-w-0 text-sm text-white truncate" title={entry!.title}>{entry!.title}</span>
                        </div>
                    </div>
                ) : (
                <div>
                    <label className={field}>Name</label>
                    <div className="flex items-center gap-3">
                        <span className="w-11 h-11 shrink-0 rounded-xl bg-[#1b1b1b] border border-[#333] flex items-center justify-center text-gray-300" title={isFolder ? undefined : 'Its icon (pick one below)'}>
                            {isFolder ? <Folder className="w-5 h-5" /> : <Picked className="w-5 h-5" />}
                        </span>
                        <input
                            autoFocus
                            required
                            value={label}
                            maxLength={200}
                            onChange={e => setLabel(e.target.value)}
                            onContextMenu={handlePlainContextMenu}
                            placeholder={isFolder ? 'e.g. "Lab day" or "Week 1 readings"' : 'e.g. "Problem set 3", "Leg day" or "Fall Break"'}
                            className="flex-1 min-w-0 bg-[#121212] border border-[#333] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-600 transition-all placeholder-gray-600"
                        />
                    </div>
                    <p className="text-[11px] text-gray-500 mt-2">
                        {isFolder
                            ? 'Drag videos and tasks into the folder to group them: On a dated track, everything in it lands on the same day.'
                            : 'A break works too: A task like "Free day" or "Fall Break" takes up a day on the schedule, so what comes after it moves along a day.'}
                    </p>
                </div>
                )}

                {showRest && !isFolder && (
                <div className="space-y-6 animate-in fade-in duration-200">
                <div>
                    <label className={field}>Priority</label>
                    <div className="flex gap-1">
                        {[{ level: 0, label: 'None', Icon: null, color: '' }, ...PRIORITIES].map(p => (
                            <button
                                key={p.level}
                                type="button"
                                onClick={() => setPriority(p.level)}
                                aria-pressed={priority === p.level}
                                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${priority === p.level ? 'bg-red-600 text-white' : 'bg-[#1b1b1b] border border-[#333] text-gray-400 hover:text-white'}`}
                            >
                                {p.Icon && <p.Icon className={`w-3.5 h-3.5 ${priority === p.level ? '' : p.color}`} />}
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1.5">A marker of how much it matters: it doesn't change {isVideo || isFolder ? 'its' : "the task's"} place or day.</p>
                </div>

                {!isVideo && !isFolder && (
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Icon</label>
                        <button
                            type="button"
                            onClick={() => setIcon('')}
                            aria-pressed={icon === ''}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${icon === '' ? 'bg-red-600 text-white' : 'bg-[#1b1b1b] border border-[#333] text-gray-400 hover:text-white'}`}
                        >
                            <ListTodo className="w-3.5 h-3.5" /> Default
                        </button>
                    </div>
                    {/* The groups as tabs, exactly like Settings' Export and History tabs. (It opens on the tab holding the
                        task's icon.) */}
                    <div className="flex items-center gap-4 mb-3 overflow-x-auto">
                        {CALENDAR_ICON_GROUPS.map(group => {
                            const active = group.label === iconTab;
                            return (
                                <button
                                    key={group.label}
                                    type="button"
                                    onClick={() => setIconTab(group.label)}
                                    className={`relative shrink-0 pb-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap ${active ? 'text-white' : 'text-[#666666] hover:text-[#aaaaaa]'}`}
                                >
                                    {group.label}
                                    {active && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-600" />}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {tabIcons.map(({ name, Icon, label: iconLabel }) => (
                            <button
                                key={name}
                                type="button"
                                onClick={() => setIcon(name)}
                                title={iconLabel}
                                aria-label={iconLabel}
                                aria-pressed={icon === name}
                                className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${icon === name ? 'bg-red-600 text-white' : 'bg-[#1b1b1b] border border-[#333] text-gray-400 hover:text-white hover:bg-[#262626]'}`}
                            >
                                <Icon className="w-4 h-4" />
                            </button>
                        ))}
                    </div>
                </div>
                )}

                <div>
                    {/* Markdown, as every other description is: the same editor (right-click formatting, @ and ^ links,
                        a preview), so a task can link the video or term it's about. */}
                    <MarkdownField
                        label="Description"
                        value={description}
                        onChange={setDescription}
                        rows={5}
                        focusColor="red"
                        placeholder="Anything to remember about it: What to read, which exercises, where you're going..."
                    />
                </div>
                </div>
                )}

                {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
            </Modal>
            {confirmClose && (
                <UnsavedChangesModal
                    message={<>You have unsaved changes to this {entry?.noteId ? 'note' : isVideo ? 'video' : noun.toLowerCase()}. Save them before closing?</>}
                    saving={saving}
                    onCancel={() => setConfirmClose(false)}
                    onDiscard={() => { setConfirmClose(false); onClose(); }}
                    onSave={() => { setConfirmClose(false); void save(); }}
                />
            )}
        </>
    );
}
