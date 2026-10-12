import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { getSettings, setSetting } from "../../api";
import { useFlags } from "../../hooks/useFlags";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useLockedSettings, LOCKED_TITLE } from "../../hooks/useLockedSettings";
import { READ_ONLY_OVERRIDE_KEYS, parseBool, type FlagKey } from "../../lib/flags";
import { ConfirmDialog } from "../ConfirmDialog";
import { ErrorBox } from "../workspace/shared";

// Label/hint for each flag in READ_ONLY_OVERRIDE_KEYS that doesn't already have its own dedicated
// control elsewhere in Settings — this list exists so there's SOME way to reach a flag no other
// screen offers, not to give every flag a second home. One of the sixteen is deliberately left out:
//   - allowClearHistory: History's own Settings view (Keep search history / Clear history after) is
//     already where Search History configuration lives.
// (allowEditWDBS used to have its own toggle in PluginsTab — a permission living among a list of
// external-service integrations it had nothing to do with. It belongs here instead, alongside every
// other allowEdit* flag, not off on its own.) Still in READ_ONLY_OVERRIDE_KEYS and still forced off
// by Read-only — omitting a row here only means this generic list doesn't duplicate a switch that
// already exists somewhere better-suited. Partial (not a full Record<FlagKey, ...>) for exactly that
// reason; ROWS below filters READ_ONLY_OVERRIDE_KEYS down to the keys actually present here, rather
// than assuming full coverage, so the render order still comes from that one shared list and the two
// can't silently drift apart.
const permissionsFor = (sequenceLabel: string): Partial<Record<FlagKey, { label: string; hint: string }>> => ({
    allowSaveToLibrary: { label: "Saving Videos", hint: "Save a video from Search into the Library." },
    allowSaveAll: { label: "Bulk Save", hint: "Save every current search result at once (needs Saving Videos too)." },
    allowDeletionLibrary: { label: "Deleting Videos", hint: "Remove a video from the Library." },
    allowSummarizeAll: { label: "Bulk Summarize", hint: "Generate an AI summary for every video in the Library at once." },
    editAttachments: { label: "Attachments & Links", hint: "Add or remove a video's attachments and web links." },
    allowEditTermsAndTags: { label: "Terms & Tags", hint: "Add or remove a video's Terms and Tags. The Essential tags (Watch Later, Favorite...) stay open either way: They're each reader's own." },
    allowEditSummary: { label: "AI Summaries", hint: "Edit a video's AI-generated summary." },
    allowEditTranscript: { label: "Transcripts", hint: "Edit a video's transcript." },
    allowEditTranscriptOnNA: { label: "Cleared Transcripts", hint: "Edit a transcript that was cleared to N/A after summarizing." },
    allowEditWDBS: { label: "Drive Assignment", hint: "Assign, change, or symlink a saved video's Drive category." },
    allowEditDriveLinking: { label: "Drive Editing UI", hint: "The Drive pencil editor and Bulk Assign Mode." },
    allowEditSequences: { label: `${sequenceLabel} Reordering`, hint: `Reorder or remove one video at a time from a ${sequenceLabel.toLowerCase()}.` },
    allowEditVideosInSequenceList: { label: `${sequenceLabel} Building`, hint: `Add Videos, Add to the End, and Clear ${sequenceLabel}.` },
    allowModificationGlossary: { label: "Glossary", hint: "Add, edit, or delete Terms and Tags in the Glossary itself." },
    allowEditBio: { label: "Biographies", hint: "Edit a creator's biography." },
    allowEditSharedNotes: { label: "Shared Notes", hint: "Write, edit, or delete shared notes, and make a note shared. Personal notes stay open either way: They're each reader's own." },
});

// Not permissions: switches for "are you sure?" questions. Read-only doesn't turn them off (that would mean "don't
// ask"); it turns the action itself off, so they are greyed out then and their stored value is left alone. They come
// after the permissions, and turning one off asks a second question.
const CONFIRM_ROWS = [
    {
        key: "confirmBeforeEditingTranscript",
        label: "Confirm Before Editing Transcript",
        hint: "Ask before editing a transcript, since it may be cleared (replaced with N/A) when the video is AI summarized. Keep this on unless you really need it off.",
        readOnlyTitle: "Editing is off while the workspace is read-only, above",
        warning: (
            <>
                Editing a transcript will <strong className="text-white">no longer ask first</strong>.
                <br /><br />
                If the video is AI summarized later, its transcript <strong className="text-white">may be cleared</strong> (replaced with N/A) and your edits lost.
                <br /><br />
                It's best to keep this on unless you really need it off.
            </>
        ),
    },
    {
        key: "confirmBeforeDeleting",
        label: "Confirm Before Deleting",
        hint: 'Ask "are you sure?" before deleting a video, a Glossary term or tag, or an attachment. Keep this on unless you really need it off.',
        readOnlyTitle: "Deleting is off while the workspace is read-only, above",
        warning: (
            <>
                Deleting will <strong className="text-white">no longer ask first</strong>, which makes mistakes easier to make.
                <br /><br />
                Most deletes can be undone from the Trash, <strong className="text-white">except attachments</strong>.
                <br /><br />
                It's best to keep this on unless you really need it off.
            </>
        ),
    },
] as const;
// Not a permission either, nor a safety net: whether a channel renamed on YouTube asks about an alias. Off unless
// turned on, and a plain switch (nothing is lost by it: the alias can be set by hand in Edit Bio).
const NO_ALIAS_KEY = "doNotAskToAlias";
// Not a permission either: whether a saved video renamed on YouTube shows a "Video Title Renamed" modal.
// Off (default) shows the modal. On silently accepts the new title without notifying.
const NO_NOTIFY_TITLE_CHANGE_KEY = "doNotNotifyVideoTitleChange";
type ConfirmKey = typeof CONFIRM_ROWS[number]["key"];
const CONFIRM_KEYS = CONFIRM_ROWS.map(r => r.key);

