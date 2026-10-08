/** A channel's alias (Edit Bio's optional name for it): italic, over a faint slanted stroke, the way a name is marked in a
 *  printed list. The stroke is a thin wash of the text's own color, so it stays quiet and reads in light themes as in
 *  dark. Sized from the text around it (em), so it fits a list row, a heading or a summary's footer. */
export function AliasBadge({ alias, displayName, className = '' }: { alias: string; displayName?: string; className?: string }) {
    // Hovering says which name is which: the alias, and the channel's own name.
    const title = displayName?.trim() ? `Alias: ${alias}

Display Name: ${displayName.trim()}` : `Alias: ${alias}`;
    return (
        <span className={`relative inline-block px-[0.35em] italic font-semibold whitespace-nowrap align-baseline ${className}`} title={title} data-tooltip-labels="">
            <span aria-hidden className="absolute inset-x-0 top-[0.18em] bottom-[0.02em] -skew-x-12 rounded-[2px] bg-current opacity-[0.14]" />
            <span className="relative">{alias}</span>
        </span>
    );
}
