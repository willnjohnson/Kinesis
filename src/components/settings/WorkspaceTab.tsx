import { useEffect, useState } from "react";
import { ArrowLeftRight, ChevronDown, ChevronRight, FolderOpen } from "lucide-react";
import { getWorkspaceStatus, revealWorkspace, setWorkspaceLabel, type WorkspaceStatus } from "../../api";
import { WorkspaceLauncher } from "../workspace/WorkspaceLauncher";
import { ErrorBox } from "../workspace/shared";
import { errText } from "../workspace/helpers";
import { settingsSecondaryBtn } from "./buttons";
import { useFlags } from "../../hooks/useFlags";
import { useWorkspace } from "../../hooks/useWorkspace";
import { checkLabel, LABEL_DEFS, type LabelKey } from "../../lib/workspace";
import { PermissionsPanel } from "./PermissionsPanel";

interface FieldProps {
    labelKey: LabelKey;
    title: string;
    hint: string;
    max: number;
    defaultValue: string;
    value: string;
    disabled?: boolean;
    disabledNote?: string;
    onSaved: () => Promise<void>;
}

/** Editing one name: what's typed, why it can't be saved (if it can't), and saving it. Saving an empty box goes back to
 *  the default. Shared by the workspace name's field and the section names' rows. */
function useLabelDraft(labelKey: LabelKey, max: number, defaultValue: string, value: string, onSaved: () => Promise<void>) {
    const [draft, setDraft] = useState(value);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    // Follow the stored value when it changes underneath (a reload, a sync).
    useEffect(() => { setDraft(value); setError(null); }, [value]);

    const commit = async () => {
        const checked = checkLabel(draft, max);
        if (checked.error) { setError(checked.error); return; }
        // checkLabel's own invariant already guarantees this (error is null only alongside a real value), but the
        // check itself doesn't narrow the type here, so this backstops it plainly for TypeScript's sake too.
        if (checked.value == null) return;
        if ((checked.value || defaultValue) === value) { setDraft(value); setError(null); return; }
        setSaving(true);
        try {
            await setWorkspaceLabel(labelKey, checked.value);
            setError(null);
            await onSaved();
        } catch (e: any) {
            setError(typeof e === 'string' ? e : e?.message ?? 'Could not save.');
        } finally {
            setSaving(false);
        }
    };

    return {
        draft,
        change: (next: string) => { setDraft(next); setError(null); },
        error,
        saving,
        // Unsaved edits: what's typed differs from what's stored (an empty box means the default).
        dirty: (draft.trim() || defaultValue) !== value,
        commit,
    };
}

/** The workspace's own name: a full-width field with its hint underneath. */
function LabelField({ labelKey, title, hint, max, defaultValue, value, disabled, disabledNote, onSaved }: FieldProps) {
    const { draft, change, error, saving, dirty, commit } = useLabelDraft(labelKey, max, defaultValue, value, onSaved);
    const setDraft = change;
    return (
        <div>
            <div className="flex items-baseline justify-between mb-1.5">
                <label className="text-[10px] uppercase font-bold text-[#aaaaaa] tracking-widest">{title}</label>
                <span className="text-[10px] text-[#666666]">{draft.length}/{max}</span>
            </div>
            <div className="flex gap-2">
                <input
                    value={draft}
                    maxLength={max}
                    disabled={disabled || saving}
                    placeholder={defaultValue}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void commit(); }}
                    className="flex-1 min-w-0 bg-[#121212] border border-[#303030] rounded-lg px-3 py-2 text-[11px] text-white outline-none focus:border-[#555555] disabled:opacity-50"
                />
                {!disabled && (
                    <button
                        type="button"
                        disabled={saving || !dirty}
                        onClick={() => void commit()}
                        className={settingsSecondaryBtn}
                    >
                        Save
                    </button>
                )}
            </div>
            {error ? (
                <p className="text-[11px] text-red-400 mt-1">{error}</p>
            ) : (
                <p className="text-[11px] text-[#666666] mt-1">{disabled && disabledNote ? disabledNote : hint}</p>
            )}
        </div>
    );
}

/** One section name as a compact row: its name (with the hint as its tooltip), the box, and Save. A sub-name (one of a
 *  section's extra names, like Drive's "Link") is indented under its section's row. */
function NameRow({ labelKey, title, hint, max, defaultValue, value, sub, onSaved }: {
    labelKey: LabelKey;
    title: string;
    hint: string;
    max: number;
    defaultValue: string;
    value: string;
    sub: boolean;
    onSaved: () => Promise<void>;
}) {
    const { draft, change, error, saving, dirty, commit } = useLabelDraft(labelKey, max, defaultValue, value, onSaved);
    return (
        <div>
            <div className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-2">
                <label
                    className={sub ? 'pl-3 text-[11px] font-semibold text-[#888888] truncate' : 'text-[10px] uppercase font-bold text-[#aaaaaa] tracking-widest truncate'}
                    title={hint}
                >
                    {title}
                </label>
                <input
                    value={draft}
                    maxLength={max}
                    disabled={saving}
                    placeholder={defaultValue}
                    aria-label={title}
                    onChange={e => change(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void commit(); }}
                    className="min-w-0 bg-[#121212] border border-[#303030] rounded-lg px-3 py-1.5 text-[11px] text-white outline-none focus:border-[#555555] disabled:opacity-50"
                />
                <button type="button" disabled={saving || !dirty} onClick={() => void commit()} className={settingsSecondaryBtn}>
                    Save
                </button>
            </div>
            {error && <p className="text-[11px] text-red-400 mt-1 ml-[8rem]">{error}</p>}
        </div>
    );
}

