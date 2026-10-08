import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { saveGlossaryTerm } from '../api';
import { handlePlainContextMenu } from '../lib/markdown-editor';
import { Modal } from './Modal';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import { SecondaryButton } from './ui/Button';

interface Props {
    onClose: () => void;
    onCreated: (tag: string) => void;
}

export function AddQuickTagModal({ onClose, onCreated }: Props) {
    const [tag, setTag] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [confirmClose, setConfirmClose] = useState(false);

    const save = async () => {
        const name = tag.trim();
        if (!name) return;
        try {
            await saveGlossaryTerm(null, name, '', []);
            onCreated(name);
        } catch (err) {
            setError(String(err));
        }
    };

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        await save();
    };

    return (
        <>
        {confirmClose && (
            <UnsavedChangesModal
                message="You have an unsaved tag. Save it before closing?"
                onCancel={() => setConfirmClose(false)}
                onDiscard={onClose}
                onSave={() => { setConfirmClose(false); void save(); }}
            />
        )}
        <Modal
            // Backdrop click, Esc and the X ask first once something's typed; Cancel discards on purpose.
            onClose={() => { if (tag.trim()) setConfirmClose(true); else onClose(); }}
            icon={Plus}
            title="Add Tag"
            onSubmit={handleSubmit}
            bodyClassName="p-6 space-y-6"
            footer={
                <>
                    <SecondaryButton
                        onClick={onClose}
                    >
                        Cancel
                    </SecondaryButton>
                    <button
                        type="submit"
                        className="px-6 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-all text-sm font-bold cursor-pointer"
                    >
                        Save Tag
                    </button>
                </>
            }
        >
            <div>
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Tag Name</label>
                <input
                    type="text"
                    autoFocus
                    required
                    value={tag}
                    onChange={event => setTag(event.target.value)}
                    onContextMenu={handlePlainContextMenu}
                    className="w-full bg-[#121212] border border-[#333] text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-red-600 transition-all placeholder-gray-600"
                    placeholder="Enter term..."
                />
            </div>
            {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</div>}
        </Modal>
        </>
    );
}