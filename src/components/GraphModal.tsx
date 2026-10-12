import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Network, Search } from 'lucide-react';
import { getLinkGraph, type GraphNodeKind, type LinkGraph } from '../api';
import { useWorkspace } from '../hooks/useWorkspace';
import { useFlags } from '../hooks/useFlags';
import { Modal } from './Modal';
import { SecondaryButton } from './ui/Button';

/** Each kind's dot color: videos neutral, terms amber, people sky, notes green (the accent marks what's highlighted). */
const KIND_COLOR: Record<GraphNodeKind, string> = { video: '#9ca3af', glossary: '#f59e0b', bio: '#38bdf8', note: '#4ade80' };

/** The graph as it was last left (closed), for Back/Forward to pick up from: the graph itself, where its dots were, the
 *  zoom and pan, and the filters and search. Kept for this run of the app only; Ctrl+K always loads it afresh. */
let saved: {
    graph: LinkGraph;
    x: Float64Array; y: Float64Array;
    cam: { x: number; y: number; k: number };
    kinds: Record<GraphNodeKind, boolean>;
    creators: boolean; unlinked: boolean; query: string;
} | null = null;

/**
 * The graph view, opened from Ctrl+K: every video, glossary term and person as a dot, joined where one's text links to
 * another (and, when asked for, a video to its creator: off to begin with, since those aren't links anyone wrote). Dots grow with how connected they are. Drag the background to pan,
 * scroll to zoom, drag a dot to move it; resting on a dot lights it and its neighbors and names them, and clicking it
 * opens it. A dot with a hollow middle is linked to but has no entry yet.
 */
