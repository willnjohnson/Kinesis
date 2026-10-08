import type { ButtonHTMLAttributes } from 'react';
import { twMerge } from 'tailwind-merge';

/**
 * The app's secondary button: dark gray, a gray border, lighter on hover (Cancel in a dialog, Shuffle in a toolbar).
 * Its color classes are the exact ones index.css maps to the theme, so it follows every theme like the rest of the app.
 *
 *   md: a dialog's footer (px-4 py-2, text-sm)
 *   sm: a toolbar inside a window (px-2.5 py-1.5, 11px)
 *
 * An icon goes in as a child, before the label; the gap between them is built in.
 */
const SIZE = {
    md: 'px-4 py-2 rounded-lg text-sm',
    sm: 'px-2.5 py-1.5 rounded-md text-[11px]',
} as const;

export const SECONDARY_BUTTON_BASE =
    'inline-flex items-center justify-center gap-1.5 bg-[#222222] border border-[#383838] hover:bg-[#3f3f3f] text-white font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default disabled:hover:bg-[#222222]';

export function SecondaryButton({ size = 'md', className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
    size?: keyof typeof SIZE;
}) {
    // twMerge: a class given here wins over the base's own, whatever order the CSS is in.
    return <button type={type} className={twMerge(`${SECONDARY_BUTTON_BASE} ${SIZE[size]}`, className)} {...rest} />;
}
