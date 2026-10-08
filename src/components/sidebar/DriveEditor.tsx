import { Check, Pencil, Plus, X } from 'lucide-react';
import { decodeWdbs } from '../../api';
import { useWorkspace } from '../../hooks/useWorkspace';
import { DriveComboBox } from '../DriveComboBox';
import type { VideoDrives } from './useVideoDrives';

// Styled to match the Glossary's Add Term modal (labeled fields, rounded-xl bg-[#121212] inputs,
// px-4 py-3 text-sm) rather than the compact popover this used to be — it lives in a full modal
// now (SequenceDock.tsx), so it should read like one, not like a cramped anchored dropdown.
const driveFieldClass = "flex-1 min-w-0 bg-[#121212] border border-[#333] text-white rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-red-600 transition-all placeholder-gray-600 disabled:opacity-50";
const driveIconButtonClass = "p-2.5 rounded-lg hover:bg-[#272727] transition-colors cursor-pointer disabled:opacity-50 shrink-0";
const driveActionButtonClass = "flex items-center gap-1.5 shrink-0 text-xs font-bold text-gray-300 hover:text-white bg-[#272727] hover:bg-[#3f3f3f] px-3 py-2.5 rounded-lg transition-colors cursor-pointer";

/**
 * What the pencil in the sequence bar opens: the video's home Drive and its "Also in" links (the
 * "Also in" links let it additionally show up under other Drives (see components/WdbsTreePanel.tsx)
 * without touching its home). Viewing and choosing between them is the bar's Drive dropdown.
 * Its state and saving are useVideoDrives.ts's.
 */
export function DriveEditor({ drives: d, allowEdit }: { drives: VideoDrives; allowEdit: boolean }) {
    const { labels } = useWorkspace();
    const cancelPrimary = () => { d.setIsEditingWdbs(false); d.setWdbsInput(decodeWdbs(d.primaryWdbs)); d.setWdbsError(null); };
    const cancelLink = () => { d.setIsAddingLink(false); d.setLinkInput(''); d.setLinkError(null); };
    return (
        <div className="space-y-6">
            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Primary {labels.aliasDriveLink}</label>
                {d.isEditingWdbs ? (
                    <div className="flex items-center gap-2">
                        <DriveComboBox
                            autoFocus
                            value={d.wdbsInput}
                            onValueChange={d.setWdbsInput}
                            suggestions={d.wdbsSuggestions}
                            suggestedDrives={d.channelSuggestedDrives}
                            onEnter={d.handleSaveWdbs}
                            onEscape={cancelPrimary}
                            placeholder=":CS-ML-REINF"
                            disabled={d.savingWdbs}
                            className={driveFieldClass}
                        />
                        <button onClick={d.handleSaveWdbs} disabled={d.savingWdbs} title="Save" className={`${driveIconButtonClass} text-green-500`}>
                            <Check className="w-4 h-4" />
                        </button>
                        <button
                            onClick={cancelPrimary}
                            disabled={d.savingWdbs}
                            title="Cancel"
                            className={`${driveIconButtonClass} text-gray-400 hover:text-white`}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                ) : (
                    <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0 bg-[#121212] border border-[#333] rounded-xl px-4 py-3">
                            <span
                                className="block text-white font-mono text-sm truncate"
                                title={d.hasPrimaryWdbs ? (d.wdbsAliases[d.primaryWdbs!] ?? decodeWdbs(d.primaryWdbs)) : undefined}
                            >
                                {decodeWdbs(d.primaryWdbs) || "N/A"}
                            </span>
                        </div>
                        {allowEdit && (
                            <button onClick={() => d.setIsEditingWdbs(true)} className={driveActionButtonClass}>
                                <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                        )}
                    </div>
                )}
                {d.wdbsError && (
                    <div className="mt-2 text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">
                        {d.wdbsError}
                    </div>
                )}
            </div>

            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Also In</label>
                {/* No links possible until a Primary Drive is set — explained rather than just left blank. */}
                {!d.hasPrimaryWdbs ? (
                    <p className="text-xs text-[#666666] italic">Set a Primary {labels.aliasDriveLink} first to link this video into others too.</p>
                ) : (
                    <div className="space-y-3">
                        {/* Compact chips — this is a list of what's already linked, not something that
                            needs the input fields' full size. */}
                        {(d.wdbsLinks.length > 0 || (allowEdit && !d.isAddingLink)) && (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {d.wdbsLinks.map(link => (
                                    <span
                                        key={link}
                                        className="flex items-center gap-1.5 bg-[#1a1a1a] border border-[#333] rounded-md pl-2.5 pr-1.5 py-1 text-xs text-white font-mono"
                                        title={d.wdbsAliases[link] ?? decodeWdbs(link)}
                                    >
                                        {decodeWdbs(link)}
                                        {allowEdit && (
                                            <button
                                                onClick={() => d.handleRemoveLink(link)}
                                                title={`Remove ${labels.aliasDriveSymlink.toLowerCase()}`}
                                                className="text-gray-500 hover:text-red-400 transition-colors cursor-pointer"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        )}
                                    </span>
                                ))}
                                {allowEdit && !d.isAddingLink && (
                                    // Sized like the chips beside it (same padding/text size), not the bigger
                                    // field-row buttons — it's another item in this same list of tags.
                                    <button
                                        onClick={() => d.setIsAddingLink(true)}
                                        className="flex items-center gap-1 bg-[#1a1a1a] border border-[#333] hover:border-[#444] rounded-md pl-2 pr-2.5 py-1 text-xs text-gray-400 hover:text-white font-mono transition-colors cursor-pointer"
                                    >
                                        <Plus className="w-3 h-3" /> {labels.aliasDriveSymlink}
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Its own full-width row, not squeezed in next to the chips: a Drive path can be
                            long, and typing it should stay readable rather than scrolling inside a narrow box. */}
                        {allowEdit && d.isAddingLink && (
                            <div className="flex items-center gap-2">
                                <DriveComboBox
                                    autoFocus
                                    value={d.linkInput}
                                    onValueChange={d.setLinkInput}
                                    suggestions={d.wdbsSuggestions}
                                    suggestedDrives={d.channelSuggestedDrives}
                                    onEnter={d.handleAddLink}
                                    onEscape={cancelLink}
                                    placeholder=":CS-ML-REINF"
                                    disabled={d.savingLink}
                                    className={driveFieldClass}
                                />
                                <button onClick={d.handleAddLink} disabled={d.savingLink || !d.linkInput.trim()} title={`Add ${labels.aliasDriveSymlink.toLowerCase()}`} className={`${driveIconButtonClass} text-green-500`}>
                                    <Check className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={cancelLink}
                                    disabled={d.savingLink}
                                    title="Cancel"
                                    className={`${driveIconButtonClass} text-gray-400 hover:text-white`}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </div>
                )}
                {d.linkError && (
                    <div className="mt-2 text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">
                        {d.linkError}
                    </div>
                )}
            </div>
        </div>
    );
}
