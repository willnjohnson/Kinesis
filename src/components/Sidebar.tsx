import { X, Trash2, Save } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { checkVideoExists } from '../api';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    transcript: string;
    loading: boolean;
    title: string;
    videoId?: string;
    onSave?: () => void;
    onDelete?: () => void;
}

export function Sidebar({ isOpen, onClose, transcript, loading, title, videoId, onSave, onDelete }: Props) {
    const [copied, setCopied] = useState(false);
    const [existsInDb, setExistsInDb] = useState(false);
    const [checkingDb, setCheckingDb] = useState(false);

    useEffect(() => {
        if (videoId && isOpen) {
            setCheckingDb(true);
            checkVideoExists(videoId).then(exists => {
                setExistsInDb(exists);
                setCheckingDb(false);
            });
        }
    }, [videoId, isOpen]);

    const handleCopy = useCallback(() => {
        if (!transcript) return;
        navigator.clipboard.writeText(transcript);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [transcript]);

    return (
        <>
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/70 z-40 transition-opacity"
                    onClick={onClose}
                />
            )}

            <div className={`fixed inset-y-0 right-0 w-[450px] max-w-full bg-[#0a0a0a] border-l border-gray-900 transform transition-transform duration-300 ease-in-out z-50 shadow-2xl ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="h-full flex flex-col">
                    <div className="p-8 border-b border-gray-900 flex justify-between items-start bg-gray-900/10">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Transcript</span>
                            <h2 className="text-sm font-semibold text-white pr-8 line-clamp-2 leading-relaxed">
                                {title || "Untitled"}
                            </h2>
                        </div>
                        <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors cursor-pointer p-1">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-8 text-gray-400 text-sm leading-relaxed whitespace-pre-wrap font-sans selection:bg-gray-800">
                        {loading ? (
                            <div className="flex flex-col justify-start items-center h-40 pt-10 text-gray-600">
                                <svg className="w-8 h-8 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="12" cy="3" r="1.5" fill="currentColor" opacity="0.1" />
                                    <circle cx="18.36" cy="5.64" r="1.5" fill="currentColor" opacity="0.2" />
                                    <circle cx="21" cy="12" r="1.5" fill="currentColor" opacity="0.3" />
                                    <circle cx="18.36" cy="18.36" r="1.5" fill="currentColor" opacity="0.4" />
                                    <circle cx="12" cy="21" r="1.5" fill="currentColor" opacity="0.6" />
                                    <circle cx="5.64" cy="18.36" r="1.5" fill="currentColor" opacity="0.8" />
                                    <circle cx="3" cy="12" r="1.5" fill="currentColor" opacity="1" />
                                    <circle cx="5.64" cy="5.64" r="1.5" fill="currentColor" opacity="0.1" />
                                </svg>
                                <p className="text-[10px] uppercase tracking-[0.2em] font-bold mt-4">Analysing segments</p>
                            </div>
                        ) : (
                            transcript ? (
                                <div className="text-gray-300 leading-relaxed">
                                    {transcript}
                                </div>
                            ) : (
                                <div className="text-center text-gray-600 mt-10">
                                    <p className="text-xs uppercase tracking-widest font-bold">No transcript data available.</p>
                                </div>
                            )
                        )}
                    </div>

                    <div className="p-8 border-t border-gray-900 flex gap-4">
                        <button
                            onClick={handleCopy}
                            disabled={loading || !transcript}
                            className="flex-1 bg-gray-900 border border-gray-800 text-gray-400 hover:text-white hover:border-gray-600 py-3 rounded-lg transition-all font-bold uppercase text-[10px] tracking-[0.2em] disabled:opacity-20 cursor-pointer"
                        >
                            {copied ? "Copied Transcript" : "Copy Transcript"}
                        </button>

                        {existsInDb && onDelete ? (
                            <button
                                onClick={onDelete}
                                disabled={loading || !transcript || checkingDb}
                                className="flex-1 bg-red-900/20 border border-red-900/30 text-red-400 hover:text-red-300 hover:border-red-500/50 py-3 rounded-lg transition-all font-bold uppercase text-[10px] tracking-[0.2em] disabled:opacity-20 cursor-pointer flex items-center justify-center gap-2"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete from library
                            </button>
                        ) : (
                            <button
                                onClick={onSave}
                                disabled={loading || !transcript || checkingDb}
                                className="flex-1 bg-red-900/20 border border-red-900/30 text-red-400 hover:text-red-300 hover:border-red-500/50 py-3 rounded-lg transition-all font-bold uppercase text-[10px] tracking-[0.2em] disabled:opacity-20 cursor-pointer flex items-center justify-center gap-2"
                            >
                                <Save className="w-3.5 h-3.5" />
                                Save to library
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
