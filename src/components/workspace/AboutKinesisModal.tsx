import { useEffect, useState, type ElementType } from "react";
import { ArrowLeft, ArrowRight, BookA, BookMarked, CalendarDays, FolderTree, Info, Layers, PanelRight, Search, Sparkles, UserSearch } from "lucide-react";
import { Modal } from "../Modal";
import { BRAND } from "../../branding";
import { SecondaryButton } from '../ui/Button';

/** One page of the walkthrough: a part of the app, what it's for, and how it's used. */
interface Page {
    name: string;
    Icon: ElementType;
    what: string;
    how: string[];
}

const PARTS: Page[] = [
    {
        name: "Search", Icon: Search, what: "Find videos on YouTube.",
        how: ["Paste a video, playlist or channel link, or type a @handle.", "Save the videos you want to keep."],
    },
    {
        name: "Library", Icon: BookMarked, what: "Every video you've saved, in one place.",
        how: ["Filter by text, #tag, ^term or @handle.", "Transcripts are searched too."],
    },
    {
        name: "Drive", Icon: FolderTree, what: "Folders for your videos, written as paths like :CS-DSA.",
        how: ["Browse and sort them in the Drive panel.", "Give a Drive's videos an order to watch in."],
    },
    {
        name: "Sidebar", Icon: PanelRight, what: "Opens when you pick a video.",
        how: ["Watch it and read its transcript.", "Make an AI summary.", "Add tags, notes and attachments."],
    },
    {
        name: "Glossary", Icon: BookA, what: "Your vocabulary.",
        how: ["A Tag is a quick label for videos.", "A Term is a tag with a definition.", "Type ^ in any note to link a Term."],
    },
    {
        name: "Biography", Icon: UserSearch, what: "The people and channels behind your videos.",
        how: ["Type @ in any note to link one.", "See every note that mentions them."],
    },
    {
        name: "Calendar", Icon: CalendarDays, what: "Plan with tracks: lists of videos and tasks to work through.",
        how: ["Go one by one, on a weekly schedule, or as a repeating rotation.", "Check items off as you go.", "Export them to Google, Apple or Outlook."],
    },
    {
        name: "Workspaces", Icon: Layers, what: "Separate libraries, each in its own folder.",
        how: ["Keep subjects or projects apart.", "Share one as a .kinpak file."],
    },
];

/** The usual way through the app, shown on the first page. */
const FLOW: [string, string][] = [
    ["Find", "videos in Search"],
    ["Organize", "them in your Library and Drives"],
    ["Learn", "from them in the Sidebar"],
    ["Plan", "them into tracks on the Calendar"],
];

/**
 * What Kinesis is and how it's used, opened from the Workspaces screen: a short walkthrough, one page at a time. A welcome
 * page, a page per part of the app, and a last one to finish on. Back and Next (or the arrow keys) move through it, and
 * the dots jump to a page.
 */
