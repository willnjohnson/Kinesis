import { Save, Trash2, Bookmark } from 'lucide-react';
import { type Video } from '../api';
import { useState, useMemo } from 'react';
import { format } from 'date-fns';

interface Props {
    videos: Video[];
    onSelect: (video: Video) => void;
    onSaveAll?: () => void;
    onDelete?: (video: Video) => void;
    saveProgress?: string | null;
}

type SortField = 'popularity' | 'date' | 'added';
type SortOrder = 'desc' | 'asc';

export function VideoList({ videos, onSelect, onSaveAll, onDelete, saveProgress }: Props) {
    const [sortField, setSortField] = useState<SortField>('date');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    const sortedVideos = useMemo(() => {
        return [...videos].sort((a, b) => {
            let cmp = 0;
            if (sortField === 'popularity') {
                const vA = parseViewCount(a.viewCount);
                const vB = parseViewCount(b.viewCount);
                cmp = vA - vB;
            } else if (sortField === 'added') {
                const timeA = a.dateAdded ? new Date(a.dateAdded).getTime() : 0;
                const timeB = b.dateAdded ? new Date(b.dateAdded).getTime() : 0;
                cmp = timeA - timeB;
            } else {
                const timeA = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
                const timeB = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;

                const validA = !isNaN(timeA) && timeA > 0;
                const validB = !isNaN(timeB) && timeB > 0;

                if (validA && validB) {
                    cmp = timeA - timeB;
                } else if (!validA && !validB) {
                    // Fallback to title comparison if both dates are invalid/missing
                    cmp = a.title.localeCompare(b.title);
                } else {
                    cmp = validA ? 1 : -1;
                }
            }
            // Ensure stable sort by using ID as tie-breaker
            if (cmp === 0) return a.id.localeCompare(b.id);
            return sortOrder === 'asc' ? cmp : -cmp;
        });
    }, [videos, sortField, sortOrder]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
    };

    if (videos.length === 0) return null;

    return (
        <div className="w-full max-w-[1700px] mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4 px-2">
                <div className="flex items-center gap-4">
                    <h3 className="text-xl font-bold text-white">Videos</h3>
                    <span className="text-[#aaaaaa] text-sm font-medium">{videos.length} results</span>
                </div>

                <div className="flex items-center gap-2">
                    {onSaveAll && (
                        <button
                            onClick={onSaveAll}
                            disabled={!!saveProgress}
                            className={`mr-4 px-4 py-2 bg-white text-black hover:bg-[#e5e5e5] rounded-full text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 ${!saveProgress ? 'cursor-pointer' : 'cursor-default'}`}
                        >
                            {saveProgress ? (
                                <>
                                    <div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" />
                                    {saveProgress}
                                </>
                            ) : (
                                <>
                                    <Save className="w-4 h-4" />
                                    Save All
                                </>
                            )}
                        </button>
                    )}

                    <div className="flex gap-2">
                        <button
                            onClick={() => toggleSort('date')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${sortField === 'date' ? 'bg-white text-black' : 'bg-[#272727] text-white hover:bg-[#3f3f3f]'}`}
                        >
                            Date Uploaded
                        </button>
                        {videos.some(v => v.dateAdded) && (
                            <button
                                onClick={() => toggleSort('added')}
                                className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${sortField === 'added' ? 'bg-white text-black' : 'bg-[#272727] text-white hover:bg-[#3f3f3f]'}`}
                            >
                                Date Bookmarked
                            </button>
                        )}
                        <button
                            onClick={() => toggleSort('popularity')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${sortField === 'popularity' ? 'bg-white text-black' : 'bg-[#272727] text-white hover:bg-[#3f3f3f]'}`}
                        >
                            Views
                        </button>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-x-4 gap-y-10">
                {sortedVideos.map((video) => (
                    <div
                        key={video.id}
                        className="group flex flex-col gap-3 cursor-pointer"
                        onClick={() => onSelect(video)}
                    >
                        {/* Thumbnail */}
                        <div className="aspect-video w-full rounded-xl overflow-hidden bg-[#272727] relative">
                            <img
                                src={video.thumbnail}
                                alt={video.title}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                loading="lazy"
                            />
                        </div>

                        {/* Details */}
                        <div className="flex gap-3 px-1">
                            <div className="flex flex-col flex-1 overflow-hidden">
                                <h3 className="text-sm font-bold text-white line-clamp-2 leading-snug group-hover:text-white mb-1">
                                    {video.title}
                                </h3>

                                <div className="flex flex-col text-[13px] text-[#aaaaaa]">
                                    <span className="truncate">
                                        {video.author || "YouTube Creator"}
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <span>{formatViewCount(video.viewCount)} views</span>
                                        <span className="text-[8px]">•</span>
                                        <span>{formatDate(video.publishedAt)}</span>
                                    </div>

                                    {video.dateAdded && (
                                        <div className="flex items-center gap-1 mt-1 text-yellow-400 font-medium text-[11px]">
                                            <Bookmark className="w-3 h-3 fill-yellow-400" />
                                            <span>Bookmarked {formatDate(video.dateAdded)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {onDelete && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete(video);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-2 hover:bg-[#3f3f3f] rounded-full transition-all text-white self-start mt-1 hover:cursor-pointer"
                                    title="Remove"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function formatDate(dateStr: string) {
    if (!dateStr) return 'Unknown';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
        // Handle strings like "3 days ago" or "6 months ago" from InnerTube
        return dateStr;
    }
    return format(d, 'MMM dd, yyyy');
}

function parseViewCount(count: string): number {
    if (!count) return 0;
    const clean = count.toLowerCase().replace(/,/g, '').trim();

    // Check for explicit multipliers
    let multiplier = 1;
    if (clean.includes('k')) multiplier = 1000;
    else if (clean.includes('m')) multiplier = 1000000;
    else if (clean.includes('b')) multiplier = 1000000000;

    // Extract base number
    const num = parseFloat(clean.replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return 0;

    return Math.floor(num * multiplier);
}

function formatViewCount(count: string) {
    if (!count) return '0';

    // If it's already a formatted string like "1.2M views", just cleanup
    if (count.toLowerCase().includes('view')) {
        return count.split(' ')[0];
    }

    const n = parseViewCount(count);
    if (n >= 1000000000) return (n / 1000000000).toFixed(1) + 'B';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
}
