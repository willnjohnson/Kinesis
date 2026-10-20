import { useEffect, useState } from 'react';
import { Mail, CalendarDays, NotebookText } from 'lucide-react';
import { listLogsDue, listCalendarDays, calendarToday } from '../api';
import { Modal } from './Modal';
import type { Log, CalendarDayItem } from '../api';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onOpenLogs: () => void;
    onOpenCalendar: () => void;
}

export function StartupNotificationModal({ isOpen, onClose, onOpenLogs, onOpenCalendar }: Props) {
    const [logsDue, setLogsDue] = useState<Log[]>([]);
    const [calendarDue, setCalendarDue] = useState<CalendarDayItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        const today = calendarToday();

        const loadData = async () => {
            setLoading(true);
            try {
                const [logs, calDays] = await Promise.all([
                    listLogsDue(),
                    listCalendarDays(today, today),
                ]);
                if (!cancelled) {
                    setLogsDue(logs);
                    setCalendarDue(calDays.filter(d => !d.done && d.kind === 'scheduled'));
                }
            } catch {
                if (!cancelled) {
                    setLogsDue([]);
                    setCalendarDue([]);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        const handleWorkspaceSwitch = () => {
            cancelled = true;
            onClose();
        };

        window.addEventListener('kinesis:workspace-switch', handleWorkspaceSwitch);
        loadData();
        return () => {
            cancelled = true;
            window.removeEventListener('kinesis:workspace-switch', handleWorkspaceSwitch);
        };
    }, [isOpen, onClose]);

    const hasContent = logsDue.length > 0 || calendarDue.length > 0;

    if (!isOpen || !hasContent) return null;

    return (
        <Modal
            onClose={onClose}
            icon={Mail}
            title="Notification"
            size="sm"
            footer={
                <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-md bg-[#272727] hover:bg-[#3f3f3f] border border-[#3f3f3f] text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                    Dismiss
                </button>
            }
        >
            <div className="space-y-6">
                {logsDue.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
                            <NotebookText className="w-4 h-4 text-gray-400 shrink-0" />
                            Logs ({logsDue.length} {logsDue.length === 1 ? 'due' : 'due'})
                        </div>
                        <ul className="space-y-2 ml-6">
                            {logsDue.map(log => (
                                <li key={log.id} className="flex items-center gap-3 text-sm text-gray-200">
                                    <span className="w-2 h-2 rounded-full bg-[var(--k-accent)] shrink-0" />
                                    <span className="truncate flex-1">{log.name}</span>
                                    <button
                                        type="button"
                                        onClick={onOpenLogs}
                                        className="shrink-0 text-xs text-gray-400 hover:text-white underline transition-colors cursor-pointer"
                                    >
                                        Open Logs
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {calendarDue.length > 0 && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
                            <CalendarDays className="w-4 h-4 text-gray-400 shrink-0" />
                            Calendar ({calendarDue.length} {calendarDue.length === 1 ? 'task' : 'tasks'} due)
                        </div>
                        <ul className="space-y-2 ml-6">
                            {calendarDue.slice(0, 10).map(item => (
                                <li key={`${item.trackId}|${item.entryId}|${item.videoId}|${item.cycle}|${item.kind}`} className="flex items-center gap-3 text-sm text-gray-200">
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `hsl(${(item.trackId * 137) % 360}, 70%, 50%)` }} />
                                    <span className="truncate flex-1">{item.title}</span>
                                    <button
                                        type="button"
                                        onClick={onOpenCalendar}
                                        className="shrink-0 text-xs text-gray-400 hover:text-white underline transition-colors cursor-pointer"
                                    >
                                        Open Calendar
                                    </button>
                                </li>
                            ))}
                            {calendarDue.length > 10 && (
                                <li className="text-xs text-gray-500 ml-2">+{calendarDue.length - 10} more&hellip;</li>
                            )}
                        </ul>
                    </div>
                )}

                {loading && (
                    <div className="flex items-center justify-center py-4 text-gray-500 text-sm">
                        Loading&hellip;
                    </div>
                )}
            </div>
        </Modal>
    );
}