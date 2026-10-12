import { useState } from 'react';
import { BookA } from 'lucide-react';
import { saveGlossaryTerm } from '../api';
import { useWorkspace } from '../hooks/useWorkspace';
import { buildLink } from '../lib/internal-links';
import { handleMarkdownContextMenu, handleMarkdownKeyDown, handlePlainContextMenu } from '../lib/markdown-editor';
import { Modal } from './Modal';
import { SecondaryButton } from './ui/Button';
import { driveLabel } from './DriveTreeList';

/** Asked for by the note editor's right-click (lib/markdown-editor.ts's 'makeTerm'): the text selected, and where. */
export const MAKE_TERM_EVENT = 'kinesis:make-term';
export interface MakeTermRequest {
    textarea: HTMLTextAreaElement;
    start: number;
    end: number;
}

/** A few words on one line read as a term's name; anything longer reads as what a term means. */
const looksLikeAName = (text: string) => !text.includes('\n') && text.length <= 60;

/**
 * Makes a Glossary term out of what's selected in a note, without leaving the note. A short selection is taken as the
 * term's name (its definition is then written here), a longer one as its definition (the name is then typed). The term
 * is filed under the note's Drives. Once it's saved, a selection that was the name becomes a link to the term, so the
 * note points at what it just defined.
 */
export function MakeTermModal({ request, drives, onClose, onMade }: {
    request: MakeTermRequest;
    /** The note's Drives: where the term is filed. */
    drives: string[];
    onClose: () => void;
    onMade: (term: string) => void;
}) {
    const { labels } = useWorkspace();
    const selected = request.textarea.value.substring(request.start, request.end).trim();
    const asName = looksLikeAName(selected);
    const [term, setTerm] = useState(asName ? selected : '');
    const [definition, setDefinition] = useState(asName ? '' : selected);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const save = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const name = term.trim();
        if (!name || !definition.trim()) return;
        setSaving(true);
        try {
            await saveGlossaryTerm(null, name, definition.trim(), drives);
            if (asName) {
                // The words selected become the link (typed in as the editor's other commands do, so undo takes it back).
                const { textarea, start, end } = request;
                const link = buildLink(textarea.value.substring(start, end), 'glossary', name);
                textarea.focus();
                textarea.setSelectionRange(start, end);
                document.execCommand('insertText', false, link);
            }
            onMade(name);
        } catch (err) {
            setError(typeof err === 'string' ? err : (err as Error)?.message ?? "Couldn't save the term.");
        } finally {
            setSaving(false);
        }
    };

    const field = 'block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2';
    const box = 'w-full bg-[#121212] border border-[#333] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-600 transition-all placeholder-gray-600';
    return (
        <Modal
            onClose={onClose}
            icon={BookA}
            title={`New ${labels.aliasGlossary} Term`}
            subtitle={drives.length > 0 ? `Filed under ${drives.map(driveLabel).join(', ')}, like the note` : 'Not filed under a Drive, like the note'}
            size="lg"
            onSubmit={save}
            bodyClassName="p-6 space-y-5"
            footer={
                <>
                    <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
                    <button type="submit" disabled={saving || !term.trim() || !definition.trim()} className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all text-sm font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                        {saving ? 'Saving...' : 'Add Term'}
                    </button>
                </>
            }
        >
            <div>
                <label className={field}>Term</label>
                <input autoFocus={!asName} value={term} onChange={e => setTerm(e.target.value)} onContextMenu={handlePlainContextMenu} maxLength={120} placeholder="Its name" className={box} />
            </div>
            <div>
                <label className={field}>Definition</label>
                <textarea
                    autoFocus={asName}
                    value={definition}
                    onChange={e => setDefinition(e.target.value)}
                    onKeyDown={e => handleMarkdownKeyDown(e)}
                    onContextMenu={handleMarkdownContextMenu}
                    rows={6}
                    placeholder="What it means. Markdown works."
                    className={`${box} resize-y leading-relaxed`}
                />
                {asName && <p className="text-[11px] text-gray-500 mt-1.5">Once it's added, the words you selected in the note become a link to it.</p>}
            </div>
            {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
        </Modal>
    );
}
