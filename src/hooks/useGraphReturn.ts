import { useEffect, useRef, useState } from 'react';
import type { GraphNodeKind } from '../api';

/**
 * The graph view's open state, and getting back to it from what it opened (components/GraphModal.tsx).
 *
 * The graph is a place in Back/Forward (App's navPlace reads `showGraph`). Something picked in it is on its way while
 * `graphOpening` is set: the graph closes once that thing has opened (the sidebar has the video, or the term's or
 * person's window is up), so going back from a video returns straight to the graph rather than to an in-between place
 * with neither. If it can't open, the graph just stays.
 *
 * What was opened from the graph is remembered while it's still what's open: closing it goes back to the graph. A
 * video's sidebar takes a step back (App's Sidebar onClose checks `fromGraphVideo`; the graph is the place before it);
 * a term's or person's window, which isn't a place of its own, opens the graph again as it was left
 * (`closedFromGraph`).
 */
export function useGraphReturn({ sidebarOpen, selectedVideo, linkedTerm, selectedBiography, viewMode }: {
    sidebarOpen: boolean;
    selectedVideo: { id: string } | null;
    linkedTerm: { term: string } | null;
    selectedBiography: { handle: string } | null;
    viewMode: string;
}) {
    const [showGraph, setShowGraph] = useState(false);
    // Opened by Back/Forward: it picks up as it was left (GraphModal's `resume`). From Ctrl+K it starts fresh.
    const [graphResume, setGraphResume] = useState(false);
    const graphOpening = useRef<GraphNodeKind | null>(null);
    const fromGraphVideo = useRef<string | null>(null);
    const fromGraphEntry = useRef<{ kind: 'glossary' | 'bio'; key: string } | null>(null);

    useEffect(() => {
        const opening = graphOpening.current;
        if (opening === 'video' && sidebarOpen && selectedVideo) {
            graphOpening.current = null;
            fromGraphVideo.current = selectedVideo.id;
            setShowGraph(false);
        } else if (opening === 'glossary' && linkedTerm) {
            graphOpening.current = null;
            fromGraphEntry.current = { kind: 'glossary', key: linkedTerm.term };
            setShowGraph(false);
        } else if (opening === 'bio' && selectedBiography) {
            graphOpening.current = null;
            fromGraphEntry.current = { kind: 'bio', key: selectedBiography.handle };
            setShowGraph(false);
        }
        // Another video, or it closed some other way: no longer straight from the graph.
        if (!sidebarOpen || selectedVideo?.id !== fromGraphVideo.current) fromGraphVideo.current = null;
        if (fromGraphEntry.current?.kind === 'glossary' && linkedTerm?.term !== fromGraphEntry.current.key) fromGraphEntry.current = null;
        if (fromGraphEntry.current?.kind === 'bio' && selectedBiography?.handle !== fromGraphEntry.current.key) fromGraphEntry.current = null;
    }, [sidebarOpen, selectedVideo, linkedTerm, selectedBiography]);
    useEffect(() => { fromGraphVideo.current = null; }, [viewMode]);

    /** A term's or person's window closed: back to the graph, as it was left, if that's where it was opened from. */
    const closedFromGraph = (kind: 'glossary' | 'bio') => {
        const from = fromGraphEntry.current;
        fromGraphEntry.current = null;
        if (from?.kind === kind) { setGraphResume(true); setShowGraph(true); }
    };

    return { showGraph, setShowGraph, graphResume, setGraphResume, graphOpening, fromGraphVideo, closedFromGraph };
}