// The section names, in navigation order: each section's own name, then any extra names that belong to it (shown indented,
// under the short title given here).
const NAME_GROUPS: { key: LabelKey; subs?: { key: LabelKey; title: string }[] }[] = [
    { key: 'aliasSearch' },
    { key: 'aliasLibrary' },
    { key: 'aliasGlossary' },
    { key: 'aliasBiography', subs: [{ key: 'aliasBiographyItem', title: 'One entry' }] },
    { key: 'aliasCalendar' },
    {
        key: 'aliasDriveName',
        subs: [
            { key: 'aliasDriveLink', title: 'Link' },
            { key: 'aliasDriveSymlink', title: 'Symlink' },
            { key: 'aliasSequence', title: 'Sequence' },
        ],
    },
];

/** A collapsible part of this tab, its one-line description under the heading. */
function Collapsible({ title, description, open, onToggle, children }: { title: string; description: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
    return (
        <div>
            <button type="button" onClick={onToggle} className="flex items-center gap-1.5 text-sm font-bold text-white cursor-pointer">
                {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                {title}
            </button>
            <p className="text-[11px] text-[#666666] mt-1">{description}</p>
            {open && <div className="mt-4">{children}</div>}
        </div>
    );
}

export function WorkspaceTab() {
    const { flags } = useFlags();
    const { labels, reload } = useWorkspace();
    const [namesOpen, setNamesOpen] = useState(false);
    const [permissionsOpen, setPermissionsOpen] = useState(false);
    const [status, setStatus] = useState<WorkspaceStatus | null>(null);
    const [launcherOpen, setLauncherOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-read when the name changes: renaming the workspace renames its folder too.
    useEffect(() => {
        getWorkspaceStatus().then(setStatus).catch(e => setError(errText(e)));
    }, [labels.workspaceName]);

    const nameDef = LABEL_DEFS[0];
    const defOf = (key: LabelKey) => LABEL_DEFS.find(d => d.key === key)!;
    const nameRow = (key: LabelKey, title: string, sub: boolean) => {
        const def = defOf(key);
        return (
            <NameRow
                key={key}
                labelKey={key}
                title={title}
                hint={def.hint}
                max={def.max}
                defaultValue={def.default}
                value={labels[key]}
                sub={sub}
                onSaved={reload}
            />
        );
    };
    // Renaming can be switched off, but a workspace that was never named can always be named once.
    const nameLocked = !flags.allowWorkspaceRename && labels.workspaceName !== nameDef.default;

    return (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <div>
                <h3 className="text-base font-bold mb-3">Workspace</h3>
                <LabelField
                    labelKey={nameDef.key}
                    title={nameDef.title}
                    hint="Also the name of the workspace's folder, and used in export names, e.g. My_Research. Letters, numbers and spaces. Leave it empty and save to go back to the default."
                    max={nameDef.max}
                    defaultValue={nameDef.default}
                    value={labels.workspaceName}
                    disabled={nameLocked}
                    disabledNote="The name of this workspace has been locked."
                    onSaved={reload}
                />
                <div className="flex gap-2 mt-4">
                    {flags.allowChangeDbLocation && (
                        <button onClick={() => status && setLauncherOpen(true)} disabled={!status} className={settingsSecondaryBtn}>
                            <ArrowLeftRight className="w-3.5 h-3.5" />
                            Switch workspace
                        </button>
                    )}
                    {status?.current && (
                        <button onClick={() => revealWorkspace(status.current!.folder).catch(e => setError(errText(e)))} className={settingsSecondaryBtn}>
                            <FolderOpen className="w-3.5 h-3.5" />
                            Show folder
                        </button>
                    )}
                </div>
                {status?.current && <p className="text-[11px] text-[#666666] mt-2 break-all select-all">{status.current.path}</p>}
                {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
            </div>

            {/* Two separate things, so two sections: what the parts of the app are called, and what this workspace
                allows. Every name is in one list (most sections have just one), rather than a tab per section. */}
            {flags.showWorkspaceAdvanced && (
                <>
                    <Collapsible
                        title="Section Names"
                        description="Rename sections to fit your workspace. Up to 18 characters: letters, numbers and spaces. Leave one empty and save to go back to its default."
                        open={namesOpen}
                        onToggle={() => setNamesOpen(o => !o)}
                    >
                        <div className="space-y-2">
                            {NAME_GROUPS.map(group => (
                                <div key={group.key} className="space-y-2">
                                    {nameRow(group.key, defOf(group.key).title, false)}
                                    {group.subs?.map(s => nameRow(s.key, s.title, true))}
                                </div>
                            ))}
                        </div>
                    </Collapsible>
                    <Collapsible
                        title="Permissions"
                        description="Turn specific editing permissions on or off for this workspace."
                        open={permissionsOpen}
                        onToggle={() => setPermissionsOpen(o => !o)}
                    >
                        <PermissionsPanel />
                    </Collapsible>
                </>
            )}

            {launcherOpen && status && <WorkspaceLauncher status={status} onClose={() => setLauncherOpen(false)} />}
        </div>
    );
}
