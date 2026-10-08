import type { ReactNode } from 'react';
import { Modal } from './Modal';
import { SecondaryButton } from './ui/Button';

/** Asked when an edit with unsaved changes is about to be closed (backdrop click, Esc, the X):
 *  Cancel goes back to editing, Discard drops the draft, Save saves it first. */
export function UnsavedChangesModal({ message, saving = false, onCancel, onDiscard, onSave }: {
    message: ReactNode;
    saving?: boolean;
    onCancel: () => void;
    onDiscard: () => void;
    onSave: () => void;
}) {
    return (
        <Modal onClose={onCancel} title="Unsaved Changes" layer="top" size="sm" footer={
            <>
                <SecondaryButton
                    onClick={onCancel}
                >
                    Cancel
                </SecondaryButton>
                <button
                    onClick={onDiscard}
                    className="px-4 py-2 rounded-lg bg-[#222222] border border-[#383838] hover:bg-red-900/40 hover:border-red-800 cursor-pointer text-white text-sm font-semibold transition-colors"
                >
                    Discard
                </button>
                <button
                    onClick={onSave}
                    disabled={saving}
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 cursor-pointer text-white text-sm font-semibold transition-colors"
                >
                    {saving ? "Saving..." : "Save"}
                </button>
            </>
        }>
            <p className="text-[#aaaaaa] leading-relaxed">{message}</p>
        </Modal>
    );
}
