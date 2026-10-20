import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { ChevronRight, ChevronDown, FolderTree, Inbox, ListVideo, MoreVertical, Search, X } from 'lucide-react';
import {
    decodeWdbs, encodeWdbs, getWdbsAliases, listDriveSequences, setWdbsAlias, setWdbsIcon, setWdbsColor, setWdbsShape, SEQUENCES_CHANGED_EVENT, UNSORTED_WDBS_FILTER,
    type SequenceSummary, type WdbsNode,
} from '../api';
import { useWorkspace } from '../hooks/useWorkspace';
import { openInternalLink } from '../lib/internal-links';
import { handlePlainContextMenu } from '../lib/markdown-editor';
import { driveSegmentLabel } from '../lib/utils';
import { HoverDates } from './HoverDates';
import { PlaylistThumb } from './SequenceCard';
import { WdbsAliasMenu } from './WdbsAliasMenu';
import { MENU_PANEL, MENU_ROW } from './ContextMenu';
import { WdbsIconMenu } from './WdbsIconMenu';
import { WdbsColorMenu } from './WdbsColorMenu';
import { getWdbsIconComponent } from '../lib/wdbs-icons';
import { getWdbsColorValue } from '../lib/wdbs-colors';
import { WdbsShapeSwatch } from '../lib/wdbs-shapes';

interface WdbsTreePanelProps {
    // `undefined` means nothing is selected; a real path selects that node (and its descendants
    // — see db/wdbs.rs::list_videos_by_wdbs) elsewhere in whatever's consuming the selection.
    selectedPath: string | undefined;
    // `alias` is the node's own curated alias (null when it doesn't have one) — the caller shows
    // it alongside the path/label, e.g. App.tsx's "Drive: X (alias)" bottom-bar chip, rather than
    // this panel rendering its own alias display (it used to, directly below the tree; removed in
    // favor of that one shared spot).
    onSelect: (path: string, label: string, alias: string | null) => void;
    className?: string;
    // Gates the right-click "Edit Alias"/"Edit Icon" menu, same settings flag (allowEditWDBS)
    // that gates Bulk Assign Mode and the Sidebar's Warp Drive editor — see App.tsx.
    allowEditAlias?: boolean;
    // Whether sequences are switched on (flags.showSequences): with them, the heading has a toggle between the tree
    // and the list of every Drive's sequence.
    showSequences?: boolean;
    // The tree's data and which branches are expanded, owned by the caller (App.tsx, via
    // hooks/useWdbsTree) rather than by this component — App.tsx never unmounts, so state living
    // there survives this panel unmounting/remounting every time the user leaves and returns to
    // the Library view (its own viewMode switch), instead of forcing a full refetch (and losing
    // which branches were open) on every return for no reason. `setTree` is what this panel's own
    // alias/icon/color/shape edits patch directly (see patchNodeInTree) — a real WDBS *assignment*
    // change is what actually bumps App.tsx's driveVersion and triggers a genuine refetch.
    tree: WdbsNode[];
    setTree: Dispatch<SetStateAction<WdbsNode[]>>;
    unsortedCount: number;
    loading: boolean;
    expanded: Set<string>;
    setExpanded: Dispatch<SetStateAction<Set<string>>>;
}

/** Where the panel's view (the tree, or the list of sequences) is remembered: this reader's, in this browser. */
const VIEW_KEY = 'kinesis.library.driveView';

/** The paths of the nodes above `path` (root first), or null when `path` isn't in the tree. */
function ancestorPaths(nodes: WdbsNode[], path: string, trail: string[] = []): string[] | null {
    for (const node of nodes) {
        if (node.path === path) return trail;
        const found = ancestorPaths(node.children, path, [...trail, node.path]);
        if (found) return found;
    }
    return null;
}

