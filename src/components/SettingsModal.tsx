import { X, Settings, Database, Check, Monitor, Key, HardDrive } from "lucide-react";
import { useState, useEffect } from "react";
import {
    getApiKey,
    setApiKey as saveApiKeyCmd,
    removeApiKey as removeApiKeyCmd,
    openDbLocation,
    getDbDetails,
    getDisplaySettings,
    setDisplaySettings,
    type DbDetails,
    type DisplaySettings
} from "../api";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onStatusChange: (hasKey: boolean) => void;
}

type Tab = 'api' | 'db' | 'display';

export function SettingsModal({ isOpen, onClose, onStatusChange }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('api');
    const [hasKey, setHasKey] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState("");
    const [loading, setLoading] = useState(false);

    const [dbDetails, setDbDetails] = useState<DbDetails | null>(null);
    const [displaySettings, setDisplaySettingsState] = useState<DisplaySettings>({
        resolution: '1440x900',
        fullscreen: false
    });

    useEffect(() => {
        if (isOpen) {
            setLoading(true);
            Promise.all([
                getApiKey(),
                getDbDetails(),
                getDisplaySettings()
            ]).then(([key, db, display]) => {
                setHasKey(!!key);
                setApiKeyInput("");
                setDbDetails(db);
                setDisplaySettingsState(display);
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

                                    <div className="grid grid-cols-2 gap-4 mb-6">
                                        <div className="bg-[#121212] border border-[#303030] p-4 rounded-xl">
                                            <span className="text-[10px] uppercase font-bold text-[#aaaaaa] tracking-widest block mb-1">Video Metadata Stored</span>
                                            <span className="text-xl font-bold text-white">{dbDetails.video_count}</span>
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
