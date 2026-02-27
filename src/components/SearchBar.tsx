import { Search, AtSign, Youtube, ListVideo, Filter, X, Lightbulb } from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';

export interface Facet {
    type: SearchFacet;
    value: string;
}

interface Props {
    onSearch: (query: string) => void;
    onLiveFilter?: (query: string) => void;
    loading: boolean;
    placeholder?: string;
    viewMode?: 'search' | 'library';
    initialFacets?: Facet[];
    initialQuery?: string;
}

export type SearchFacet = 'handle' | 'playlist' | 'video' | 'filter_search';

export function SearchBar({ onSearch, onLiveFilter, loading, viewMode = 'search', initialFacets = [], initialQuery = '' }: Props) {
    const [query, setQuery] = useState(initialQuery);
    const [facets, setFacets] = useState<Facet[]>(() => {
        if (initialFacets.length > 0) return initialFacets;
        if (viewMode === 'library') return [{ type: 'filter_search', value: '' }];
        return [];
    });
    const inputRef = useRef<HTMLInputElement>(null);

    const isLibrary = viewMode === 'library';
    const isFilterSearchActive = facets.some(f => f.type === 'filter_search');

    // Sync from props
    useEffect(() => {
        if (initialFacets.length > 0) {
            setFacets(initialFacets);
        }
        setQuery(initialQuery);
    }, [initialFacets, initialQuery]);

    // Help propagate changes whenever facets or query change
    useEffect(() => {
        // Construct the full query: Facet Type + Query content
        const fullQuery = facets.map(f => {
            // In the new simplified model, the "query" is the value for the first/main facet
            // If the facet has an internal value (from props), use it, otherwise use query
            const val = f.value || query;
            const escapedValue = val.includes(' ') ? `"${val}"` : val;
            return `${f.type}:${escapedValue}`;
        }).join(' ') + (facets.length === 0 ? query : "");

        if (onLiveFilter) onLiveFilter(fullQuery);
        if (isLibrary) onSearch(fullQuery);
    }, [facets, query, isLibrary, onLiveFilter, onSearch]);

    const getFacetIcon = (type: SearchFacet) => {
        switch (type) {
            case 'handle': return <AtSign className="w-3 h-3" />;
            case 'video': return <Youtube className="w-3 h-3" />;
            case 'playlist': return <ListVideo className="w-3 h-3" />;
            case 'filter_search': return <Filter className="w-3 h-3" />;
            default: return null;
        }
    };

    const facetPatterns: Record<string, SearchFacet> = {
        'handle:': 'handle',
        'playlist:': 'playlist',
        'video:': 'video',
        'filter_search:': 'filter_search'
    };

    const extractPlaylistId = (val: string) => {
        const match = val.match(/[?&]list=([^#&?]+)/);
        if (match) return match[1];
        if (/^(PL|UU|LL|RD|OLAK5uy_)[a-zA-Z0-9_-]+$/.test(val)) return val;
        return null;
    };

    const extractVideoId = (val: string) => {
        // YouTube IDs are 11 chars. We use a regex that looks specifically for that pattern in URLs.
        const match = val.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
        if (match) return match[1];
        if (/^[a-zA-Z0-9_-]{11}$/.test(val) && !val.includes('.') && !val.includes('/')) return val;
        return null;
    };

    const extractHandle = (val: string) => {
        if (val.startsWith('@')) return val.slice(1);
        const match = val.match(/youtube\.com\/(?:c\/|channel\/|@|user\/)([^\/\s?]+)/i);
        if (match) return match[1];
        return null;
    };

    const handleInput = (val: string) => {
        let currentVal = val;

        // Check for facet prefixes anywhere in the input
        for (const [prefix, type] of Object.entries(facetPatterns)) {
            const lowVal = currentVal.toLowerCase();
            const prefixIndex = lowVal.indexOf(prefix);
            if (prefixIndex !== -1) {
                const afterPrefix = currentVal.slice(prefixIndex + prefix.length);
                // If there's a space after some content, it's a badge conversion trigger
                if (afterPrefix.trimStart().includes(' ') || (afterPrefix.length > 0 && afterPrefix.endsWith(' '))) {
                    const parts = afterPrefix.trimStart().split(' ');
                    const rawValue = parts[0];
                    const remaining = parts.slice(1).join(' ');

                    let actualValue = rawValue;
                    if (type === 'video') actualValue = extractVideoId(rawValue) || rawValue;
                    if (type === 'playlist') actualValue = extractPlaylistId(rawValue) || rawValue;
                    if (type === 'handle') actualValue = extractHandle(rawValue) || rawValue;

                    setFacets([{ type, value: "" }]); // Reset facets to just this new main type
                    setQuery(actualValue + (remaining ? " " + remaining : ""));
                    return;
                }
            }
        }

        // Auto-detection on paste or fast typing
        if (facets.length === 0) {
            const handle = extractHandle(val);
            const videoId = extractVideoId(val);
            const playlistId = extractPlaylistId(val);

            if (handle && (val.includes('youtube.com') || val.startsWith('@'))) {
                setFacets([{ type: 'handle', value: "" }]);
                setQuery(handle);
                return;
            } else if (videoId && (val.includes('youtube.com') || val.includes('youtu.be'))) {
                setFacets([{ type: 'video', value: "" }]);
                setQuery(videoId);
                return;
            } else if (playlistId && val.includes('list=')) {
                setFacets([{ type: 'playlist', value: "" }]);
                setQuery(playlistId);
                return;
            }
        }
        setQuery(val);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && query === '' && facets.length > 0 && e.currentTarget.selectionStart === 0) {
            const lastFacet = facets[facets.length - 1];
            setFacets(facets.slice(0, -1));
            // Bring back as prefix if it wasn't empty
            setQuery(lastFacet.type + ':');
            e.preventDefault();
        }
    };

    const removeFacet = (index: number) => {
        setFacets(facets.filter((_, i) => i !== index));
        // Reset query if we remove the only facet
        if (facets.length === 1) setQuery("");
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (isFilterSearchActive) return;

        // Construct final query string
        const fullQuery = facets.map(f => `${f.type}:${query}`).join(' ') + (facets.length === 0 ? query : "");
        if (fullQuery.trim()) onSearch(fullQuery.trim());
    };

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto mb-10 px-4">
            <div className={`flex items-stretch justify-center transition-all ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className={`relative flex-1 flex flex-wrap items-center bg-[#121212] border border-[#404040] ${isLibrary ? 'rounded-full' : 'rounded-l-full'} focus-within:ring-1 focus-within:ring-[red] transition-all min-h-11 py-1 px-3 gap-2`}>
                    {facets.map((f, i) => (
                        <div key={`${f.type}-${i}`} className="flex items-center gap-1.5 bg-[#272727] border border-[#444444] text-[#aaaaaa] rounded-full px-3 py-0.5 animate-in zoom-in-95 duration-200 shadow-sm shrink-0 select-none">
                            {getFacetIcon(f.type)}
                            <span className="text-[11px] font-bold uppercase tracking-wider">{f.type.replace(/_/g, ' ')}</span>
                            <button
                                type="button"
                                onClick={() => removeFacet(i)}
                                className="hover:text-red-500 transition-colors ml-1"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => handleInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={isLibrary ? "" : facets.length > 0 ? "" : "Search YouTube handle, playlist URL, or video URL"}
                        className="flex-1 min-w-[120px] bg-transparent text-white px-2 focus:outline-none placeholder-gray-500 text-[16px] h-full"
                        disabled={loading}
                    />

                    {/* Hints Lightbulb */}
                    {!isLibrary && (
                        <div className="group/hint relative flex items-center pr-1">
                            <Lightbulb className="w-4 h-4 text-gray-500 hover:text-yellow-400 transition-colors cursor-help" />

                            {/* Simplified Hint Tooltip */}
                            <div className="absolute top-full right-0 mt-3 w-64 bg-[#1a1a1a] border border-[#333] rounded-xl p-4 shadow-2xl opacity-0 translate-y-2 pointer-events-none group-hover/hint:opacity-100 group-hover/hint:translate-y-0 transition-all duration-200 z-50">
                                <h4 className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3 border-b border-[#333] pb-2">Search Tips</h4>
                                <div className="space-y-4">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter">Paste Mode</span>
                                        <p className="text-[12px] text-gray-300">Paste any YouTube URL directly into the search bar.</p>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[10px] text-gray-500 font-bold uppercase tracking-tighter">Facet Options</span>
                                        <div className="grid grid-cols-1 gap-1.5 pt-1 text-[11px]">
                                            <code className="bg-black/40 px-2 py-1 rounded text-white flex justify-between group/code transition-colors">
                                                <span>filter_search:</span>
                                                <span className="text-gray-500 group-hover/code:text-gray-300">Title Filter</span>
                                            </code>
                                            <code className="bg-black/40 px-2 py-1 rounded text-white flex justify-between group/code transition-colors">
                                                <span>playlist:</span>
                                                <span className="text-gray-500 group-hover/code:text-gray-300">ID / URL</span>
                                            </code>
                                            <code className="bg-black/40 px-2 py-1 rounded text-white flex justify-between group/code transition-colors">
                                                <span>video:</span>
                                                <span className="text-gray-500 group-hover/code:text-gray-300">ID / URL</span>
                                            </code>
                                            <code className="bg-black/40 px-2 py-1 rounded text-white flex justify-between group/code transition-colors">
                                                <span>handle:</span>
                                                <span className="text-gray-500 group-hover/code:text-gray-300">@User / ID</span>
                                            </code>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                {!isLibrary && (
                    <button
                        type="submit"
                        disabled={loading || (query.trim() === '' && facets.length === 0) || isFilterSearchActive}
                        className={`flex items-center justify-center px-6 bg-[#222222] border border-[#404040] border-l-0 rounded-r-full transition-colors disabled:opacity-50 group h-auto min-h-11 ${isFilterSearchActive ? 'cursor-default' : 'hover:bg-[#333333] hover:border-[#505050] cursor-pointer'
                            }`}
                        title={isFilterSearchActive ? "In Filter Mode" : "Search"}
                    >
                        <Search className={`w-5 h-5 text-[#aaaaaa] ${!isFilterSearchActive && 'group-hover:text-white'}`} />
                    </button>
                )}
            </div>
        </form>
    );
}
