import type { ReactNode, SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { twMerge } from 'tailwind-merge';

/**
 * The app's dropdown, with a chevron of its own: the browser's arrow ignores the right padding and sits against the
 * edge, out of line with the text (so the native one is hidden, `appearance-none`, and this one sits inside the padding).
 *
 * look:
 *   sm:      a small picker in a header or toolbar (the Glossary's view picker; 11px)
 *   field:   a form field in a window (full width, the same look as the text inputs beside it)
 *   setting: a control at the end of a Settings row (Display's resolution, History's clear-after)
 *   compact: a small bordered picker in a tight row (the tray popup's Drive, Glossary Detect's scope)
 *
 * `onValueChange` gets the picked value. With `blurOnChange`, focus is let go once something is picked, so keys go back
 * to whatever the window does with them (the arrow keys moving through flashcards, say) instead of changing the pick.
 */
const LOOK = {
    sm: { select: 'pl-2.5 pr-7 py-1.5 bg-[#272727] hover:bg-[#3f3f3f] text-white rounded-md text-[11px] font-semibold transition-colors', chevron: 'right-2 w-3.5 h-3.5 text-gray-400' },
    field: { select: 'w-full pl-4 pr-10 py-3 bg-[#121212] border border-[#333] hover:border-[#505050] focus:border-red-600 text-white rounded-xl text-sm transition-colors', chevron: 'right-4 w-4 h-4 text-gray-500' },
    setting: { select: 'pl-3 pr-9 py-1.5 bg-[#121212] border border-[#303030] hover:bg-[#202020] text-white rounded-lg text-sm transition-colors', chevron: 'right-3 w-4 h-4 text-gray-500' },
    compact: { select: 'pl-2 pr-7 h-7 bg-[#121212] border border-[#303030] hover:border-[#505050] text-white rounded-md text-[11px] transition-colors', chevron: 'right-2 w-3.5 h-3.5 text-gray-500' },
} as const;

export function Select({ look: lookName = 'sm', value, onValueChange, blurOnChange = false, className = '', wrapperClassName = '', children, ...rest }:
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> & {
        look?: keyof typeof LOOK;
        value: string;
        onValueChange: (value: string) => void;
        blurOnChange?: boolean;
        /** Classes for the wrapper (its width, its margins). */
        wrapperClassName?: string;
        children: ReactNode;
    }) {
    const look = LOOK[lookName];
    return (
        <span className={`relative inline-flex ${lookName === 'field' ? 'w-full' : ''} ${wrapperClassName}`}>
            <select
                value={value}
                onChange={e => { onValueChange(e.target.value); if (blurOnChange) e.currentTarget.blur(); }}
                // twMerge: a class given here wins over the look's own (a taller h-8 over h-7), whatever order the CSS is in.
                className={twMerge(`appearance-none outline-none cursor-pointer disabled:opacity-40 disabled:cursor-default ${look.select}`, className)}
                {...rest}
            >
                {children}
            </select>
            <ChevronDown className={`absolute top-1/2 -translate-y-1/2 pointer-events-none ${look.chevron}`} />
        </span>
    );
}
