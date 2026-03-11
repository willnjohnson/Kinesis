import { X, Settings, Database, Check, Monitor, Key, HardDrive, Sun, Moon, LayoutGrid, List, History, Clock, Trash2, Cpu } from "lucide-react";
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
    getApiKey,
    setApiKey as saveApiKeyCmd,
    removeApiKey as removeApiKeyCmd,
    openDbLocation,
    getDbDetails,
    getDisplaySettings,
    setDisplaySettings,
    getSearchHistory,
    clearHistoryBeforeDate,
    deleteHistoryEntry,
    clearAllHistory,
    getSetting,
    setSetting,
    checkOllama,
    pullModel,
    deleteModel,
    installOllama,
    type DbDetails,
    type DisplaySettings,
    type HistoryEntry
} from "../api";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onStatusChange: (status: boolean) => void;
    onThemeChange?: (theme: string) => void;
    onVideoListModeChange: (mode: 'grid' | 'compact') => void;
    currentVideoListMode: 'grid' | 'compact';
    onPluginsChange?: () => void;
}

type Tab = 'api' | 'db' | 'display' | 'history' | 'plugins';

export function SettingsModal({ isOpen, onClose, onStatusChange, onThemeChange, onVideoListModeChange, currentVideoListMode, onPluginsChange }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('api');
    const [hasKey, setHasKey] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [loading, setLoading] = useState(false);

    const [dbDetails, setDbDetails] = useState<DbDetails | null>(null);
    const [displaySettings, setDisplaySettingsState] = useState<DisplaySettings>({
        resolution: '1440x900',
        fullscreen: false,
        theme: 'dark',
        videoListMode: 'grid'
    });
    const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
    const [plugins, setPlugins] = useState<{ id: string, name: string, enabled: boolean, description: string }[]>([
        { id: 'summarize', name: 'Summarize Transcripts [Beta]', enabled: false, description: 'Adds AI-powered summarization for transcripts using Ollama.' }
    ]);
    const [pluginStatus, setPluginStatus] = useState<string | null>(null);

    useEffect(() => {
        const unlisten = listen("plugin_progress", (event) => {
            setPluginStatus(event.payload as string);
        });
        return () => {
            unlisten.then(fn => fn());
        };
    }, []);

    useEffect(() => {
        if (isOpen) {
            setLoading(true);
            Promise.all([
                getApiKey(),
                getDbDetails(),
                getDisplaySettings(),
                getSearchHistory(100),
                getSetting('plugin_summarize_enabled')
            ]).then(([key, db, display, hist, summarize_enabled]) => {
                setHasKey(!!key);
                setApiKeyInput("");
                setDbDetails(db);
                setDisplaySettingsState(display);
                setHistoryEntries(hist);
                setPlugins(prev => prev.map(p =>
                    p.id === 'summarize' ? { ...p, enabled: summarize_enabled === 'true' } : p
                ));
                setLoading(false);
            }).catch(e => {
                console.error(e);
                setLoading(false);
            });
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSaveApiKey = async () => {
        if (!apiKeyInput.trim()) return;
        setLoading(true);
        try {
            await saveApiKeyCmd(apiKeyInput.trim());
            setHasKey(true);
            onStatusChange(true);
            setApiKeyInput("");
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveApiKey = async () => {
        setLoading(true);
        try {
            await removeApiKeyCmd();
            setHasKey(false);
            onStatusChange(false);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateDisplay = async (updates: Partial<DisplaySettings>) => {
        const newSettings = { ...displaySettings, ...updates };
        setDisplaySettingsState(newSettings);
        try {
            await setDisplaySettings(newSettings);
            // Notify parent components of changes
            if (updates.videoListMode) {
                onVideoListModeChange?.(updates.videoListMode);
            }
        } catch (e) {
            console.error("Failed to apply display settings", e);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const resolutions = [
        "600x600",
        "800x600",
        "1024x768",
        "1280x720",
        "1440x900",
        "1600x900",
        "1920x1080",
        "2560x1440"
    ];

    return (
        <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-[#0f0f0f] border border-[#303030] rounded-2xl w-full max-w-2xl min-h-[450px] shadow-2xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-[#303030] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Settings className="w-5 h-5 text-gray-400" />
                        <h2 className="text-lg font-bold">Settings</h2>
                    </div>
                    <button onClick={onClose} className="text-[#aaaaaa] hover:text-white transition-colors cursor-pointer">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex flex-1 overflow-hidden">
                    {/* Sidebar Tabs */}
                    <div className="w-48 border-r border-[#303030] bg-white/5 py-4">
                        <button
                            onClick={() => setActiveTab('api')}
                            className={`w-full px-6 py-3 text-left flex items-center gap-3 transition-colors text-sm font-semibold cursor-pointer ${activeTab === 'api' ? 'bg-[#303030] text-white border-l-4 border-red-600' : 'text-[#aaaaaa] hover:bg-[#202020] border-l-4 border-transparent'}`}
                        >
                            <Key className="w-4 h-4" />
                            API Key
                        </button>
                        <button
                            onClick={() => setActiveTab('db')}
                            className={`w-full px-6 py-3 text-left flex items-center gap-3 transition-colors text-sm font-semibold cursor-pointer ${activeTab === 'db' ? 'bg-[#303030] text-white border-l-4 border-red-600' : 'text-[#aaaaaa] hover:bg-[#202020] border-l-4 border-transparent'}`}
                        >
                            <HardDrive className="w-4 h-4" />
                            Database
                        </button>
                        <button
                            onClick={() => setActiveTab('display')}
                            className={`w-full px-6 py-3 text-left flex items-center gap-3 transition-colors text-sm font-semibold cursor-pointer ${activeTab === 'display' ? 'bg-[#303030] text-white border-l-4 border-red-600' : 'text-[#aaaaaa] hover:bg-[#202020] border-l-4 border-transparent'}`}
                        >
                            <Monitor className="w-4 h-4" />
                            Display
                        </button>
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`w-full px-6 py-3 text-left flex items-center gap-3 transition-colors text-sm font-semibold cursor-pointer ${activeTab === 'history' ? 'bg-[#303030] text-white border-l-4 border-red-600' : 'text-[#aaaaaa] hover:bg-[#202020] border-l-4 border-transparent'}`}
                        >
                            <History className="w-4 h-4" />
                            History
                        </button>
                        <button
                            onClick={() => setActiveTab('plugins')}
                            className={`w-full px-6 py-3 text-left flex items-center gap-3 transition-colors text-sm font-semibold cursor-pointer ${activeTab === 'plugins' ? 'bg-[#303030] text-white border-l-4 border-red-600' : 'text-[#aaaaaa] hover:bg-[#202020] border-l-4 border-transparent'}`}
                        >
                            <Cpu className="w-4 h-4" />
                            Plugins
                        </button>
                    </div>

                    {/* Content Area */}
                    <div className="flex-1 p-8 overflow-y-auto bg-[#0f0f0f]">
                        {activeTab === 'api' && (
                            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                                <div>
                                    <h3 className="text-base font-bold mb-1">YouTube Data API</h3>
                                    <p className="text-xs text-[#aaaaaa] mb-4">Required for fetching high-quality transcripts and searching channel history.</p>

                                    {hasKey ? (
                                        <div className="flex gap-3 items-center">
                                            <div className="flex-1 bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-2.5 rounded-lg flex items-center gap-2 font-medium">
                                                <Check className="w-4 h-4" />
                                                API Key is Active
                                            </div>
                                            <button
                                                onClick={handleRemoveApiKey}
                                                disabled={loading}
                                                className="bg-[#272727] border border-[#303030] hover:bg-[#3f3f3f] text-red-500 px-4 py-2.5 rounded-lg font-bold text-xs transition-colors cursor-pointer"
                                            >
                                                Deactivate
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2">
                                            <input
                                                type="password"
                                                placeholder="Paste your YouTube API key..."
                                                value={apiKeyInput}
                                                onChange={(e) => setApiKeyInput(e.target.value)}
                                                className="flex-1 bg-[#121212] border border-[#303030] hover:border-[#505050] focus:border-red-600/50 outline-none rounded-lg px-4 py-2.5 text-sm text-white placeholder-[#505050] transition-colors"
                                            />
                                            <button
                                                onClick={handleSaveApiKey}
                                                disabled={loading || !apiKeyInput.trim()}
                                                className="bg-white text-black hover:bg-[#e5e5e5] disabled:opacity-50 px-6 py-2.5 rounded-lg font-bold text-xs transition-colors cursor-pointer"
                                            >
                                                Submit
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'db' && dbDetails && (
                            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                                <div>
                                    <h3 className="text-base font-bold mb-4">Storage Management</h3>

                                    <div className="grid grid-cols-3 gap-4 mb-6">
                                        <div className="bg-[#121212] border border-[#303030] p-4 rounded-xl">
                                            <span className="text-[10px] uppercase font-bold text-[#aaaaaa] tracking-widest block mb-1">Videos Stored</span>
                                            <span className="text-xl font-bold text-white">{dbDetails.video_count}</span>
                                        </div>
                                        <div className="bg-[#121212] border border-[#303030] p-4 rounded-xl">
                                            <span className="text-[10px] uppercase font-bold text-[#aaaaaa] tracking-widest block mb-1">Search History</span>
                                            <span className="text-xl font-bold text-white">{dbDetails.history_count}</span>
                                        </div>
                                        <div className="bg-[#121212] border border-[#303030] p-4 rounded-xl">
                                            <span className="text-[10px] uppercase font-bold text-[#aaaaaa] tracking-widest block mb-1">Database Size</span>
                                            <span className="text-xl font-bold text-white">{formatSize(dbDetails.size_bytes)}</span>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <div>
                                            <span className="text-[10px] uppercase font-bold text-[#aaaaaa] tracking-widest block mb-2">Location</span>
                                            <code className="block w-full bg-black/40 border border-[#303030] p-3 rounded-lg text-[11px] text-[#888888] break-all select-all font-mono">
                                                {dbDetails.path}
                                            </code>
                                        </div>

                                        <button
                                            onClick={openDbLocation}
                                            className="w-full bg-[#272727] border border-[#303030] hover:bg-[#3f3f3f] text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer mt-4"
                                        >
                                            <Database className="w-4 h-4" />
                                            Open Folder Location
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeTab === 'display' && (
                            <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                                <div>
                                    <h3 className="text-base font-bold mb-6">Appearance</h3>

                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <span className="text-sm font-semibold text-white block">Window Resolution</span>
                                                <span className="text-xs text-[#aaaaaa]">Choose your preferred window dimensions</span>
                                            </div>
                                            <select
                                                value={displaySettings.resolution}
                                                onChange={(e) => handleUpdateDisplay({ resolution: e.target.value })}
                                                className="bg-[#121212] border border-[#303030] text-sm text-white rounded-lg px-4 py-2 outline-none cursor-pointer hover:bg-[#202020] transition-colors"
                                            >
                                                {resolutions.map(res => (
                                                    <option key={res} value={res}>{res}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div>
                                                <span className="text-sm font-semibold text-white block">Full Screen Mode</span>
                                                <span className="text-xs text-[#aaaaaa]">Expand Kinesis to fill your primary monitor</span>
                                            </div>
                                            <button
                                                onClick={() => handleUpdateDisplay({ fullscreen: !displaySettings.fullscreen })}
                                                className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer ${displaySettings.fullscreen ? 'bg-red-600' : 'bg-[#303030]'}`}
                                            >
                                                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${displaySettings.fullscreen ? 'left-7' : 'left-1'}`} />
                                            </button>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div>
                                                <span className="text-sm font-semibold text-white block">Theme</span>
                                                <span className="text-xs text-[#aaaaaa]">Switch between light and dark mode</span>
                                            </div>
                                            <button
                                                onClick={() => {
                                                    const newTheme = displaySettings.theme === 'dark' ? 'light' : 'dark';
                                                    handleUpdateDisplay({ theme: newTheme });
                                                    // Toggle dark class for Tailwind
                                                    document.documentElement.classList.toggle('dark', newTheme === 'dark');
                                                    // Notify parent
                                                    onThemeChange?.(newTheme);
                                                }}
                                                className={`w-14 h-7 rounded-full transition-colors relative cursor-pointer flex items-center px-0.5 ${displaySettings.theme === 'dark' ? 'bg-purple-600' : 'bg-yellow-400'}`}
                                            >
                                                <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-all flex items-center justify-center shadow-md ${displaySettings.theme === 'dark' ? 'left-0.5' : 'left-7'}`}>
                                                    {displaySettings.theme === 'dark' ? (
                                                        <Moon className="w-3.5 h-3.5 text-purple-800" />
                                                    ) : (
                                                        <Sun className="w-3.5 h-3.5 text-yellow-600" />
                                                    )}
                                                </div>
                                            </button>
                                        </div>

                                        <div className="flex items-center justify-between">
                                            <div>
                                                <span className="text-sm font-semibold text-white block">Video List Layout</span>
                                                <span className="text-xs text-[#aaaaaa]">Choose between grid and compact layout</span>
                                            </div>
                                            <div className="flex gap-2 bg-[#121212] border border-[#303030] rounded-md p-0.5">
                                                <button
                                                    onClick={() => handleUpdateDisplay({ videoListMode: 'grid' })}
                                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${currentVideoListMode === 'grid'
                                                        ? 'bg-white text-black shadow-lg scale-[1.02]'
                                                        : 'text-[#888888] hover:text-white hover:bg-white/5'
                                                        }`}
                                                >
                                                    <LayoutGrid className="w-3.5 h-3.5" />
                                                    Grid
                                                </button>

                                                <button
                                                    onClick={() => handleUpdateDisplay({ videoListMode: 'compact' })}
                                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold transition-all cursor-pointer ${currentVideoListMode === 'compact'
                                                        ? 'bg-white text-black shadow-lg scale-[1.02]'
                                                        : 'text-[#888888] hover:text-white hover:bg-white/5'
                                                        }`}
                                                >
                                                    <List className="w-3.5 h-3.5" />
                                                    Compact
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {activeTab === 'history' && (() => {
                            // Group entries by date
                            const grouped: Record<string, HistoryEntry[]> = {};
                            historyEntries.forEach(e => {
                                const date = e.searchedAt.split(' ')[0]; // YYYY-MM-DD
                                if (!grouped[date]) grouped[date] = [];
                                grouped[date].push(e);
                            });
                            const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

                            const handleClearDate = async (date: string) => {
                                await clearHistoryBeforeDate(date);
                                setHistoryEntries(prev => prev.filter(e => e.searchedAt.split(' ')[0] !== date));
                            };

                            const handleDeleteEntry = async (id: number) => {
                                await deleteHistoryEntry(id);
                                setHistoryEntries(prev => prev.filter(e => e.id !== id));
                            };

                            const handleClearAll = async () => {
                                await clearAllHistory();
                                setHistoryEntries([]);
                            };

                            return (
                                <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-base font-bold mb-1">Search History</h3>
                                            <p className="text-xs text-[#aaaaaa]">{historyEntries.length} saved searches across {dates.length} day(s)</p>
                                        </div>
                                        {historyEntries.length > 0 && (
                                            <button
                                                onClick={handleClearAll}
                                                className="bg-[#272727] border border-[#303030] hover:bg-[#3f3f3f] text-red-500 px-4 py-2.5 rounded-lg font-bold text-xs transition-colors cursor-pointer flex items-center gap-2"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                Clear All
                                            </button>
                                        )}
                                    </div>

                                    {historyEntries.length === 0 ? (
                                        <div className="text-center py-16 text-[#555]">
                                            <History className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                            <p className="text-sm font-medium">No search history yet.</p>
                                            <p className="text-xs mt-1">Searches you make will appear here.</p>
                                        </div>
                                    ) : (
                                        <div className="max-h-[340px] overflow-y-auto pr-1 space-y-6">
                                            {dates.map(date => (
                                                <div key={date}>
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <Clock className="w-3.5 h-3.5 text-gray-400 dark:text-[#555]" />
                                                            <span className="text-[11px] font-bold text-gray-400 dark:text-[#555] uppercase tracking-widest">
                                                                {new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                                                            </span>
                                                        </div>
                                                        <button
                                                            onClick={() => handleClearDate(date)}
                                                            className="text-[10px] font-bold text-gray-400 dark:text-[#555] hover:text-red-500 transition-colors cursor-pointer flex items-center gap-1"
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                            Clear day
                                                        </button>
                                                    </div>
                                                    <div className="bg-gray-50 dark:bg-[#141414] border border-gray-200 dark:border-[#222] rounded-xl overflow-hidden divide-y divide-gray-100 dark:divide-[#1e1e1e]">
                                                        {grouped[date].map(entry => (
                                                            <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 group hover:bg-gray-100 dark:hover:bg-white/[0.02] transition-colors">
                                                                <Clock className="w-3 h-3 text-gray-300 dark:text-[#444] shrink-0" />
                                                                <span className="flex-1 text-sm text-gray-600 dark:text-[#aaaaaa] truncate">{entry.query}</span>
                                                                <span className="text-[10px] text-gray-400 dark:text-[#444] shrink-0">
                                                                    {entry.searchedAt.split(' ')[1]?.slice(0, 5) ?? ''}
                                                                </span>
                                                                <button
                                                                    onClick={() => handleDeleteEntry(entry.id)}
                                                                    className="p-1 hover:text-red-500 text-gray-300 dark:text-[#444] transition-all cursor-pointer shrink-0"
                                                                    title="Remove"
                                                                >
                                                                    <X className="w-3 h-3" />
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {activeTab === 'plugins' && (
                            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                                <div>
                                    <h3 className="text-base font-bold mb-1">Plugins</h3>
                                    <p className="text-xs text-[#aaaaaa] mb-6">Extend Kinesis with modular functionalities powered by external services.</p>

                                    <div className="space-y-4">
                                        {plugins.map(plugin => (
                                            <div key={plugin.id} className="bg-[#121212] border border-[#303030] rounded-xl p-5 group hover:border-[#404040] transition-all">
                                                <div className="flex items-start justify-between">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-1">
                                                            <div className="p-2 text-gray-400">
                                                                <Cpu className="w-4 h-4" />
                                                            </div>
                                                            <h4 className="text-sm font-bold text-white">{plugin.name}</h4>
                                                        </div>
                                                        <p className="text-[11px] text-[#aaaaaa] leading-relaxed max-w-sm mb-4">
                                                            {plugin.description}
                                                        </p>
                                                    </div>

                                                    <div className="ml-6 shrink-0">
                                                        <button
                                                            onClick={async () => {
                                                                const newState = !plugin.enabled;
                                                                if (newState && plugin.id === 'summarize') {
                                                                    setLoading(true);
                                                                    setPluginStatus("Checking Ollama...");
                                                                    try {
                                                                        const isOllamaRunning = await checkOllama();
                                                                        if (!isOllamaRunning) {
                                                                            await installOllama();
                                                                            // Poll for Ollama startup
                                                                            setPluginStatus("Waiting for Ollama to start...");
                                                                            let retry = 0;
                                                                            while (retry < 60) {
                                                                                await new Promise(r => setTimeout(r, 2000));
                                                                                if (await checkOllama()) break;
                                                                                retry++;
                                                                            }
                                                                        }
                                                                        await pullModel();
                                                                        await setSetting(`plugin_${plugin.id}_enabled`, "true");
                                                                        setPlugins(prev => prev.map(p => p.id === plugin.id ? { ...p, enabled: true } : p));
                                                                        onPluginsChange?.();
                                                                        setPluginStatus(null);
                                                                    } catch (err) {
                                                                        setPluginStatus(String(err));
                                                                    } finally {
                                                                        setLoading(false);
                                                                    }
                                                                } else {
                                                                    setLoading(true);
                                                                    try {
                                                                        // On uninstall, delete the model
                                                                        if (!newState && plugin.id === 'summarize') {
                                                                            setPluginStatus("Removing llama3.2 model...");
                                                                            await deleteModel();
                                                                        }
                                                                        await setSetting(`plugin_${plugin.id}_enabled`, newState.toString());
                                                                        setPlugins(prev => prev.map(p =>
                                                                            p.id === plugin.id ? { ...p, enabled: newState } : p
                                                                        ));
                                                                        onPluginsChange?.();
                                                                        setPluginStatus(null);
                                                                    } catch (err) {
                                                                        setPluginStatus(String(err));
                                                                    } finally {
                                                                        setLoading(false);
                                                                    }
                                                                }
                                                            }}
                                                            disabled={loading}
                                                            className={`px-4 py-2.5 rounded-lg font-bold text-xs transition-colors cursor-pointer bg-[#272727] border border-[#303030] hover:bg-[#3f3f3f] ${loading ? 'opacity-50 cursor-not-allowed' : ''} ${plugin.enabled
                                                                ? 'text-red-500'
                                                                : 'text-white'
                                                                }`}
                                                        >
                                                            {plugin.enabled ? 'Uninstall' : 'Install'}
                                                        </button>
                                                    </div>
                                                </div>
                                                {pluginStatus && plugin.id === 'summarize' && (
                                                    <div className={`mt-4 p-3 border rounded-lg animate-in slide-in-from-top-2 ${loading ? 'bg-red-900/10 border-red-900/20' : 'bg-red-500/10 border-red-500/20'}`}>
                                                        <div className="flex items-center gap-3">
                                                            {loading && <div className="w-3 h-3 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />}
                                                            <span className={`text-[11px] font-bold uppercase tracking-wider ${loading ? 'text-red-500' : 'text-red-400'}`}>{pluginStatus}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
