import type { ElementType, ReactNode } from 'react';

export interface UnderlineTab<T extends string> {
    id: T;
    label: string;
    icon: ElementType;
    /** The tooltip; the label when left out (labels can be cut short to fit). */
    title?: string;
    /** Something after the label (a count, say). */
    badge?: ReactNode;
}

/**
 * The app's small tab row: uppercase labels with an icon, the active one white with a red line under it (the
 * sidebar's Terms / Tags / Similar..., the Export and History tabs, the tray popup). Labels shrink to an ellipsis
 * rather than wrap when the row is tight.
 */
export function UnderlineTabs<T extends string>({ tabs, active, onChange, className = 'flex items-center gap-4' }: {
    tabs: UnderlineTab<T>[];
    active: T;
    onChange: (id: T) => void;
    /** The row's layout and spacing (`mb-3` and the like go here). */
    className?: string;
}) {
    return (
        <div className={className}>
            {tabs.map(({ id, label, icon: Icon, title, badge }) => (
                <button
                    key={id}
                    type="button"
                    onClick={() => onChange(id)}
                    title={title ?? label}
                    className={`flex items-center gap-1.5 min-w-0 pb-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer relative ${active === id ? 'text-white' : 'text-[#666666] hover:text-[#aaaaaa]'}`}
                >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{label}</span>
                    {badge}
                    {active === id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-600" />}
                </button>
            ))}
        </div>
    );
}
