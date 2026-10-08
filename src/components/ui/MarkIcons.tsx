import type { SVGProps } from 'react';

/**
 * Small marker icons drawn in the same grid and stroke as the app's Lucide icons (24 by 24, 2px, rounded), for the
 * marks Lucide has no shape for. They take `currentColor`, so a text color class colors them.
 *
 * The priority diamonds tell their level by how full they are, not only by color (outline, half, solid), so they read
 * without color too (red and green, in particular, look alike to many people).
 */
const base = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
};
const DIAMOND = 'M12 2.5 21.5 12 12 21.5 2.5 12Z';

/** Low priority: an outline diamond. */
export function DiamondLow(props: SVGProps<SVGSVGElement>) {
    return <svg {...base} {...props}><path d={DIAMOND} /></svg>;
}

/** Medium priority: a diamond filled up to half. */
export function DiamondMedium(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M2.5 12 21.5 12 12 21.5Z" fill="currentColor" stroke="none" />
            <path d={DIAMOND} />
        </svg>
    );
}

/** High priority: a solid diamond. */
export function DiamondHigh(props: SVGProps<SVGSVGElement>) {
    return <svg {...base} {...props}><path d={DIAMOND} fill="currentColor" /></svg>;
}

/** In progress: a circle half filled (started, not finished), between an empty to-do and a done check. */
export function InProgressIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg {...base} {...props}>
            <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="9" />
        </svg>
    );
}
