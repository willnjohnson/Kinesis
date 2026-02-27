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
    onRefetch?: () => void;
    hasApiKey: boolean;
}

export function Sidebar({ isOpen, onClose, transcript, loading, title, videoId, onSave, onDelete, onRefetch, hasApiKey }: Props) {
    const [copied, setCopied] = useState(false);
    const [existsInDb, setExistsInDb] = useState(false);
    const [checkingDb, setCheckingDb] = useState(false);
    const [splitPercent, setSplitPercent] = useState(65);
    const [isResizing, setIsResizing] = useState(false);

    const startResizing = useCallback((e: React.MouseEvent) => {
        setIsResizing(true);
        e.preventDefault();
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const resize = useCallback((e: MouseEvent) => {
        if (!isResizing) return;

        // Calculate position relative to sidebar
        const sidebar = document.getElementById('sidebar-container');
        if (!sidebar) return;

        const rect = sidebar.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const newPercent = (offsetX / rect.width) * 100;

        // Constraints
        if (newPercent > 30 && newPercent < 85) {
            setSplitPercent(newPercent);
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', resize);
            window.addEventListener('mouseup', stopResizing);
        }
        return () => {
            window.removeEventListener('mousemove', resize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [isResizing, resize, stopResizing]);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'auto';
        }
        return () => {
            document.body.style.overflow = 'auto';
        };
    }, [isOpen]);

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

            <div
                id="sidebar-container"
                className={`fixed inset-y-0 right-0 w-[1100px] max-w-full bg-[#0f0f0f] border-l border-[#303030] transform transition-transform duration-300 ease-in-out z-50 shadow-2xl ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
            >
                <div className="h-full flex flex-col">
                    <div className="p-6 border-b border-[#303030] flex justify-between items-start bg-white/5">
                        <div className="flex flex-col gap-1.5 overflow-hidden">
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#aaaaaa]">Player & Transcript</span>
                            <h2 className="text-sm font-semibold text-white pr-8 line-clamp-1 leading-relaxed">
                                {title || "Untitled"}
                            </h2>
                        </div>
                        <button onClick={onClose} className="text-[#aaaaaa] hover:text-white transition-colors cursor-pointer p-1 flex-shrink-0">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex-1 flex overflow-hidden relative">
                        {/* Video Player Side */}
                        <div
                            style={{ width: `${splitPercent}%` }}
                            className="p-6 border-r border-gray-900 bg-black/20 flex flex-col justify-center"
                        >
                            {videoId && isOpen ? (
                                <div className="aspect-video w-full bg-black rounded-lg overflow-hidden shadow-2xl border border-gray-800">
                                    <iframe
                                        width="100%"
                                        height="100%"
                                        src={`https://www.youtube.com/embed/${videoId}?rel=0`}
                                        title="YouTube video player"
                                        frameBorder="0"
                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                        allowFullScreen
                                    ></iframe>
                                </div>
                            ) : (
                                <div className="aspect-video w-full bg-gray-900/50 rounded-lg flex items-center justify-center text-gray-700 text-[10px] uppercase tracking-widest font-bold">
                                    No Video ID
                                </div>
                            )}
                        </div>

                        {/* Draggable Divider */}
                        <div
                            onMouseDown={startResizing}
                            className={`absolute inset-y-0 w-1.5 cursor-col-resize z-10 transition-colors group ${isResizing ? 'bg-[#3f3f3f]' : 'hover:bg-[#272727]'}`}
                            style={{ left: `calc(${splitPercent}% - 3px)` }}
                        >
                            <div className="h-full w-px bg-[#303030] mx-auto" />
                        </div>

                        {/* Transcript Side */}
                        <div
                            style={{ width: `${100 - splitPercent}%` }}
                            className="overflow-y-auto p-8 text-[#aaaaaa] text-sm leading-relaxed whitespace-pre-wrap font-sans selection:bg-[#3f3f3f] custom-scrollbar bg-[#121212]"
                        >
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
                                transcript && !transcript.includes("No transcript available") && !transcript.includes("Failed to load") && !transcript.includes("Could not load") ? (
                                    <div className="text-gray-300 leading-relaxed">
                                        {transcript}
                                    </div>
                                ) : (
                                    <div className="text-center text-gray-600 mt-10 flex flex-col items-center gap-4">
                                        <p className="text-xs uppercase tracking-widest font-bold">{transcript || "No transcript data available."}</p>
                                        {onRefetch && (
                                            <button onClick={onRefetch} className="px-4 py-1.5 bg-gray-800 text-gray-300 rounded border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest cursor-pointer mt-2">
                                                Try Again
                                            </button>
                                        )}
                                    </div>
                                )
                            )}
                        </div>
                    </div>

                    <div className="p-8 border-t border-[#303030] flex gap-4 bg-[#0f0f0f]">
                        {(() => {
                            const isTranscriptInvalid = !transcript ||
                                transcript.includes("No transcript available") ||
                                transcript.includes("Failed to load") ||
                                transcript.includes("Could not load");

                            return (
                                <>
                                    <button
                                        onClick={handleCopy}
                                        disabled={loading || isTranscriptInvalid}
                                        className={`flex-1 bg-[#272727] border border-[#303030] text-[#aaaaaa] py-3 rounded-lg transition-all font-bold uppercase text-[10px] tracking-[0.2em] disabled:opacity-20 ${loading || isTranscriptInvalid ? 'cursor-default' : 'hover:text-white hover:bg-[#3f3f3f] cursor-pointer'}`}
                                    >
                                        {copied ? "Copied Transcript" : "Copy Transcript"}
                                    </button>

                                    {existsInDb && onDelete ? (
                                        <button
                                            onClick={onDelete}
                                            disabled={loading || isTranscriptInvalid || checkingDb || !hasApiKey}
                                            title={!hasApiKey ? "API not imported" : isTranscriptInvalid ? "No transcript to delete" : "Delete from library"}
                                            className={`flex-1 bg-red-900/10 border border-red-900/20 text-red-500 py-3 rounded-lg transition-all font-bold uppercase text-[10px] tracking-[0.2em] disabled:opacity-20 flex items-center justify-center gap-2 ${loading || isTranscriptInvalid || checkingDb || !hasApiKey ? 'cursor-default' : 'hover:bg-red-900/20 hover:border-red-500/50 cursor-pointer'}`}
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            Delete from library
                                        </button>
                                    ) : (
                                        <button
                                            onClick={onSave}
                                            disabled={loading || isTranscriptInvalid || checkingDb || !hasApiKey}
                                            title={!hasApiKey ? "API not imported" : isTranscriptInvalid ? "No transcript to save" : "Save to library"}
                                            className={`flex-1 bg-white text-black py-3 rounded-lg transition-all font-bold uppercase text-[10px] tracking-[0.2em] disabled:opacity-20 flex items-center justify-center gap-2 ${loading || isTranscriptInvalid || checkingDb || !hasApiKey ? 'cursor-default' : 'hover:bg-[#e5e5e5] cursor-pointer'}`}
                                        >
                                            <Save className="w-3.5 h-3.5" />
                                            Save to library
                                        </button>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </>
    );
}
