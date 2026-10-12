import { useEffect, useMemo, useState } from 'react';
import { Lock, NotebookPen, Plus, Users } from 'lucide-react';
import { listNotes, type Note } from '../api';
import { useWorkspace } from '../hooks/useWorkspace';
import { handlePlainContextMenu } from '../lib/markdown-editor';
import { noteDisplayTitle, noteSnippet } from '../lib/notes';
import { normalizeText } from '../lib/utils';
import { Modal } from './Modal';

/**
 * "Cite in Note...": which note a citation goes into, looked up by name or by what it says. Only notes this reader can
 * write in are offered (personal ones always; shared ones when the workspace allows editing them). "New note" starts
 * one for it.
 */
export function NotePicker({ canEditShared, onPick, onNew, onClose }: {
    canEditShared: boolean;
    onPick: (note: Note) => void;
    onNew: () => void;
    onClose: () => void;
}) {
    const { labels } = useWorkspace();
    const [notes, setNotes] = useState<Note[] | null>(null);
    const [query, setQuery] = useState('');
    useEffect(() => { listNotes().then(setNotes).catch(() => setNotes([])); }, []);
    const shown = useMemo(() => {
        const q = normalizeText(query.trim());
        return (notes ?? [])
            .filter(n => !n.shared || canEditShared)
            .filter(n => !q || normalizeText(`${n.title}\n${n.body}`).includes(q));
    }, [notes, query, canEditShared]);

    return (
        <Modal onClose={onClose} icon={NotebookPen} title="Cite in Note" subtitle="It goes at the end of the note you pick." layer="top" bodyClassName="p-4 space-y-3">
            <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                onContextMenu={handlePlainContextMenu}
                onKeyDown={e => { if (e.key === 'Enter' && shown[0]) onPick(shown[0]); }}
                placeholder={`Find a note in ${labels.aliasNotes}…`}
                className="w-full bg-[#121212] border border-[#333] focus:border-[var(--k-accent)] outline-none rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600"
            />
            <div className="max-h-80 overflow-y-auto custom-scrollbar rounded-lg border border-[#272727] bg-[#121212] p-1">
                <button
                    type="button"
                    onClick={onNew}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm text-gray-200 hover:bg-[#1e1e1e] cursor-pointer"
                >
                    <Plus className="w-4 h-4 text-gray-500" /> New note
                </button>
                {notes === null ? (
                    <p className="px-3 py-2 text-xs text-gray-500">Loading…</p>
                ) : shown.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-500">{notes.length === 0 ? 'No notes yet.' : 'No notes match.'}</p>
                ) : shown.map(n => {
                    const Mark = n.shared ? Users : Lock;
                    return (
                        <button
                            key={n.id}
                            type="button"
                            onClick={() => onPick(n)}
                            className="w-full px-3 py-2 rounded-md text-left hover:bg-[#1e1e1e] cursor-pointer"
                        >
                            <span className="flex items-center gap-1.5 min-w-0">
                                <span className="truncate text-sm font-semibold text-gray-100">{noteDisplayTitle(n)}</span>
                                <Mark className="w-3 h-3 shrink-0 text-gray-500" />
                            </span>
                            {noteSnippet(n) && <span className="block truncate text-[12px] text-gray-500">{noteSnippet(n)}</span>}
                        </button>
                    );
                })}
            </div>
        </Modal>
    );
}
