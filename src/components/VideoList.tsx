import { Eye, Calendar } from 'lucide-react';
import { type Video } from '../api';
import { useState, useMemo } from 'react';
import { format } from 'date-fns';

interface Props {
    videos: Video[];
    onSelect: (video: Video) => void;
}

type SortField = 'popularity' | 'date';
type SortOrder = 'desc' | 'asc';

export function VideoList({ videos, onSelect }: Props) {
    const [sortField, setSortField] = useState<SortField>('date');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    const sortedVideos = useMemo(() => {
        return [...videos].sort((a, b) => {
            let cmp = 0;
            if (sortField === 'popularity') {
                const vA = parseInt(a.viewCount.replace(/[^0-9]/g, '')) || 0;
                const vB = parseInt(b.viewCount.replace(/[^0-9]/g, '')) || 0;
                cmp = vA - vB;
            } else {
                const timeA = new Date(a.publishedAt).getTime();
                const timeB = new Date(b.publishedAt).getTime();

                const validA = !isNaN(timeA);
                const validB = !isNaN(timeB);

                if (validA && validB) {
                    cmp = timeA - timeB;
                } else if (!validA && !validB) {
                    cmp = 0;
                } else {
                    cmp = validA ? 1 : -1;
                }
            }
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
        <div className="w-full max-w-[1600px] mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4 px-2">
                <h3 className="text-xl font-bold text-white tracking-tight">Videos <span className="text-gray-500 font-normal text-sm ml-2">({videos.length})</span></h3>

                <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-800">
                    <button
                        onClick={() => toggleSort('date')}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${sortField === 'date' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        <Calendar className="w-4 h-4" />
                        Date
                    </button>
                    <button
                        onClick={() => toggleSort('popularity')}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all ${sortField === 'popularity' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200'}`}
                    >
                        <Eye className="w-4 h-4" />
                        Views
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {sortedVideos.map((video) => (
                    <div
                        key={video.id}
                        onClick={() => onSelect(video)}
                        className="group bg-gray-900/40 border border-gray-800 rounded-lg overflow-hidden hover:border-gray-700 transition-colors cursor-pointer"
                    >
                        <div className="aspect-video w-full overflow-hidden bg-gray-800">
                            <img
                                src={video.thumbnail}
                                alt={video.title}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        </div>
                        <div className="p-4">
                            <h4 className="text-gray-200 font-medium line-clamp-2 mb-3 group-hover:text-white transition-colors text-sm leading-relaxed h-10">{video.title}</h4>
                            <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium tracking-tight">
                                <span className="flex items-center gap-1.5 bg-gray-800/30 px-2 py-0.5 rounded">
                                    <Eye className="w-3.5 h-3.5" /> {formatViewCount(video.viewCount)}
                                </span>
                                <span className="text-gray-600 uppercase text-[10px] tracking-wider">{formatDate(video.publishedAt)}</span>
                            </div>
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

function formatViewCount(count: string) {
    const clean = count.replace(/[^0-9]/g, '');
    const n = parseInt(clean);
    if (isNaN(n)) return count || '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}
