import type { ElementType } from 'react';

export interface SegmentedOption<T extends string> {
    value: T;
    label: string;
    /** An icon before the label, and its color (the rest of the segment stays gray or white). */
    icon?: ElementType;
    iconClassName?: string;
    title?: string;
}

/**
 * A row of joined choices, one of them lit (Term | Definition in Flashcards). `value` may be null for none lit; picking
 * the lit one again calls `onPick` with it too, so a caller can treat that as "back to none" (a toggle) if it likes.
 */
export function Segmented<T extends string>({ options, value, onPick, disabled = false, className = '' }: {
    options: SegmentedOption<T>[];
    value: T | null;
    onPick: (value: T) => void;
    disabled?: boolean;
    className?: string;
}) {
    return (
        <div className={`flex items-center gap-0.5 p-0.5 rounded-lg bg-[#1a1a1a] border border-[#303030] ${disabled ? 'opacity-40 pointer-events-none' : ''} ${className}`}>
            {options.map(({ value: v, label, icon: Icon, iconClassName = '', title }) => {
                const on = v === value;
                return (
                    <button
                        key={v}
                        type="button"
                        onClick={() => onPick(v)}
                        aria-pressed={on}
                        title={title}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${on ? 'bg-[#3f3f3f] text-white' : 'text-gray-400 hover:text-white'}`}
                    >
                        {Icon && <Icon className={`w-3.5 h-3.5 ${iconClassName}`} />}
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
