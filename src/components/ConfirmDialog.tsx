import type { ReactNode } from "react";
import { Modal } from "./Modal";
import { SecondaryButton } from './ui/Button';

interface ConfirmDialogProps {
    /** Plain text, or markup to bold parts of it. Line breaks in it are kept. */
    message: ReactNode;
    onConfirm: () => void;
    onCancel: () => void;
    /** The confirm button's text; "Delete" unless the action is something else (e.g. "Remove"). */
    confirmLabel?: string;
    /** The heading; a generic "Please Confirm" unless the caller says what is being confirmed. */
    title?: string;
}

export function ConfirmDialog({ message, onConfirm, onCancel, confirmLabel = "Delete", title = "Please Confirm" }: ConfirmDialogProps) {
    return (
        <Modal
            onClose={onCancel}
            title={title}
            layer="top"
            footer={
                <>
                    <SecondaryButton
                        onClick={onCancel}
                    >
                        Cancel
                    </SecondaryButton>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 cursor-pointer text-white text-sm font-semibold transition-colors"
                    >
                        {confirmLabel}
                    </button>
                </>
            }
        >
            {/* Line breaks in a message are kept, and a long unbroken word (a web address) wraps instead of overflowing. */}
            <p className="text-[#aaaaaa] leading-relaxed whitespace-pre-line break-words">{message}</p>
        </Modal>
    );
}
