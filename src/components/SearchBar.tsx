import { Search } from 'lucide-react';
import React, { useState } from 'react';

interface Props {
    onSearch: (handle: string) => void;
    loading: boolean;
    placeholder?: string;
    viewMode?: 'search' | 'library';
}

export function SearchBar({ onSearch, loading, placeholder, viewMode = 'search' }: Props) {
    const [query, setQuery] = useState('');

    const isLibrary = viewMode === 'library';

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (query.trim()) onSearch(query.trim());
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setQuery(val);
        if (isLibrary) {
            onSearch(val);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-xl mx-auto mb-8 relative">
            <div className="relative flex items-center bg-gray-900 border border-gray-800 rounded-lg overflow-hidden focus-within:border-gray-600 transition-colors">
                <Search className="absolute left-4 text-gray-500 w-5 h-5 pointer-events-none" />
                <input
                    type="text"
                    value={query}
                    onChange={handleChange}
                    placeholder={placeholder || "Search YouTube handle, playlist URL, or video URL"}
                    className={`w-full bg-transparent text-white py-4 pl-12 focus:outline-none placeholder-gray-500 text-sm ${isLibrary ? 'pr-4' : 'pr-28'}`}
                    disabled={loading}
                />
                {!isLibrary && (
                    <button
                        type="submit"
                        disabled={loading || !query.trim()}
                        className="absolute right-0 top-0 bottom-0 px-6 bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 cursor-pointer border-l border-gray-800"
                    >
                        Search
                    </button>
                )}
            </div>
        </form>
    );
}

