import React, { useState } from 'react';
import { Key } from 'lucide-react';
import { saveApiKey } from '../api';

interface Props {
    onComplete: () => void;
}

export function KeySetup({ onComplete }: Props) {
    const [key, setKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!key.trim()) return;

        setLoading(true);
        setError(null);
        try {
            await saveApiKey(key);
            onComplete();
        } catch (err: any) {
            setError(err.message || 'Failed to save key');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl animate-in fade-in zoom-in duration-500">
                <div className="flex justify-center mb-6">
                    <div className="bg-red-500/10 p-4 rounded-full border border-red-500/20">
                        <Key className="w-8 h-8 text-red-500" />
                    </div>
                </div>

                <h2 className="text-2xl font-black text-white text-center mb-2 tracking-tight uppercase">
                    Setup Required
                </h2>
                <div className="text-gray-400 text-center mb-8 text-sm leading-relaxed">
                    <p>A YouTube API key is required to use this application.</p>
                    <p>This key will be saved locally in <code className="text-red-400 font-mono">yt.key</code>.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="relative group flex items-center">
                        <input
                            type={showKey ? "text" : "password"}
                            value={key}
                            onChange={(e) => setKey(e.target.value)}
                            placeholder="Paste YouTube API Key"
                            className="w-full bg-transparent text-white py-4 pl-5 pr-5 focus:outline-none placeholder-gray-500 text-sm border border-gray-800 rounded-xl"
                            required
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            className="absolute right-4 text-gray-500 hover:text-white transition-colors"
                        >
                        </button>
                    </div>

                    {error && (
                        <div className="text-red-500 text-xs font-medium bg-red-500/10 p-3 rounded-lg border border-red-500/20">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !key.trim()}
                        className="w-full bg-white text-black hover:bg-gray-100 py-4 rounded-xl font-bold uppercase text-xs tracking-widest transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                        {loading ? 'Saving...' : 'Save & Continue'}
                    </button>

                    <div className="pt-4 text-center">
                        <p>Get your <a className="text-blue-400" href="https://console.cloud.google.com/" target="tauri-plugin-openurl">API key</a> here</p>
                    </div>
                </form>
            </div>
        </div >
    );
}
