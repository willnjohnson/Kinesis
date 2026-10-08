/**
 * The graph view's layout (components/GraphModal.tsx), run in a worker (graph-layout.worker.ts) so the page stays smooth
 * while thousands of dots settle.
 */

// The layout's forces (a force-directed layout, no library): every dot pushes every other away (worked out with a
// Barnes-Hut quadtree, so a far-off cluster counts as one heavy dot: fast enough for thousands), a link pulls its two
// ends toward a set length, and everything drifts gently toward the middle.
export const REPEL = 60;
const THETA2 = 1.44;      // Barnes-Hut's accuracy (1.2 squared): a cell this small for its distance counts as one dot
const SPRING = 0.04;
const LENGTH = 40;
const GRAVITY = 0.006;
const DAMPING = 0.6;
const MAX_SPEED = 30;
const MAX_DEPTH = 24;     // dots in the very same spot stop splitting the tree here

export interface Sim {
    x: Float64Array; y: Float64Array; vx: Float64Array; vy: Float64Array;
    /** A dot being dragged stays where the pointer puts it. */
    fixed: number;
    alpha: number;
}

/** A quadtree over the dots, in flat arrays (no objects made per step): each cell's corner and size, its dots' total
 *  mass and summed position, its four children (0 for none; cell 0 is the root, never anyone's child), and its one dot
 *  while it's a leaf (-1 empty, -2 split). */
class QuadTree {
    cap = 0; count = 0;
    x0 = new Float64Array(0); y0 = new Float64Array(0); size = new Float64Array(0);
    mass = new Float64Array(0); sx = new Float64Array(0); sy = new Float64Array(0);
    child = new Int32Array(0); body = new Int32Array(0);
    stack = new Int32Array(0);

    reset(n: number) {
        const need = n * 2 * MAX_DEPTH / 4 + 64;
        if (need > this.cap) {
            this.cap = Math.ceil(need);
            this.x0 = new Float64Array(this.cap); this.y0 = new Float64Array(this.cap); this.size = new Float64Array(this.cap);
            this.mass = new Float64Array(this.cap); this.sx = new Float64Array(this.cap); this.sy = new Float64Array(this.cap);
            this.child = new Int32Array(this.cap * 4); this.body = new Int32Array(this.cap);
            this.stack = new Int32Array(this.cap * 4);
        }
        this.count = 0;
    }
    cell(x0: number, y0: number, size: number): number {
        if (this.count >= this.cap) return -1; // out of room: the dot just isn't split further (rare; see insert)
        const c = this.count++;
        this.x0[c] = x0; this.y0[c] = y0; this.size[c] = size;
        this.mass[c] = 0; this.sx[c] = 0; this.sy[c] = 0; this.body[c] = -1;
        this.child.fill(0, c * 4, c * 4 + 4);
        return c;
    }
    quadrant(c: number, px: number, py: number): number {
        const half = this.size[c] / 2;
        return (px >= this.x0[c] + half ? 1 : 0) + (py >= this.y0[c] + half ? 2 : 0);
    }
    childFor(c: number, q: number): number {
        let k = this.child[c * 4 + q];
        if (k === 0) {
            const half = this.size[c] / 2;
            k = this.cell(this.x0[c] + (q & 1 ? half : 0), this.y0[c] + (q & 2 ? half : 0), half);
            if (k < 0) return -1;
            this.child[c * 4 + q] = k;
        }
        return k;
    }
    insert(i: number, px: number, py: number, x: Float64Array, y: Float64Array) {
        let c = 0;
        for (let depth = 0; ; depth++) {
            this.mass[c] += 1; this.sx[c] += px; this.sy[c] += py;
            const b = this.body[c];
            if (b === -1 && this.mass[c] === 1) { this.body[c] = i; return; }
            if (depth >= MAX_DEPTH) return; // the same spot as another: counted here as extra mass
            if (b >= 0) {
                // A leaf with a dot already: split, moving that dot down a level.
                this.body[c] = -2;
                const k = this.childFor(c, this.quadrant(c, x[b], y[b]));
                if (k < 0) return;
                this.mass[k] += 1; this.sx[k] += x[b]; this.sy[k] += y[b]; this.body[k] = b;
            }
            const k = this.childFor(c, this.quadrant(c, px, py));
            if (k < 0) return;
            c = k;
        }
    }
}
const tree = new QuadTree();

/** One step of the layout over the dots shown (`ids`) and the edges between them. */
export function step(s: Sim, ids: number[], edges: { a: number; b: number }[]) {
    const { x, y, vx, vy } = s;
    if (ids.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const i of ids) { if (x[i] < minX) minX = x[i]; if (x[i] > maxX) maxX = x[i]; if (y[i] < minY) minY = y[i]; if (y[i] > maxY) maxY = y[i]; }
    tree.reset(ids.length);
    tree.cell(minX - 1, minY - 1, Math.max(maxX - minX, maxY - minY) + 2);
    for (const i of ids) tree.insert(i, x[i], y[i], x, y);

    const { mass, sx, sy, size, child, body, stack } = tree;
    for (const i of ids) {
        let fx = -x[i] * GRAVITY, fy = -y[i] * GRAVITY;
        let top = 0;
        stack[top++] = 0;
        while (top > 0) {
            const c = stack[--top];
            const m = mass[c];
            if (m === 0 || body[c] === i) continue;
            const dx = x[i] - sx[c] / m, dy = y[i] - sy[c] / m;
            let d2 = dx * dx + dy * dy;
            if (body[c] !== -2 || (size[c] * size[c]) / (d2 || 1) < THETA2) {
                // Far enough (or a leaf): the whole cell pushes as one.
                if (d2 < 1) d2 = 1;
                fx += (dx / d2) * REPEL * m; fy += (dy / d2) * REPEL * m;
            } else {
                for (let q = 0; q < 4; q++) { const k = child[c * 4 + q]; if (k) stack[top++] = k; }
            }
        }
        vx[i] = (vx[i] + fx * s.alpha) * DAMPING;
        vy[i] = (vy[i] + fy * s.alpha) * DAMPING;
        // No dot moves more than MAX_SPEED a step: a big cluster's push can't fling dots out of sight.
        const speed = Math.hypot(vx[i], vy[i]);
        if (speed > MAX_SPEED) { vx[i] *= MAX_SPEED / speed; vy[i] *= MAX_SPEED / speed; }
    }
    for (const e of edges) {
        const dx = x[e.b] - x[e.a], dy = y[e.b] - y[e.a];
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - LENGTH) * SPRING * s.alpha;
        const ux = (dx / d) * f, uy = (dy / d) * f;
        vx[e.a] += ux; vy[e.a] += uy; vx[e.b] -= ux; vy[e.b] -= uy;
    }
    for (const i of ids) {
        if (i === s.fixed) { vx[i] = 0; vy[i] = 0; continue; }
        x[i] += vx[i]; y[i] += vy[i];
    }
    s.alpha *= 0.975;
}