export function GraphModal({ onClose, onOpen, resume = false }: {
    onClose: () => void;
    onOpen: (kind: GraphNodeKind, key: string) => void;
    /** Back/Forward returning to it: pick up as it was left (see `saved`), instead of loading and laying out afresh. */
    resume?: boolean;
}) {
    const { labels } = useWorkspace();
    const { flags } = useFlags();
    // What it's picking up from, when resuming (and there's something to pick up).
    const [from] = useState(() => (resume ? saved : null));
    const [graph, setGraph] = useState<LinkGraph | null>(from?.graph ?? null);
    const [error, setError] = useState<string | null>(null);
    const [kinds, setKinds] = useState<Record<GraphNodeKind, boolean>>({ video: true, glossary: true, bio: true, note: true, ...from?.kinds });
    // Off to begin with: every video has a creator line, so they'd outnumber the links that were actually written (and
    // swell every creator's dot), saying only which channel each video is from.
    const [creators, setCreators] = useState(from?.creators ?? false);
    const [unlinked, setUnlinked] = useState(from?.unlinked ?? false);
    const [query, setQuery] = useState(from?.query ?? '');
    // The dot under the pointer (for its card), and where the card goes (moved directly, see onMove).
    const [hover, setHover] = useState<number | null>(null);
    const tipRef = useRef<HTMLDivElement>(null);
    const tipAt = useRef({ x: 0, y: 0 });

    useEffect(() => { if (!from) getLinkGraph().then(setGraph).catch(e => setError(String(e))); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // What's shown: the kinds ticked, the edges between them, and (unless asked for) only dots with an edge.
    const view = useMemo(() => {
        if (!graph) return null;
        const edges = graph.edges.filter(e => (creators || e.kind === 'link') && kinds[graph.nodes[e.a].kind] && kinds[graph.nodes[e.b].kind]);
        const degree = new Uint32Array(graph.nodes.length);
        for (const e of edges) { degree[e.a]++; degree[e.b]++; }
        const ids = graph.nodes.map((_, i) => i).filter(i => kinds[graph.nodes[i].kind] && (unlinked || degree[i] > 0));
        const neighbors = new Map<number, Set<number>>();
        for (const e of edges) {
            (neighbors.get(e.a) ?? neighbors.set(e.a, new Set()).get(e.a)!).add(e.b);
            (neighbors.get(e.b) ?? neighbors.set(e.b, new Set()).get(e.b)!).add(e.a);
        }
        return { ids, edges, degree, neighbors };
    }, [graph, kinds, creators, unlinked]);

    const matches = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!graph || !view || !q) return new Set<number>();
        return new Set(view.ids.filter(i => graph.nodes[i].label.toLowerCase().includes(q)));
    }, [graph, view, query]);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    // The dots' latest positions, as the layout worker last sent them (what's drawn and hit-tested).
    const simRef = useRef<{ x: Float64Array; y: Float64Array } | null>(null);
    const workerRef = useRef<Worker | null>(null);
    const camRef = useRef({ x: 0, y: 0, k: 1 });
    const frameRef = useRef(0);
    const drawRef = useRef<() => void>(() => {});
    const hoverRef = useRef<number | null>(null);

    // The layout runs in a worker (lib/graph-layout.worker.ts), made once per graph. The dots start on a spiral, so the
    // layout untangles rather than explodes.
    useEffect(() => {
        if (!graph) return;
        const n = graph.nodes.length;
        let x = new Float64Array(n), y = new Float64Array(n);
        if (from && from.graph === graph) {
            // Picking up: where the dots were, and the view as it was (not framed again).
            x = from.x.slice(); y = from.y.slice();
            camRef.current = { ...from.cam };
        } else {
            for (let i = 0; i < n; i++) {
                const r = 12 * Math.sqrt(i + 1), t = i * 2.4;
                x[i] = r * Math.cos(t); y[i] = r * Math.sin(t);
            }
        }
        simRef.current = { x, y };
        const worker = new Worker(new URL('../lib/graph-layout.worker.ts', import.meta.url), { type: 'module' });
        let framedOnce = false;
        worker.onmessage = (e: MessageEvent<{ x: Float64Array; y: Float64Array; done: boolean }>) => {
            // A dot being dragged stays under the pointer, whatever the worker last had for it.
            const held = drag.current?.node ?? null;
            const prev = simRef.current;
            if (held !== null && prev) { e.data.x[held] = prev.x[held]; e.data.y[held] = prev.y[held]; }
            simRef.current = { x: e.data.x, y: e.data.y };
            if (e.data.done && !framedOnce) { framedOnce = true; fitRef.current(); }
            redraw();
        };
        worker.postMessage({ type: 'init', x, y });
        workerRef.current = worker;
        firstView.current = true;
        return () => { worker.terminate(); workerRef.current = null; };
    }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps
    const firstView = useRef(true);
    // The worker's handler is made once; this reaches the current framing function from it.
    const fitRef = useRef<() => void>(() => {});

    const radius = (i: number) => 3 + Math.sqrt(view?.degree[i] ?? 0) * 1.6;

    // Draws a frame, and keeps stepping the layout while it's still settling.
    drawRef.current = () => {
        // This frame has arrived: cleared first, so a frame that bails out below (before the graph has loaded) can't
        // leave it looking pending, which would stop every later redraw from being asked for.
        frameRef.current = 0;
        const canvas = canvasRef.current, s = simRef.current;
        if (!canvas || !s || !graph || !view) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
            canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        }
        const cam = camRef.current;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.translate(w / 2 + cam.x, h / 2 + cam.y);
        ctx.scale(cam.k, cam.k);
        const accent = getComputedStyle(canvas).getPropertyValue('--k-accent').trim() || '#ef4444';
        const lit = hoverRef.current;
        const litSet = lit !== null ? view.neighbors.get(lit) ?? new Set<number>() : null;
        const dimmed = (i: number) => (litSet !== null && i !== lit && !litSet.has(i)) || (matches.size > 0 && !matches.has(i) && i !== lit);
        // Only what's on screen (plus a margin for the biggest dots) is drawn.
        const pad = 40 / cam.k;
        const left = (-w / 2 - cam.x) / cam.k - pad, right = (w / 2 - cam.x) / cam.k + pad;
        const top = (-h / 2 - cam.y) / cam.k - pad, bottom = (h / 2 - cam.y) / cam.k + pad;
        const onScreen = (i: number) => s.x[i] >= left && s.x[i] <= right && s.y[i] >= top && s.y[i] <= bottom;

        // Lines, a few strokes in all (one per look), not one each.
        const linePaths = { link: new Path2D(), creator: new Path2D(), faint: new Path2D(), lit: new Path2D() };
        for (const e of view.edges) {
            if (!onScreen(e.a) && !onScreen(e.b)) continue;
            const on = lit !== null && (e.a === lit || e.b === lit);
            const p = on ? linePaths.lit : dimmed(e.a) || dimmed(e.b) ? linePaths.faint : e.kind === 'creator' ? linePaths.creator : linePaths.link;
            p.moveTo(s.x[e.a], s.y[e.a]); p.lineTo(s.x[e.b], s.y[e.b]);
        }
        ctx.lineWidth = 1 / cam.k;
        ctx.strokeStyle = 'rgba(160,160,160,0.05)'; ctx.stroke(linePaths.faint);
        ctx.strokeStyle = 'rgba(160,160,160,0.12)'; ctx.stroke(linePaths.creator);
        ctx.strokeStyle = 'rgba(160,160,160,0.28)'; ctx.stroke(linePaths.link);
        ctx.strokeStyle = accent; ctx.stroke(linePaths.lit);

        // Dots, one fill (or outline) per color, faded or not. Too small on screen to see as round, a square is drawn
        // instead (much cheaper).
        const dotPaths = new Map<string, { path: Path2D; color: string; faded: boolean; hollow: boolean }>();
        for (const i of view.ids) {
            if (!onScreen(i)) continue;
            const node = graph.nodes[i];
            const color = i === lit || matches.has(i) ? accent : KIND_COLOR[node.kind];
            const faded = dimmed(i);
            const key = `${color}|${faded}|${node.exists}`;
            let bucket = dotPaths.get(key);
            if (!bucket) dotPaths.set(key, bucket = { path: new Path2D(), color, faded, hollow: !node.exists });
            const r = radius(i);
            if (r * cam.k < 1.5) bucket.path.rect(s.x[i] - r, s.y[i] - r, r * 2, r * 2);
            else { bucket.path.moveTo(s.x[i] + r, s.y[i]); bucket.path.arc(s.x[i], s.y[i], r, 0, Math.PI * 2); }
        }
        for (const { path, color, faded, hollow } of dotPaths.values()) {
            ctx.globalAlpha = faded ? 0.18 : 1;
            if (hollow) { ctx.lineWidth = 1.5 / cam.k; ctx.strokeStyle = color; ctx.stroke(path); }
            else { ctx.fillStyle = color; ctx.fill(path); }
        }

        // Names: when zoomed in, for the dot rested on and its neighbors, and for search matches; at most a few hundred.
        ctx.globalAlpha = 1;
        ctx.font = `${11 / cam.k}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        let named = 0;
        for (const i of view.ids) {
            if (named >= 300) break;
            const show = i === lit || litSet?.has(i) || matches.has(i) || (cam.k > 1.6 && !dimmed(i));
            if (!show || !onScreen(i)) continue;
            named++;
            const label = graph.nodes[i].label;
            ctx.fillStyle = i === lit ? '#ffffff' : 'rgba(220,220,220,0.85)';
            ctx.fillText(label.length > 40 ? `${label.slice(0, 39)}…` : label, s.x[i], s.y[i] + radius(i) + 12 / cam.k);
        }

    };
    const redraw = () => { if (!frameRef.current) frameRef.current = requestAnimationFrame(() => drawRef.current()); };
    // What's shown goes to the layout: all of it the first time, and after that a change wakes it a little, so it settles
    // around the change.
    useEffect(() => {
        const worker = workerRef.current;
        if (worker && view) {
            worker.postMessage({
                type: 'view',
                ids: Int32Array.from(view.ids),
                a: Int32Array.from(view.edges, e => e.a),
                b: Int32Array.from(view.edges, e => e.b),
                // Picking up where it was left: already laid out, so it isn't woken.
                alpha: firstView.current ? (from && from.graph === graph ? 0 : 1) : 0.5,
            });
            firstView.current = false;
        }
        redraw();
    }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { redraw(); }, [matches]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => () => cancelAnimationFrame(frameRef.current), []);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const observer = new ResizeObserver(() => redraw());
        observer.observe(canvas);
        return () => observer.disconnect();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Zooms so every dot shown fits, centred.
    const fit = () => {
        const s = simRef.current, canvas = canvasRef.current;
        if (!s || !view || !canvas || view.ids.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const i of view.ids) { minX = Math.min(minX, s.x[i]); maxX = Math.max(maxX, s.x[i]); minY = Math.min(minY, s.y[i]); maxY = Math.max(maxY, s.y[i]); }
        const k = Math.min(3, 0.9 * Math.min(canvas.clientWidth / (maxX - minX + 40), canvas.clientHeight / (maxY - minY + 40)));
        camRef.current = { k, x: -((minX + maxX) / 2) * k, y: -((minY + maxY) / 2) * k };
        redraw();
    };
    // The first layout is framed as it settles (a moment in, and again once it's done), unless the view has been panned,
    // zoomed or a dot dragged in the meantime.
    const cameraTouched = useRef(false);
    const fitUntouched = () => { if (!cameraTouched.current) fit(); };
    fitRef.current = fitUntouched;
    useEffect(() => {
        if (!view) return;
        // Picking up where it was left: the view stays as it was.
        cameraTouched.current = !!from && from.graph === graph;
        const t = window.setTimeout(fitUntouched, 1000);
        return () => window.clearTimeout(t);
    }, [graph]); // eslint-disable-line react-hooks/exhaustive-deps

    // On closing, how it was left (for Back/Forward to pick up from). Read from refs, so the latest of everything.
    const keep = useRef({ kinds, creators, unlinked, query });
    keep.current = { kinds, creators, unlinked, query };
    useEffect(() => () => {
        const pos = simRef.current;
        if (graph && pos) saved = { graph, x: pos.x, y: pos.y, cam: { ...camRef.current }, ...keep.current };
    }, [graph]);

    // The dot under a point on the canvas (in its own pixels), if any.
    const hit = (px: number, py: number): number | null => {
        const s = simRef.current, canvas = canvasRef.current;
        if (!s || !view || !canvas) return null;
        const cam = camRef.current;
        const wx = (px - canvas.clientWidth / 2 - cam.x) / cam.k, wy = (py - canvas.clientHeight / 2 - cam.y) / cam.k;
        let best: number | null = null, bestD = Infinity;
        for (const i of view.ids) {
            const d = Math.hypot(s.x[i] - wx, s.y[i] - wy);
            if (d <= radius(i) + 4 / cam.k && d < bestD) { best = i; bestD = d; }
        }
        return best;
    };

    const drag = useRef<{ node: number | null; sx: number; sy: number; moved: boolean; cam: { x: number; y: number } } | null>(null);
    const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const node = hit(e.clientX - r.left, e.clientY - r.top);
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { node, sx: e.clientX, sy: e.clientY, moved: false, cam: { x: camRef.current.x, y: camRef.current.y } };
        cameraTouched.current = true;
    };
    const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const d = drag.current;
        if (d) {
            if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) d.moved = true;
            const s = simRef.current;
            if (d.node !== null && s) {
                const cam = camRef.current;
                s.x[d.node] = (e.clientX - r.left - r.width / 2 - cam.x) / cam.k;
                s.y[d.node] = (e.clientY - r.top - r.height / 2 - cam.y) / cam.k;
                // The rest follow it in the worker.
                if (d.moved) workerRef.current?.postMessage({ type: 'drag', i: d.node, x: s.x[d.node], y: s.y[d.node] });
            } else {
                camRef.current.x = d.cam.x + (e.clientX - d.sx);
                camRef.current.y = d.cam.y + (e.clientY - d.sy);
            }
            redraw();
            return;
        }
        const i = hit(e.clientX - r.left, e.clientY - r.top);
        // The card follows the pointer directly; the page only re-renders when the dot under it changes.
        tipAt.current = { x: e.clientX - r.left + 14, y: e.clientY - r.top + 14 };
        if (tipRef.current) { tipRef.current.style.left = `${tipAt.current.x}px`; tipRef.current.style.top = `${tipAt.current.y}px`; }
        if (i !== hoverRef.current) { hoverRef.current = i; setHover(i); redraw(); }
    };
    const onUp = () => {
        const d = drag.current;
        drag.current = null;
        if (d?.node !== null && d?.moved) workerRef.current?.postMessage({ type: 'release' });
        if (d && d.node !== null && !d.moved && graph) {
            const node = graph.nodes[d.node];
            onOpen(node.kind, node.key);
        }
    };
    const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const cam = camRef.current;
        const k = Math.min(8, Math.max(0.05, cam.k * Math.exp(-e.deltaY * 0.0015)));
        // Around the pointer: the point under it stays under it.
        const px = e.clientX - r.left - r.width / 2, py = e.clientY - r.top - r.height / 2;
        cam.x = px - ((px - cam.x) / cam.k) * k;
        cam.y = py - ((py - cam.y) / cam.k) * k;
        cam.k = k;
        cameraTouched.current = true;
        redraw();
    };

    // Enter in the search box centres the first match.
    const centreOn = (i: number) => {
        const s = simRef.current;
        if (!s) return;
        const k = Math.max(camRef.current.k, 1.4);
        camRef.current = { k, x: -s.x[i] * k, y: -s.y[i] * k };
        redraw();
    };

    const toggle = (kind: GraphNodeKind, label: string) => (
        <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-300 cursor-pointer select-none">
            <input type="checkbox" checked={kinds[kind]} onChange={e => setKinds(prev => ({ ...prev, [kind]: e.target.checked }))} className="cursor-pointer" />
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: KIND_COLOR[kind] }} />
            {label}
        </label>
    );
    const hovered = hover !== null && graph ? graph.nodes[hover] : null;
    const kindName: Record<GraphNodeKind, string> = { video: 'Video', glossary: 'Term', bio: labels.aliasBiographyItem, note: 'Note' };

    return (
        <Modal
            onClose={onClose}
            icon={Network}
            title="Graph View"
            subtitle={view ? `${view.ids.length.toLocaleString()} shown, ${view.edges.length.toLocaleString()} connections` : 'Loading...'}
            size="full"
            // Back/Forward pressed here closes it and goes on (it's a place in that history, see App's navPlace).
            closeOnNavigate
            className="h-[88vh]"
            bodyClassName="p-0 flex flex-col"
        >
            <div className="shrink-0 flex items-center gap-4 flex-wrap px-4 py-2.5 border-b border-[#303030]">
                {toggle('video', 'Videos')}
                {toggle('glossary', 'Terms')}
                {toggle('bio', labels.aliasBiography)}
                {flags.viewVisible.notes && toggle('note', labels.aliasNotes)}
                <span className="w-px h-4 bg-[#303030]" />
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-300 cursor-pointer select-none" title="Also a line from every video to its creator (automatic, not a link you wrote)">
                    <input type="checkbox" checked={creators} onChange={e => setCreators(e.target.checked)} className="cursor-pointer" /> Creator lines
                </label>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-300 cursor-pointer select-none" title="Also show what isn't connected to anything">
                    <input type="checkbox" checked={unlinked} onChange={e => setUnlinked(e.target.checked)} className="cursor-pointer" /> Unconnected
                </label>
                <div className="ml-auto flex items-center gap-2">
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { const first = [...matches][0]; if (first !== undefined) centreOn(first); } }}
                            placeholder="Find (Enter: Go to it)"
                            className="w-52 bg-[#121212] border border-[#333] text-white rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-red-600"
                        />
                    </div>
                    <SecondaryButton size="sm" onClick={fit} title="Fit everything shown">
                        <Maximize2 className="w-3.5 h-3.5" /> Fit
                    </SecondaryButton>
                </div>
            </div>
            <div className="relative flex-1 min-h-0">
                {error && <div className="absolute inset-0 flex items-center justify-center text-sm text-red-400 px-6 text-center">{error}</div>}
                {view && view.ids.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 px-6 text-center pointer-events-none">
                        Nothing connected yet. Link videos, terms and people in your notes and summaries (type @ or ^ in a Markdown editor) to see them here.
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    className={`absolute inset-0 w-full h-full ${hover !== null ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
                    onPointerDown={onDown}
                    onPointerMove={onMove}
                    onPointerUp={onUp}
                    onPointerLeave={() => { if (!drag.current) { hoverRef.current = null; setHover(null); redraw(); } }}
                    onWheel={onWheel}
                />
                {hovered && hover !== null && !drag.current && (
                    <div ref={tipRef} className="pointer-events-none absolute z-10 max-w-xs rounded-lg border border-[#333] bg-[#1a1a1a] px-2.5 py-1.5 shadow-xl" style={{ left: tipAt.current.x, top: tipAt.current.y }}>
                        <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: KIND_COLOR[hovered.kind] }}>
                            {kindName[hovered.kind]}{hovered.exists ? '' : ' (no entry yet)'}
                        </div>
                        <div className="text-xs text-white break-words">{hovered.label}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{view?.degree[hover] ?? 0} connection{view?.degree[hover] === 1 ? '' : 's'} · click to open</div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
