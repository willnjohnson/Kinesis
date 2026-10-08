/// <reference lib="webworker" />
/**
 * Runs the graph view's layout (graph-layout.ts) off the page's thread, so panning, zooming and hovering stay smooth while
 * thousands of dots settle. It steps the layout in slices of about a frame and sends the dots' positions back after each.
 *
 * Messages in:
 *   { type: 'init', x, y }                  the dots' starting positions (all of the graph's, shown or not)
 *   { type: 'view', ids, a, b, alpha }      the dots shown and the edges between them (a[k] to b[k]), and how much to wake
 *   { type: 'drag', i, x, y }               a dot held by the pointer, where it is
 *   { type: 'release' }                     let go of it
 * Messages out: { x, y, done } (copies of the positions; done once it has settled).
 */
import { step, type Sim } from './graph-layout';

let sim: Sim | null = null;
let ids: number[] = [];
let edges: { a: number; b: number }[] = [];
let running = false;

/** `done`: the layout has settled (the page frames the first one then). */
function send(done = false) {
    if (sim) postMessage({ x: sim.x.slice(), y: sim.y.slice(), done });
}

function run() {
    if (!sim || sim.alpha <= 0.004) { running = false; send(true); return; }
    const until = performance.now() + 16;
    do { step(sim, ids, edges); } while (sim.alpha > 0.004 && performance.now() < until);
    send();
    setTimeout(run, 0);
}

function wake(alpha: number) {
    if (!sim) return;
    sim.alpha = Math.max(sim.alpha, alpha);
    if (!running) { running = true; setTimeout(run, 0); }
}

self.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === 'init') {
        const n = m.x.length;
        sim = { x: Float64Array.from(m.x), y: Float64Array.from(m.y), vx: new Float64Array(n), vy: new Float64Array(n), fixed: -1, alpha: 0 };
    } else if (m.type === 'view') {
        ids = Array.from(m.ids as Int32Array);
        const a = m.a as Int32Array, b = m.b as Int32Array;
        edges = Array.from({ length: a.length }, (_, k) => ({ a: a[k], b: b[k] }));
        wake(m.alpha);
    } else if (m.type === 'drag' && sim) {
        sim.fixed = m.i;
        sim.x[m.i] = m.x; sim.y[m.i] = m.y;
        wake(0.15);
    } else if (m.type === 'release' && sim) {
        sim.fixed = -1;
    }
};