export function AboutKinesisModal({ onClose, inApp = false }: {
    onClose: () => void;
    /** Opened from inside a workspace (Ctrl+K), not the Workspaces screen: the last page doesn't send you to pick one. */
    inApp?: boolean;
}) {
    const total = PARTS.length + 2;
    const [page, setPage] = useState(0);
    const last = page === total - 1;
    const go = (to: number) => setPage(Math.max(0, Math.min(total - 1, to)));

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return;
            if (e.key === "ArrowRight") setPage(p => Math.min(total - 1, p + 1));
            else if (e.key === "ArrowLeft") setPage(p => Math.max(0, p - 1));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [total]);

    const part = page >= 1 && page <= PARTS.length ? PARTS[page - 1] : null;

    return (
        <Modal
            onClose={onClose}
            icon={Info}
            title={`About ${BRAND.name}`}
            subtitle={page === 0 ? "Welcome" : part ? `${page} of ${PARTS.length}: ${part.name}` : "You're ready"}
            size="sm"
            bodyClassName="p-6 h-[22rem] custom-scrollbar"
            footer={
                <div className="w-full flex items-center gap-3">
                    <div className="flex items-center gap-1.5 flex-1">
                        {Array.from({ length: total }, (_, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => go(i)}
                                aria-label={`Page ${i + 1}`}
                                className={`h-1.5 rounded-full transition-all cursor-pointer ${i === page ? "w-4 bg-[var(--k-accent)]" : "w-1.5 bg-[#444444] hover:bg-[#666666]"}`}
                            />
                        ))}
                    </div>
                    {page > 0 && (
                        <SecondaryButton onClick={() => go(page - 1)}>
                            <ArrowLeft className="w-3.5 h-3.5" /> Back
                        </SecondaryButton>
                    )}
                    <button type="button" onClick={() => (last ? onClose() : go(page + 1))} className="flex items-center gap-1.5 px-5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors text-sm font-bold cursor-pointer">
                        {last ? "Get started" : page === 0 ? "Take the tour" : "Next"}
                        {!last && <ArrowRight className="w-3.5 h-3.5" />}
                    </button>
                </div>
            }
        >
            {/* key: each page fades in on its own. */}
            <div key={page} className="h-full flex flex-col animate-in fade-in slide-in-from-right-2 duration-200">
                {page === 0 && (
                    <>
                        <h3 className="text-2xl font-bold tracking-tight text-white">
                            {/* The name as the app's header writes it: the accent on its first three letters. */}
                            Welcome to <span className="text-[var(--k-accent)]">{BRAND.name.substring(0, 3)}</span>{BRAND.name.substring(3)}
                        </h3>
                        <p className="text-sm text-gray-300 leading-relaxed mt-2">
                            Video-centric personal knowledge management. Save the videos you learn from, take notes on them, and link
                            ideas, people and terms together.
                        </p>
                        <p className="text-sm text-gray-400 leading-relaxed mt-2">
                            Built for learning that follows a plan, like a fitness routine or a school course.
                        </p>
                        <ol className="mt-5 space-y-2">
                            {FLOW.map(([step, rest], i) => (
                                <li key={step} className="flex items-center gap-3 text-sm">
                                    <span className="w-6 h-6 rounded-full bg-[#222222] border border-[#383838] text-[11px] font-bold text-white flex items-center justify-center shrink-0">{i + 1}</span>
                                    <span><span className="font-bold text-white">{step}</span> <span className="text-gray-400">{rest}</span></span>
                                </li>
                            ))}
                        </ol>
                    </>
                )}

                {part && (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-[#121212] border border-[#272727] flex items-center justify-center shrink-0">
                                <part.Icon className="w-5 h-5 text-[#aaaaaa]" />
                            </div>
                            <h3 className="text-2xl font-bold tracking-tight text-white">{part.name}</h3>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed mt-3">{part.what}</p>
                        <ul className="mt-5 space-y-2.5">
                            {part.how.map(line => (
                                <li key={line} className="flex gap-2.5 text-sm text-gray-400 leading-relaxed">
                                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[var(--k-accent)] shrink-0" />
                                    <span>{line}</span>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                {last && (
                    <>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-[#121212] border border-[#272727] flex items-center justify-center shrink-0">
                                <Sparkles className="w-5 h-5 text-[#aaaaaa]" />
                            </div>
                            <h3 className="text-2xl font-bold tracking-tight text-white">You're ready</h3>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed mt-3">
                            {inApp ? "Pick any part of the app to explore it." : "Pick a workspace, or create one, to begin."}
                        </p>
                        <p className="text-sm text-gray-400 leading-relaxed mt-5">
                            Tip: press <kbd className="px-1 rounded border border-[#444444] text-gray-300">Ctrl</kbd> + <kbd className="px-1 rounded border border-[#444444] text-gray-300">K</kbd> to
                            jump to any part of the app, a video, a term or a person.
                        </p>
                    </>
                )}
            </div>
        </Modal>
    );
}