/** Applies `patch` to the one node at `path`, leaving everything else untouched — used after an
 *  alias/icon/color/shape edit succeeds instead of a full tree refetch. Safe specifically because
 *  none of those four ever change a node's count, children, or which nodes exist at all (that's
 *  determined purely by videos.WDBS/VideoWDBSLinks, not by anything curated in tblWDBS) — a WDBS
 *  *assignment* change is a different path entirely (App.tsx's driveVersion, which hooks/useWdbsTree
 *  refetches on), not something this component edits itself. */
function patchNodeInTree(nodes: WdbsNode[], path: string, patch: Partial<WdbsNode>): WdbsNode[] {
    return nodes.map(node => {
        if (node.path === path) return { ...node, ...patch };
        if (node.children.length === 0) return node;
        const children = patchNodeInTree(node.children, path, patch);
        return children === node.children ? node : { ...node, children };
    });
}

// The right-click menu itself — just picks which editor (WdbsAliasMenu/WdbsIconMenu) to open next,
// so it's a plain two-row list rather than its own separate component file.
function NodeContextMenu({ x, y, onEditAlias, onEditIcon, onEditColor, onClose }: {
    x: number;
    y: number;
    onEditAlias: () => void;
    onEditIcon: () => void;
    onEditColor: () => void;
    onClose: () => void;
}) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    const MENU_WIDTH = 184;
    const left = Math.min(x, window.innerWidth - MENU_WIDTH - 12);
    const top = Math.min(y, window.innerHeight - 112);

    return (
        <div
            ref={containerRef}
            style={{ left, top, width: MENU_WIDTH }}
            className={`fixed z-[200] ${MENU_PANEL}`}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        >
            <button onClick={onEditAlias} className={`${MENU_ROW} text-gray-200`}>
                Edit Alias
            </button>
            <button onClick={onEditIcon} className={`${MENU_ROW} text-gray-200`}>
                Edit Category Marker
            </button>
            <button onClick={onEditColor} className={`${MENU_ROW} text-gray-200`}>
                Edit Decoration Marker
            </button>
        </div>
    );
}

/**
 * The Warp Drive taxonomy tree UI — built from the distinct WDBS values in use (see
 * db/wdbs.rs::get_wdbs_tree) — shown as a toggleable side panel next to the Library/Portal grid
 * (see App.tsx's Drive panel button). The tree's data and expand/collapse state are owned by the
 * caller (hooks/useWdbsTree), not this component, so they survive this panel unmounting when the
 * user leaves the Library view; selection itself is controlled by the caller too (wired into the
 * Library's own search/filter state).
 */