/** Settings > Workspace > Advanced > Permissions: a master Read-only switch, plus every
 *  content-editing flag individually (see lib/flags.ts's READ_ONLY_OVERRIDE_KEYS — this list and
 *  what Read-only forces off are the same list by construction). Reads and writes the Settings
 *  table directly, the same way every other Settings screen does; a sync server's policy lock
 *  (useLockedSettings) disables a row exactly like it disables any other control here. */
export function PermissionsPanel() {
    const { reload } = useFlags();
    const { labels } = useWorkspace();
    const permissions = permissionsFor(labels.aliasSequence);
    const rows = READ_ONLY_OVERRIDE_KEYS.filter(key => key in permissions).map(key => ({ key, ...permissions[key]! }));
    const isLocked = useLockedSettings();
    const [values, setValues] = useState<Record<string, boolean> | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [savingKey, setSavingKey] = useState<string | null>(null);

    // Asked before turning one of the "Confirm Before ..." switches off (a second confirmation): which one, if any.
    const [confirmingOff, setConfirmingOff] = useState<ConfirmKey | null>(null);

    const allKeys = ['workspaceReadOnly', ...CONFIRM_KEYS, NO_ALIAS_KEY, NO_NOTIFY_TITLE_CHANGE_KEY, ...rows.map(r => r.key)];

    const load = () => {
        getSettings(allKeys)
            // The "Confirm Before ..." switches are on unless turned off (a missing value is the default, on).
            .then(raw => setValues(Object.fromEntries(allKeys.map(k => [k, (CONFIRM_KEYS as readonly string[]).includes(k) ? parseBool(raw[k], true) : raw[k] === 'true']))))
            .catch(e => setError(typeof e === 'string' ? e : e?.message ?? 'Could not load permissions.'));
    };
    useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const set = async (key: string, next: boolean) => {
        setSavingKey(key);
        setError(null);
        // Shown at once; a failed write below is caught by re-reading the real stored value.
        setValues(prev => (prev ? { ...prev, [key]: next } : prev));
        try {
            await setSetting(key, next.toString());
            // Every screen in the app reads flags from this one context — this is what makes a
            // Read-only toggle (or any row here) take effect immediately, everywhere, not just
            // in this panel.
            await reload();
        } catch (e) {
            setError(typeof e === 'string' ? e : (e as Error)?.message ?? `Could not save "${key}".`);
            load();
        } finally {
            setSavingKey(null);
        }
    };

    if (values === null) {
        return error ? <ErrorBox>{error}</ErrorBox> : <p className="text-xs text-[#666666]">Loading permissions...</p>;
    }
    const readOnly = values.workspaceReadOnly;

    return (
        <div className="space-y-5">
            <label className="flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors bg-[#121212] border-[#303030] hover:border-[#404040]">
                <input
                    type="checkbox"
                    checked={readOnly}
                    disabled={isLocked('workspaceReadOnly') || savingKey === 'workspaceReadOnly'}
                    onChange={e => set('workspaceReadOnly', e.target.checked)}
                    className="mt-1 shrink-0 cursor-pointer"
                    title={isLocked('workspaceReadOnly') ? LOCKED_TITLE : undefined}
                />
                <span>
                    <span className="flex items-center gap-1.5 text-sm font-bold text-white">
                        <Shield className="w-3.5 h-3.5 text-gray-400" />
                        Set Workspace to Read-only
                    </span>
                    <span className="block text-[11px] text-[#aaaaaa] leading-relaxed mt-1 max-w-md">
                        Turns off every permission below, plus History Search. Switching it
                        off restores what each was set to.
                    </span>
                </span>
            </label>

            <div>
                <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Specific Permissions</h4>
                <div className="divide-y divide-[#232323] border border-[#232323] rounded-xl overflow-hidden">
                    {rows.map(({ key, label, hint }) => {
                        const locked = isLocked(key);
                        const disabled = locked || readOnly || savingKey === key;
                        return (
                            <label
                                key={key}
                                className={`flex items-start gap-3 px-4 py-3 bg-[#121212] transition-colors ${disabled ? 'opacity-50' : 'hover:bg-[#161616] cursor-pointer'}`}
                                title={locked ? LOCKED_TITLE : readOnly ? 'Overridden off by Read-only, above' : undefined}
                            >
                                <input
                                    type="checkbox"
                                    checked={values[key]}
                                    disabled={disabled}
                                    onChange={e => set(key, e.target.checked)}
                                    className="mt-0.5 shrink-0"
                                />
                                <span>
                                    <span className="block text-xs font-bold text-white">{label}</span>
                                    <span className="block text-[11px] text-[#888888] mt-0.5">{hint}</span>
                                </span>
                            </label>
                        );
                    })}
                    {CONFIRM_ROWS.map(({ key, label, hint, readOnlyTitle }) => {
                        const locked = isLocked(key);
                        const disabled = locked || readOnly || savingKey === key;
                        return (
                            <label
                                key={key}
                                className={`flex items-start gap-3 px-4 py-3 bg-[#121212] transition-colors ${disabled ? 'opacity-50' : 'hover:bg-[#161616] cursor-pointer'}`}
                                title={locked ? LOCKED_TITLE : readOnly ? readOnlyTitle : undefined}
                            >
                                <input
                                    type="checkbox"
                                    checked={values[key]}
                                    disabled={disabled}
                                    // Turning it on needs no question. Turning it off does: it's the safety net.
                                    onChange={e => (e.target.checked ? set(key, true) : setConfirmingOff(key))}
                                    className="mt-0.5 shrink-0"
                                />
                                <span>
                                    <span className="block text-xs font-bold text-white">{label}</span>
                                    <span className="block text-[11px] text-[#888888] mt-0.5">{hint}</span>
                                </span>
                            </label>
                        );
                    })}
                    {(() => {
                        const locked = isLocked(NO_ALIAS_KEY);
                        const disabled = locked || readOnly || savingKey === NO_ALIAS_KEY;
                        return (
                            <label
                                className={`flex items-start gap-3 px-4 py-3 bg-[#121212] transition-colors ${disabled ? 'opacity-50' : 'hover:bg-[#161616] cursor-pointer'}`}
                                title={locked ? LOCKED_TITLE : readOnly ? 'A read-only workspace never asks: A renamed channel just takes its new name' : undefined}
                            >
                                <input
                                    type="checkbox"
                                    checked={values[NO_ALIAS_KEY]}
                                    disabled={disabled}
                                    onChange={e => set(NO_ALIAS_KEY, e.target.checked)}
                                    className="mt-0.5 shrink-0"
                                />
                                <span>
                                    <span className="block text-xs font-bold text-white">Do Not Ask to Alias</span>
                                    <span className="block text-[11px] text-[#888888] mt-0.5">When a channel is renamed on YouTube, take its new name and say so, without asking whether to keep the old name as its alias. An alias it already has is left alone.</span>
                                </span>
                            </label>
                        );
                    })()}
                    {(() => {
                        const locked = isLocked(NO_NOTIFY_TITLE_CHANGE_KEY);
                        const disabled = locked || readOnly || savingKey === NO_NOTIFY_TITLE_CHANGE_KEY;
                        return (
                            <label
                                className={`flex items-start gap-3 px-4 py-3 bg-[#121212] transition-colors ${disabled ? 'opacity-50' : 'hover:bg-[#161616] cursor-pointer'}`}
                                title={locked ? LOCKED_TITLE : readOnly ? 'Read-only does not change this: it only hides the notification, the title still updates' : undefined}
                            >
                                <input
                                    type="checkbox"
                                    checked={values[NO_NOTIFY_TITLE_CHANGE_KEY]}
                                    disabled={disabled}
                                    onChange={e => set(NO_NOTIFY_TITLE_CHANGE_KEY, e.target.checked)}
                                    className="mt-0.5 shrink-0"
                                />
                                <span>
                                    <span className="block text-xs font-bold text-white">Do Not Notify of Video Title Change</span>
                                    <span className="block text-[11px] text-[#888888] mt-0.5">When a saved video's title has changed on YouTube, silently accept the new title without showing the "Video Title Renamed" modal.</span>
                                </span>
                            </label>
                        );
                    })()}
                </div>
            </div>

            {error && <ErrorBox>{error}</ErrorBox>}

            {confirmingOff && (
                <ConfirmDialog
                    title="Confirm Action"
                    message={CONFIRM_ROWS.find(r => r.key === confirmingOff)?.warning}
                    confirmLabel="Proceed"
                    onConfirm={() => { const key = confirmingOff; setConfirmingOff(null); void set(key, false); }}
                    onCancel={() => setConfirmingOff(null)}
                />
            )}
        </div>
    );
}
