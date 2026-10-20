import { useState, useEffect, useRef } from "react";
import type { ChangeEvent, MouseEvent, KeyboardEvent } from "react";
import { Check, Trash2, Upload, Copy } from "lucide-react";
import { type DisplaySettings } from "../../api";
import { useLockedSettings, LOCKED_TITLE } from "../../hooks/useLockedSettings";
import { useFlags } from "../../hooks/useFlags";
import { Select } from "../ui/Select";
import {
    BUILTIN_THEMES, applyTheme, loadCustomThemes, saveCustomThemes,
    parseThemeJson, isThemeError, resolveTheme, syntaxOf, type Theme,
    BLOCKQUOTE_ACCENT_COLOR_KEYS, resolveBlockquoteColor,
} from "../../lib/themes";

interface Props {
    settings: DisplaySettings;
    onUpdate: (updates: Partial<DisplaySettings>) => void;
}

const SUB_TABS: { id: "workspace" | "content"; label: string }[] = [
    { id: "workspace", label: "Workspace Theme" },
    { id: "content", label: "Content Theme" },
];

export function ThemeTab({ settings, onUpdate }: Props) {
    const [subTab, setSubTab] = useState<"workspace" | "content">("workspace");
    const [customThemes, setCustomThemes] = useState<Theme[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadCustomThemes().then(setCustomThemes).finally(() => setLoading(false));
    }, []);

    const activeName = settings.theme;
    const isLocked = useLockedSettings();
    const themeLocked = isLocked('theme');
    const themesLocked = themeLocked || isLocked('customThemes');
    const { flags } = useFlags();
    const customAllowed = flags.allowCustomThemes;

    const handleSelect = (theme: Theme) => {
        if (themeLocked) return;
        applyTheme(theme, settings.blockquoteAccentEnabled ? settings.blockquoteAccentColor : null);
        onUpdate({ theme: theme.name });
    };

    const handleImportClick = () => {
        if (themesLocked || !customAllowed) return;
        setError(null);
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            const fallbackName = file.name.replace(/\.json$/i, '');
            const result = parseThemeJson(text, fallbackName);
            if (isThemeError(result)) {
                setError(result.error);
                return;
            }
            setError(null);
            const next = [...customThemes.filter(t => t.name !== result.name), result];
            setCustomThemes(next);
            await saveCustomThemes(next);
            handleSelect(result);
        };
        reader.onerror = () => setError("Couldn't read that file.");
        reader.readAsText(file);
    };

    const handleCopyTemplate = async () => {
        const solarized = BUILTIN_THEMES.find(t => t.name === 'solarized');
        if (!solarized) return;
        const template = { name: 'My Custom Theme', scheme: solarized.scheme, colors: solarized.colors, syntax: syntaxOf(solarized) };
        try {
            await navigator.clipboard.writeText(JSON.stringify(template, null, 2));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            setError("Couldn't copy to clipboard.");
        }
    };

    const handleDelete = async (theme: Theme, e: MouseEvent) => {
        e.stopPropagation();
        if (themesLocked || !customAllowed) return;
        const next = customThemes.filter(t => t.name !== theme.name);
        setCustomThemes(next);
        await saveCustomThemes(next);
        if (activeName === theme.name) {
            handleSelect(resolveTheme(undefined, next));
        }
    };

    const handleCardKeyDown = (theme: Theme, e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect(theme);
        }
    };

    const allThemes = [...BUILTIN_THEMES, ...customThemes];
    const contentInherit = settings.contentThemeInherit !== false;
    const contentTheme = settings.contentTheme || 'dark';

    const isCustomBlockquote = !!settings.blockquoteAccentColor && !['system', ...BLOCKQUOTE_ACCENT_COLOR_KEYS].includes(settings.blockquoteAccentColor);
    const selectedBlockquoteKey = isCustomBlockquote ? 'custom' : (settings.blockquoteAccentColor || 'blue');
    const resolvedBlockquoteColor = resolveBlockquoteColor(settings.blockquoteAccentColor || 'blue', resolveTheme(settings.theme, customThemes).colors.accent);

    const handleBlockquoteEnabledChange = (enabled: boolean) => {
        const activeTheme = resolveTheme(settings.theme, customThemes);
        applyTheme(activeTheme, enabled ? (settings.blockquoteAccentColor || 'blue') : null);
        onUpdate({ blockquoteAccentEnabled: enabled });
    };

    const handleBlockquoteColorChange = (color: string) => {
        const activeTheme = resolveTheme(settings.theme, customThemes);
        if (settings.blockquoteAccentEnabled) {
            applyTheme(activeTheme, color);
        }
        onUpdate({ blockquoteAccentColor: color });
    };

    return (
        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
            <div className="flex items-center gap-4 pb-1">
                {SUB_TABS.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSubTab(tab.id)}
                        className={`pb-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer relative ${subTab === tab.id ? "text-white" : "text-[#666666] hover:text-[#aaaaaa]"}`}
                    >
                        {tab.label}
                        {subTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--k-accent)]" />}
                    </button>
                ))}
            </div>

            {subTab === 'workspace' && (
                <div>
                    <h3 className="text-base font-bold mb-2">Workspace Theme</h3>
                    <p className="text-xs text-[#aaaaaa] mb-6">{themeLocked ? "Your theme is managed by your sync server." : "Choose a color theme, or import your own."}</p>
                    {loading ? (<div className="text-center text-gray-500 text-xs py-8">Loading...</div>) : (
                        <div className="grid grid-cols-2 gap-2">
                            {allThemes.map(theme => (
                                <div
                                    key={theme.name}
                                    role="button"
                                    tabIndex={themeLocked ? -1 : 0}
                                    aria-disabled={themeLocked}
                                    aria-pressed={activeName === theme.name}
                                    onClick={() => handleSelect(theme)}
                                    onKeyDown={(e) => handleCardKeyDown(theme, e)}
                                    title={themeLocked ? LOCKED_TITLE : undefined}
                                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                                        themeLocked ? 'cursor-default opacity-60' : 'cursor-pointer'
                                    } ${
                                        activeName === theme.name
                                            ? 'border-[var(--k-accent)] bg-[#202020]'
                                            : 'border-[#303030] bg-[#161616] hover:border-[#505050]'
                                    }`}
                                >
                                    <span className="flex w-10 h-4 rounded-[8px_2px_8px_2px] overflow-hidden border border-[#808080]/35 shrink-0">
                                        <span className="flex-1" style={{ backgroundColor: theme.colors.bg }} />
                                        <span className="w-px bg-[#808080]/35" />
                                        <span className="flex-1" style={{ backgroundColor: theme.colors.surface }} />
                                        <span className="w-px bg-[#808080]/35" />
                                        <span className="flex-1" style={{ backgroundColor: theme.colors.accent }} />
                                    </span>
                                    <span className="flex-1 text-sm font-semibold text-white truncate">{theme.label}</span>
                                    {activeName === theme.name && <Check className="w-4 h-4 text-[var(--k-accent)] shrink-0" />}
                                    {!theme.builtin && customAllowed && (
                                        <button onClick={(e) => handleDelete(theme, e)} title="Remove theme" className="text-gray-500 hover:text-red-400 transition-colors cursor-pointer p-0.5 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {customAllowed && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            <button onClick={handleImportClick} disabled={themesLocked} title={themesLocked ? LOCKED_TITLE : undefined} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-[#404040] text-[11px] font-semibold text-[#aaaaaa] hover:text-white hover:border-[#505050] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"><Upload className="w-4 h-4" />Import Theme</button>
                            <button onClick={handleCopyTemplate} title="Copy template" className="flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-[#404040] text-[11px] font-semibold text-[#aaaaaa] hover:text-white hover:border-[#505050] transition-colors cursor-pointer">{copied ? <Check className="w-4 h-4 text-[var(--k-success)]" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied!' : 'Copy Template'}</button>
                            <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleFileChange} className="hidden" />
                        </div>
                    )}
                    {error && (<div className="mt-3 text-[10px] text-red-400 bg-red-900/20 border border-red-500/30 rounded-md px-2 py-1.5">{error}</div>)}
                </div>
            )}

            {subTab === 'content' && (
                <div className="space-y-6">
                    <div>
                        <h3 className="text-base font-bold mb-1">Content Theme</h3>
                        <p className="text-xs text-[#aaaaaa]">Customize themes and blockquote styles for readable content.</p>
                    </div>

                     <div className="space-y-4">
                         <div className={contentInherit ? "" : "border-b border-[#272727] pb-2"}>
                             <label className="flex items-center justify-between cursor-pointer mb-3">
                                 <div>
                                     <span className="text-sm font-medium text-white block">Inherit Workspace Theme</span>
                                     <span className="text-xs text-gray-400">When enabled, content shares the primary workspace theme</span>
                                 </div>
                                 <input
                                     type="checkbox"
                                     checked={contentInherit}
                                     onChange={(e) => onUpdate({ contentThemeInherit: e.target.checked })}
                                     className="mt-0.5 shrink-0 cursor-pointer"
                                 />
                             </label>

                             {!contentInherit && (
                                 <div className="space-y-1.5 pl-3 border-l-2 border-[#383838] mb-4">
                                     <label className="block text-xs font-semibold text-gray-300">Theme</label>
                                     <Select
                                         look="setting"
                                         value={contentTheme}
                                         onValueChange={v => onUpdate({ contentTheme: v })}
                                         wrapperClassName="w-full"
                                         className="w-full"
                                     >
                                         {allThemes.map(t => (
                                             <option key={t.name} value={t.name}>{t.label} ({t.scheme})</option>
                                         ))}
                                     </Select>
                                 </div>
                             )}
                         </div>

                         {!contentInherit && (
                             <>
                                 <label className="flex items-center justify-between cursor-pointer">
                                     <div>
                                         <span className="text-sm font-medium text-white block">Enable for Calendar</span>
                                         <span className="text-xs text-gray-400">Applies to the calendar in the Calendar section</span>
                                     </div>
                                     <input
                                         type="checkbox"
                                         checked={!!settings.contentThemeCalendarEnabled}
                                         onChange={(e) => onUpdate({ contentThemeCalendarEnabled: e.target.checked })}
                                         className="mt-0.5 shrink-0 cursor-pointer"
                                     />
                                 </label>

                                 <label className="flex items-center justify-between cursor-pointer">
                                     <div>
                                         <span className="text-sm font-medium text-white block">Enable for Notes</span>
                                         <span className="text-xs text-gray-400">Applies to the note in the Notes section</span>
                                     </div>
                                     <input
                                         type="checkbox"
                                         checked={!!settings.contentThemeNotesEnabled}
                                         onChange={(e) => onUpdate({ contentThemeNotesEnabled: e.target.checked })}
                                         className="mt-0.5 shrink-0 cursor-pointer"
                                     />
                                 </label>

                                 <label className="flex items-center justify-between cursor-pointer">
                                     <div>
                                         <span className="text-sm font-medium text-white block">Enable for Logs</span>
                                         <span className="text-xs text-gray-400">Applies to the log in the Log section</span>
                                     </div>
                                     <input
                                         type="checkbox"
                                         checked={!!settings.contentThemeLogsEnabled}
                                         onChange={(e) => onUpdate({ contentThemeLogsEnabled: e.target.checked })}
                                         className="mt-0.5 shrink-0 cursor-pointer"
                                     />
                                 </label>
                             </>
                         )}

                        <div className="pt-2 border-t border-[#272727]">
                            <label className="flex items-center justify-between cursor-pointer mb-3">
                                <div>
                                    <span className="text-sm font-medium text-white block">Override Default Blockquote Accent</span>
                                    <span className="text-xs text-gray-400">Choose a custom border accent color for quotes and callouts</span>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={!!settings.blockquoteAccentEnabled}
                                    onChange={(e) => handleBlockquoteEnabledChange(e.target.checked)}
                                    className="mt-0.5 shrink-0 cursor-pointer"
                                />
                            </label>

                            {!!settings.blockquoteAccentEnabled && (
                                <div className="space-y-3 pl-3 border-l-2 border-[#383838]">
                                    <div>
                                        <label className="block text-xs font-semibold text-gray-300 mb-1.5">Blockquote Accent Color</label>
                                        <div className="flex items-center gap-2">
                                            <span
                                                className="w-5 h-5 rounded-full border border-white/20 shrink-0 shadow-sm"
                                                style={{ backgroundColor: resolvedBlockquoteColor }}
                                            />
                                            <Select
                                                look="setting"
                                                value={selectedBlockquoteKey}
                                                onValueChange={v => {
                                                    if (v === 'custom') {
                                                        handleBlockquoteColorChange(isCustomBlockquote ? (settings.blockquoteAccentColor || '#3b82f6') : '#3b82f6');
                                                    } else {
                                                        handleBlockquoteColorChange(v);
                                                    }
                                                }}
                                                className="flex-1"
                                            >
                                                <option value="system">System Accent Color</option>
                                                {BLOCKQUOTE_ACCENT_COLOR_KEYS.map(c => (
                                                    <option key={c} value={c}>{c.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()}</option>
                                                ))}
                                                <option value="custom">Custom...</option>
                                            </Select>
                                        </div>
                                    </div>

                                    {selectedBlockquoteKey === 'custom' && (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={resolvedBlockquoteColor.startsWith('#') && resolvedBlockquoteColor.length === 7 ? resolvedBlockquoteColor : '#3b82f6'}
                                                onChange={(e) => handleBlockquoteColorChange(e.target.value)}
                                                className="h-8 w-10 cursor-pointer rounded border border-[#404040] bg-transparent p-0.5"
                                                title="Pick custom color"
                                            />
                                            <input
                                                type="text"
                                                value={settings.blockquoteAccentColor || ''}
                                                onChange={(e) => handleBlockquoteColorChange(e.target.value)}
                                                placeholder="#3b82f6 or CSS color"
                                                className="flex-1 px-3 py-1.5 bg-[#121212] border border-[#303030] rounded-lg text-white text-xs font-mono focus:outline-none focus:border-[var(--k-accent)]"
                                            />
                                        </div>
                                    )}

                                    <div
                                        className="p-3 rounded-r-lg border-l-4 text-xs italic"
                                        style={{
                                            borderLeftColor: resolvedBlockquoteColor,
                                            backgroundColor: `color-mix(in srgb, ${resolvedBlockquoteColor} 8%, transparent)`,
                                            color: 'var(--k-text-white)',
                                        }}
                                    >
                                        "This is a preview of your blockquote with the chosen accent color."
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}