export function WdbsTreePanel({ selectedPath, onSelect, className, allowEditAlias = false, showSequences = false, tree, setTree, unsortedCount, loading, expanded, setExpanded }: WdbsTreePanelProps) {
    const { labels } = useWorkspace();
    // The tree, or the list of sequences: a toggle in the heading, remembered. With sequences switched off it's the tree.
    const [chosenView, setChosenView] = useState<'tree' | 'sequences'>(() => {
        try { return localStorage.getItem(VIEW_KEY) === 'sequences' ? 'sequences' : 'tree'; } catch { return 'tree'; }
    });
    const view = showSequences ? chosenView : 'tree';
    // What's typed over the list of sequences, to narrow it (by name, Drive, or first video).
    const [sequenceFilter, setSequenceFilter] = useState('');
    const pickView = (v: 'tree' | 'sequences') => {
        setChosenView(v);
        try { localStorage.setItem(VIEW_KEY, v); } catch { /* just not remembered */ }
    };
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: WdbsNode } | null>(null);
    const [aliasMenu, setAliasMenu] = useState<{ x: number; y: number; path: string; segment: string; alias: string } | null>(null);
    const [savingAlias, setSavingAlias] = useState(false);
    const [aliasError, setAliasError] = useState<string | null>(null);
    const [iconMenu, setIconMenu] = useState<{ x: number; y: number; path: string; segment: string; icon: string | null } | null>(null);
    const [savingIcon, setSavingIcon] = useState(false);
    const [iconError, setIconError] = useState<string | null>(null);
    const [colorMenu, setColorMenu] = useState<{ x: number; y: number; path: string; segment: string; color: string | null; shape: string | null } | null>(null);
    const [savingColor, setSavingColor] = useState(false);
    const [colorError, setColorError] = useState<string | null>(null);
    const label = labels.aliasDriveName;
    const sequencesLabel = `${labels.aliasSequence}s`;

    // A selection made from outside the tree (e.g. a Biography's "In Drive" list) may sit inside
    // collapsed branches, so open the ones above it.
    useEffect(() => {
        if (!selectedPath || tree.length === 0) return;
        const trail = ancestorPaths(tree, selectedPath);
        if (!trail || trail.length === 0) return;
        setExpanded(prev => (trail.every(p => prev.has(p)) ? prev : new Set([...prev, ...trail])));
    }, [selectedPath, tree]);

    const toggleExpanded = useCallback((path: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path); else next.add(path);
            return next;
        });
    }, []);

    const handleContextMenu = useCallback((node: WdbsNode, x: number, y: number) => {
        if (!allowEditAlias) return;
        setContextMenu({ x, y, node });
    }, [allowEditAlias]);

    const handleSaveAlias = useCallback(async (alias: string) => {
        if (!aliasMenu) return;
        setSavingAlias(true);
        setAliasError(null);
        try {
            await setWdbsAlias(aliasMenu.path, alias);
            // Mirrors get_wdbs_tree's own suppression exactly (build_nodes: `!a.is_empty() && *a
            // != segment`) — a blank alias, or one that just restates the segment name, renders
            // the same as "nothing curated" there, so it has to here too.
            const trimmed = alias.trim();
            const newAlias = trimmed === '' || trimmed === aliasMenu.segment ? null : trimmed;
            setTree(prev => patchNodeInTree(prev, aliasMenu.path, { alias: newAlias }));
            setAliasMenu(null);
        } catch (e: any) {
            setAliasError(typeof e === "string" ? e : e?.message ?? "Couldn't save that alias.");
        } finally {
            setSavingAlias(false);
        }
    }, [aliasMenu]);

    // Picking an icon keeps the popover open, like the color decoration's: the user may be trying a few to see which
    // looks best in the tree. The iconMenu.icon update moves the popover's highlight to the new pick.
    const handleSelectIcon = useCallback(async (icon: string) => {
        if (!iconMenu) return;
        setSavingIcon(true);
        setIconError(null);
        try {
            await setWdbsIcon(iconMenu.path, icon);
            setTree(prev => patchNodeInTree(prev, iconMenu.path, { icon: icon || null }));
            setIconMenu(m => m && { ...m, icon: icon || null });
        } catch (e: any) {
            setIconError(typeof e === "string" ? e : e?.message ?? "Couldn't save that icon.");
        } finally {
            setSavingIcon(false);
        }
    }, [iconMenu]);

    // Picking a color/shape keeps the popover open (unlike WdbsAliasMenu, which has exactly one
    // thing to set) — there are two independent choices to make here, so closing
    // after the first would just force a re-open through the context menu to set the second. The
    // colorMenu.color/shape update keeps the popover's own highlighting and shape previews in
    // sync; patching `tree` directly (rather than a fetchTree() round trip) is what the actual
    // row's chip picks up from.
    const handleSelectColor = useCallback(async (color: string) => {
        if (!colorMenu) return;
        setSavingColor(true);
        setColorError(null);
        try {
            await setWdbsColor(colorMenu.path, color);
            setTree(prev => patchNodeInTree(prev, colorMenu.path, { color: color || null }));
            setColorMenu(m => m && { ...m, color: color || null });
        } catch (e: any) {
            setColorError(typeof e === "string" ? e : e?.message ?? "Couldn't save that color.");
        } finally {
            setSavingColor(false);
        }
    }, [colorMenu]);

    const handleSelectShape = useCallback(async (shape: string) => {
        if (!colorMenu) return;
        setSavingColor(true);
        setColorError(null);
        try {
            await setWdbsShape(colorMenu.path, shape);
            setTree(prev => patchNodeInTree(prev, colorMenu.path, { shape: shape || null }));
            setColorMenu(m => m && { ...m, shape: shape || null });
        } catch (e: any) {
            setColorError(typeof e === "string" ? e : e?.message ?? "Couldn't save that shape.");
        } finally {
            setSavingColor(false);
        }
    }, [colorMenu]);

    // "None" clears both — a color decoration with no color has nothing to display, so leaving a
    // shape choice behind on its own would just be an inert, invisible setting (see
    // WdbsColorMenu's own doc comment).
    const handleClearColorDecoration = useCallback(async () => {
        if (!colorMenu) return;
        setSavingColor(true);
        setColorError(null);
        try {
            await Promise.all([setWdbsColor(colorMenu.path, ''), setWdbsShape(colorMenu.path, '')]);
            setTree(prev => patchNodeInTree(prev, colorMenu.path, { color: null, shape: null }));
            setColorMenu(m => m && { ...m, color: null, shape: null });
        } catch (e: any) {
            setColorError(typeof e === "string" ? e : e?.message ?? "Couldn't clear that color decoration.");
        } finally {
            setSavingColor(false);
        }
    }, [colorMenu]);

    return (
        <div className={className}>
            {/* shrink-0: stays visible above the tree's own scroll below, same as every other
                view's heading (see VideoList.tsx/GlossaryView.tsx/BiographyView.tsx). */}
            <div className="shrink-0 flex items-center gap-2 min-h-9 mb-4 px-1">
                <h2 className="flex-1 min-w-0 truncate text-xl font-bold text-white">{view === 'sequences' ? sequencesLabel : label}</h2>
                {/* Icons alone: the panel can be squeezed too narrow for two words beside its heading. */}
                {showSequences && (
                    <div className="shrink-0 flex items-center gap-0.5 p-0.5 rounded-lg bg-[#1a1a1a] border border-[#303030]">
                        {([['tree', FolderTree, `${label} tree`], ['sequences', ListVideo, sequencesLabel]] as const).map(([v, Icon, title]) => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => pickView(v)}
                                aria-pressed={view === v}
                                aria-label={title}
                                title={title}
                                className={`p-1.5 rounded-md transition-colors cursor-pointer ${view === v ? 'bg-[#3f3f3f] text-white' : 'text-gray-400 hover:text-white'}`}
                            >
                                <Icon className="w-3.5 h-3.5" />
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {/* This panel gets its own independent scroll (App.tsx no longer shares
                scrollContainerRef with it) — scrolling the video grid shouldn't move the Drive
                tree, and vice versa. */}
            {/* The sequences' filter: under the heading, and outside the list's scroll so it stays in reach. */}
            {view === 'sequences' && (
                <div className="shrink-0 mb-3 flex items-center gap-2 bg-[#121212] border border-[#333] focus-within:border-red-600/50 rounded-lg px-3 transition-colors">
                    <Search className="w-3.5 h-3.5 text-[#666666] shrink-0" />
                    <input
                        value={sequenceFilter}
                        onChange={e => setSequenceFilter(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape' && sequenceFilter) { e.stopPropagation(); setSequenceFilter(''); } }}
                        onContextMenu={handlePlainContextMenu}
                        placeholder={`Filter ${sequencesLabel.toLowerCase()}`}
                        aria-label={`Filter ${sequencesLabel.toLowerCase()}`}
                        className="flex-1 min-w-0 bg-transparent outline-none py-2 text-sm text-white placeholder-[#555]"
                    />
                    {sequenceFilter && (
                        <button type="button" onClick={() => setSequenceFilter('')} aria-label="Clear" title="Clear" className="shrink-0 text-gray-500 hover:text-white transition-colors cursor-pointer">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    )}
                </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {view === 'sequences' ? (
                    <SequenceList selectedPath={selectedPath} onSelect={onSelect} reloadKey={tree} filter={sequenceFilter} />
                ) : loading ? (
                    <div className="text-center text-gray-500 min-h-full py-16 bg-[#121212] rounded-xl border border-[#272727]">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                        <p className="text-sm">Loading {label}...</p>
                    </div>
                ) : tree.length === 0 && unsortedCount === 0 ? (
                    <div className="text-center text-gray-500 min-h-full py-16 bg-[#121212] rounded-xl border border-[#272727] px-4">
                        <p className="text-sm">No videos yet. They'll show up here once tagged with a {label} designator.</p>
                    </div>
                ) : (
                    <div className="min-h-full bg-[#121212] rounded-xl border border-[#272727] p-2 space-y-0.5">
                        {unsortedCount > 0 && (
                            <>
                                <UnsortedRow
                                    count={unsortedCount}
                                    selected={selectedPath === UNSORTED_WDBS_FILTER}
                                    onSelect={() => onSelect(UNSORTED_WDBS_FILTER, 'Unsorted', null)}
                                />
                                {tree.length > 0 && <div className="my-1 border-t border-[#272727]" />}
                            </>
                        )}
                        {tree.map(node => (
                            <TreeBranch
                                key={node.path}
                                node={node}
                                depth={0}
                                expanded={expanded}
                                onToggleExpanded={toggleExpanded}
                                selectedPath={selectedPath}
                                onSelect={onSelect}
                                allowEditAlias={allowEditAlias}
                                onContextMenu={handleContextMenu}
                            />
                        ))}
                    </div>
                )}
            </div>
            {contextMenu && (
                <NodeContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onEditAlias={() => {
                        setAliasError(null);
                        setAliasMenu({ x: contextMenu.x, y: contextMenu.y, path: contextMenu.node.path, segment: contextMenu.node.segment, alias: contextMenu.node.alias ?? '' });
                        setContextMenu(null);
                    }}
                    onEditIcon={() => {
                        setIconError(null);
                        setIconMenu({ x: contextMenu.x, y: contextMenu.y, path: contextMenu.node.path, segment: contextMenu.node.segment, icon: contextMenu.node.icon });
                        setContextMenu(null);
                    }}
                    onEditColor={() => {
                        setColorError(null);
                        setColorMenu({ x: contextMenu.x, y: contextMenu.y, path: contextMenu.node.path, segment: contextMenu.node.segment, color: contextMenu.node.color, shape: contextMenu.node.shape });
                        setContextMenu(null);
                    }}
                    onClose={() => setContextMenu(null)}
                />
            )}
            {aliasMenu && (
                <WdbsAliasMenu
                    x={aliasMenu.x}
                    y={aliasMenu.y}
                    segment={aliasMenu.segment}
                    initialAlias={aliasMenu.alias}
                    onSave={handleSaveAlias}
                    onClose={() => setAliasMenu(null)}
                    saving={savingAlias}
                    error={aliasError}
                />
            )}
            {iconMenu && (
                <WdbsIconMenu
                    x={iconMenu.x}
                    y={iconMenu.y}
                    segment={iconMenu.segment}
                    currentIcon={iconMenu.icon}
                    onSelect={handleSelectIcon}
                    onClose={() => setIconMenu(null)}
                    saving={savingIcon}
                    error={iconError}
                />
            )}
            {colorMenu && (
                <WdbsColorMenu
                    x={colorMenu.x}
                    y={colorMenu.y}
                    segment={colorMenu.segment}
                    currentColor={colorMenu.color}
                    currentShape={colorMenu.shape}
                    onSelectColor={handleSelectColor}
                    onSelectShape={handleSelectShape}
                    onClear={handleClearColorDecoration}
                    onClose={() => setColorMenu(null)}
                    saving={savingColor}
                    error={colorError}
                />
            )}
        </div>
    );
}

/** The panel's other view: every Drive that has a sequence, as a playlist (its first video's picture with the count on
 *  it). Clicking one opens it, as a sequence link does: its first video, with the bar under the video following that
 *  sequence. The button at the end of a row shows the Drive's videos in the Library instead (what clicking the Drive in
 *  the tree does). `reloadKey`: read again when it changes (the tree, which is fetched again when Drives change).
 *  `filter`: only the ones with every word of it in their name, their Drive or their first video's title. */
function SequenceList({ selectedPath, onSelect, reloadKey, filter }: { selectedPath: string | undefined; onSelect: (path: string, label: string, alias: string | null) => void; reloadKey: unknown; filter: string }) {
    const { labels } = useWorkspace();
    const [rows, setRows] = useState<{ summary: SequenceSummary; path: string; alias: string | null }[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [nonce, setNonce] = useState(0);
    useEffect(() => {
        const again = () => setNonce(n => n + 1);
        window.addEventListener(SEQUENCES_CHANGED_EVENT, again);
        return () => window.removeEventListener(SEQUENCES_CHANGED_EVENT, again);
    }, []);
    useEffect(() => {
        let live = true;
        (async () => {
            const sequences = await listDriveSequences();
            const paths = sequences.map(s => encodeWdbs(s.drive));
            const aliases = await getWdbsAliases(paths).catch(() => ({} as Record<string, string>));
            return sequences.map((summary, i) => ({ summary, path: paths[i], alias: aliases[paths[i]] ?? null }));
        })()
            .then(list => { if (live) { setRows(list); setError(null); } })
            .catch(e => { if (live) { setRows([]); setError(typeof e === 'string' ? e : e?.message ?? "Couldn't load them."); } });
        return () => { live = false; };
    }, [reloadKey, nonce]);

    const sequenceLower = labels.aliasSequence.toLowerCase();
    const box = 'text-center text-gray-500 min-h-full py-16 bg-[#121212] rounded-xl border border-[#272727] px-4';
    if (rows === null) {
        return (
            <div className={box}>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm">Loading {sequenceLower}s...</p>
            </div>
        );
    }
    if (error) return <div className={box}><p className="text-sm text-red-400 break-words">{error}</p></div>;
    if (rows.length === 0) {
        return <div className={box}><p className="text-sm">No {sequenceLower}s yet. One is started from the {labels.aliasSequence} bar under a video.</p></div>;
    }
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const shownRows = words.length === 0 ? rows : rows.filter(({ summary, alias }) => {
        const text = `${alias ?? ''}\n${summary.drive}\n${summary.firstTitle ?? ''}`.toLowerCase();
        return words.every(w => text.includes(w));
    });
    if (shownRows.length === 0) {
        return <div className={box}><p className="text-sm">No {sequenceLower}s match.</p></div>;
    }
    return (
        <div className="min-h-full bg-[#121212] rounded-xl border border-[#272727] p-2 space-y-0.5">
            {shownRows.map(({ summary, path, alias }) => {
                const name = alias || driveSegmentLabel(summary.drive);
                const shown = selectedPath === path;
                return (
                    // Resting the pointer on it says what the row has no room for, on a card to its right.
                    <HoverDates
                        key={summary.drive}
                        title={name}
                        rows={[
                            { label: labels.aliasDriveName, value: summary.drive },
                            { label: 'Videos', value: String(summary.count) },
                            ...(summary.firstTitle ? [{ label: 'Starts with', value: summary.firstTitle }] : []),
                            ...(summary.stale > 0 ? [{ label: `Left the ${labels.aliasDriveName}`, value: String(summary.stale) }] : []),
                        ]}
                    >{hover => (
                    <div {...hover} className="group flex items-center gap-1 rounded-lg text-gray-300 hover:bg-[#272727] transition-colors">
                        <button
                            type="button"
                            onClick={() => openInternalLink('playlist', summary.drive)}
                            aria-label={`Open this ${sequenceLower}`}
                            className="flex-1 min-w-0 flex items-center gap-2.5 p-1.5 text-left cursor-pointer"
                        >
                            <PlaylistThumb videoId={summary.firstVideoId} count={summary.count} className="w-16 aspect-video rounded-md" />
                            <span className="min-w-0 flex flex-col">
                                <span className="text-sm text-white truncate">{name}</span>
                                <span className="text-[11px] font-mono text-gray-500 truncate">{summary.drive}</span>
                            </span>
                        </button>
                        <button
                            type="button"
                            onMouseEnter={hover.onMouseLeave}
                            onClick={() => onSelect(path, driveSegmentLabel(summary.drive), alias)}
                            aria-pressed={shown}
                            title={shown ? `Showing this ${labels.aliasDriveName}'s videos (click to show them all again)` : `Show this ${labels.aliasDriveName}'s videos in the ${labels.aliasLibrary}`}
                            className={`shrink-0 p-1.5 mr-1 rounded-md transition-colors cursor-pointer ${shown ? 'bg-red-600 text-white' : 'text-gray-500 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
                        >
                            <FolderTree className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    )}</HoverDates>
                );
            })}
        </div>
    );
}

function TreeBranch({ node, depth, expanded, onToggleExpanded, selectedPath, onSelect, allowEditAlias, onContextMenu }: {
    node: WdbsNode;
    depth: number;
    expanded: Set<string>;
    onToggleExpanded: (path: string) => void;
    selectedPath: string | undefined;
    onSelect: (path: string, label: string, alias: string | null) => void;
    allowEditAlias: boolean;
    onContextMenu: (node: WdbsNode, x: number, y: number) => void;
}) {
    const isExpanded = expanded.has(node.path);
    const hasChildren = node.children.length > 0;
    return (
        <>
            <TreeRow
                label={node.segment}
                path={node.path}
                childCount={node.children.length}
                alias={node.alias}
                icon={node.icon}
                color={node.color}
                shape={node.shape}
                count={node.count}
                depth={depth}
                hasChildren={hasChildren}
                expanded={isExpanded}
                selected={selectedPath === node.path}
                editable={allowEditAlias}
                onToggle={() => onToggleExpanded(node.path)}
                onSelect={() => onSelect(node.path, node.segment, node.alias)}
                onContextMenu={(x, y) => onContextMenu(node, x, y)}
            />
            {hasChildren && isExpanded && node.children.map(child => (
                <TreeBranch
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    expanded={expanded}
                    onToggleExpanded={onToggleExpanded}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                    allowEditAlias={allowEditAlias}
                    onContextMenu={onContextMenu}
                />
            ))}
        </>
    );
}

// The tree's synthetic entry for videos with no home Warp Drive at all (see
// db::count_unsorted_videos/list_unsorted_videos) — rendered above the real taxonomy, not part of
// `tree` itself, so it has none of TreeRow's expand/context-menu/alias machinery: it can't have
// children and there's nothing about it to curate.
function UnsortedRow({ count, selected, onSelect }: { count: number; selected: boolean; onSelect: () => void }) {
    return (
        <div
            className={`flex items-center gap-1 rounded-lg cursor-pointer group transition-colors ${selected ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-[#272727]'}`}
            style={{ paddingLeft: '4px' }}
            onClick={onSelect}
        >
            {/* Invisible spacer matching TreeRow's toggle button, so the icon/label line up with every real node's. */}
            <span className="p-1.5 shrink-0 invisible"><ChevronRight className="w-3.5 h-3.5" /></span>
            <Inbox className={`w-3.5 h-3.5 shrink-0 mr-1 ${selected ? 'text-white/80' : 'text-gray-500'}`} />
            <span className="flex-1 min-w-0 text-sm py-1.5 truncate italic">Unsorted</span>
            <span className={`text-[11px] font-medium px-2 shrink-0 ${selected ? 'text-white/80' : 'text-gray-500'}`}>{count}</span>
            {/* Invisible twin of TreeRow's edit button, so this row's number lines up with the real nodes' numbers. */}
            <span className="shrink-0 w-[22px]" />
        </div>
    );
}

function TreeRow({ label, path, childCount, alias, icon, color, shape, count, depth, hasChildren, expanded, selected, editable, onToggle, onSelect, onContextMenu }: {
    label: string;
    /** Its path as stored, and how many Drives sit directly under it: for the card that opens beside it. */
    path: string;
    childCount: number;
    alias: string | null;
    icon: string | null;
    color: string | null;
    shape: string | null;
    count: number;
    depth: number;
    hasChildren: boolean;
    expanded: boolean;
    selected: boolean;
    editable: boolean;
    onToggle: () => void;
    onSelect: () => void;
    onContextMenu: (x: number, y: number) => void;
}) {
    const Icon = getWdbsIconComponent(icon);
    // Its own small chip between the icon and the name, rather than a rule under the name itself
    // (an underline read as accidental link styling, and disappeared under `truncate`'s ellipsis
    // on a long name). `getWdbsColorValue` resolves to a `var(...)` pointing at index.css's
    // --k-drive-* tokens, which already carry the light/dark-appropriate shade for whichever theme
    // is active, so nothing here needs its own light/dark branching.
    const colorValue = getWdbsColorValue(color);
    const { labels } = useWorkspace();
    return (
        // Resting the pointer on it says what the row has no room for (its alias, where it sits, what's in it), on a card
        // to its right.
        <HoverDates
            title={alias || label}
            rows={[
                { label: labels.aliasDriveName, value: decodeWdbs(path) || path },
                { label: 'Videos', value: `${count}${childCount > 0 ? ' (with those beneath it)' : ''}` },
                ...(childCount > 0 ? [{ label: 'Directly under it', value: `${childCount} ${labels.aliasDriveName} Node${childCount === 1 ? '' : 's'}` }] : []),
            ]}
        >{hover => (
        <div
            {...hover}
            className={`flex items-center gap-1 rounded-lg cursor-pointer group transition-colors ${selected ? 'bg-red-600 text-white' : 'text-gray-300 hover:bg-[#272727]'}`}
            style={{ paddingLeft: `${depth * 16 + 4}px` }}
            onClick={onSelect}
            onContextMenu={editable ? (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e.clientX, e.clientY); } : undefined}
        >
            <button
                onClick={(e) => { e.stopPropagation(); onToggle(); }}
                className={`p-1.5 shrink-0 rounded transition-colors ${hasChildren ? 'cursor-pointer' : 'invisible'} ${selected ? 'text-white hover:bg-white/20' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
                tabIndex={hasChildren ? 0 : -1}
            >
                {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
            {colorValue && (
                <WdbsShapeSwatch
                    shape={shape ?? 'square'}
                    colorValue={colorValue}
                    className="mr-1.5"
                    borderClassName={selected ? 'border-white/30' : 'border-black/20'}
                />
            )}
            {Icon && <Icon className={`w-3.5 h-3.5 shrink-0 mr-1 ${selected ? 'text-white/80' : 'text-gray-500'}`} />}
            <span className="flex-1 min-w-0 text-sm py-1.5 truncate">
                {label}
            </span>
            <span className={`text-[11px] font-medium px-2 shrink-0 ${selected ? 'text-white/80' : 'text-gray-500'}`}>{count}</span>
            {editable && (
                <button
                    type="button"
                    onClick={e => { e.stopPropagation(); onContextMenu(e.clientX, e.clientY); }}
                    className="shrink-0 p-1 rounded text-gray-500 hover:text-white transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    title="Edit alias, marker or decoration"
                >
                    <MoreVertical className="w-3.5 h-3.5" />
                </button>
            )}
        </div>
        )}</HoverDates>
    );
}
