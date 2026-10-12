import { useEffect, useRef } from 'react';
import { ChevronDown, NotebookPen, Play } from 'lucide-react';
import { handlePlainContextMenu } from '../../lib/markdown-editor';
import { formatClock } from '../../lib/remark-timestamps';

/**
 * "Cite Moment": the box under the player, shown while the video waits, for writing the thought this moment brought up.
 * Adding it puts the moment's link and the thought at the end of the note named here (the active note, or a new one;
 * clicking the name picks another); with nothing written, the link alone goes in. Ctrl+Enter adds, Esc cancels.
 */
export function MomentComposer({ at, noteName, thought, onThought, onChangeNote, onAdd, onCancel }: {
    at: number;
    /** The note it goes into; null when it starts a new one. */
    noteName: string | null;
    /** What's written so far: the caller's, since it's what would be lost on leaving. */
    thought: string;
    onThought: (thought: string) => void;
    /** Asks which note instead (the caller opens the picker). */
    onChangeNote: () => void;
    onAdd: () => void;
    /** Cancel or Esc (the caller asks first when something is written). */
    onCancel: () => void;
}) {
    // Back to the writing once another note is picked.
    const boxRef = useRef<HTMLTextAreaElement>(null);
    useEffect(() => { boxRef.current?.focus(); }, [noteName]);
    return (
        <div className="mt-2 rounded-lg border border-[#333] bg-[#151515] p-2.5 space-y-2">
            <div className="flex items-center gap-2 min-w-0 text-[11px] text-gray-400">
                <NotebookPen className="w-3.5 h-3.5 shrink-0 text-[var(--k-accent)]" />
                <button
                    type="button"
                    onClick={onChangeNote}
                    title="Choose another note"
                    className="group min-w-0 flex items-center gap-1 rounded px-1 -mx-1 hover:bg-white/5 hover:text-white cursor-pointer"
                >
                    <span className="truncate">{noteName ? <>Adding to <span className="text-gray-200">"{noteName}"</span></> : 'Starting a new note'}</span>
                    <ChevronDown className="w-3 h-3 shrink-0 text-gray-500 group-hover:text-white" />
                </button>
                <span className="ml-auto shrink-0 inline-flex items-center gap-1 rounded px-1.5 py-px font-semibold tabular-nums bg-[var(--k-accent)]/15 text-[var(--k-accent)]">
                    <Play className="w-2.5 h-2.5 fill-current" />{formatClock(Math.floor(at))}
                </span>
            </div>
            <textarea
                ref={boxRef}
                autoFocus
                rows={3}
                value={thought}
                onChange={e => onThought(e.target.value)}
                onContextMenu={handlePlainContextMenu}
                onKeyDown={e => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onAdd(); }
                    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
                }}
                placeholder="What did this moment make you think?"
                className="w-full resize-y bg-[#121212] border border-[#333] focus:border-[var(--k-accent)] outline-none rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 custom-scrollbar"
            />
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-gray-600">Ctrl+Enter to add · Esc to cancel</span>
                <button type="button" onClick={onCancel} className="ml-auto px-3 py-1.5 rounded-md text-[11px] font-bold text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer">
                    Cancel
                </button>
                <button type="button" onClick={onAdd} className="px-3 py-1.5 rounded-md text-[11px] font-bold text-white bg-[var(--k-accent)] hover:brightness-110 cursor-pointer">
                    Add to Note
                </button>
            </div>
        </div>
    );
}
