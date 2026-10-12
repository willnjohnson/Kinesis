import { useRef, type InputHTMLAttributes } from 'react';

const ON_LINUX = typeof navigator !== 'undefined' && /Linux/i.test(navigator.platform);

/**
 * A date field (the browser's own, with its calendar). On Linux the webview's calendar stays open after a day is picked
 * until Esc is pressed, so there the field lets go of focus once a pick changes it, which closes the calendar. A date
 * being typed changes it too (one part at a time): that's told apart by the key press just before it, and left alone.
 * `onValueChange` gets the new date ("2026-10-09"), or "" when it's cleared.
 */
export function DateInput({ value, onValueChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
    value: string;
    onValueChange: (value: string) => void;
}) {
    const lastKey = useRef(0);
    return (
        <input
            {...rest}
            type="date"
            value={value}
            onKeyDown={e => { lastKey.current = Date.now(); rest.onKeyDown?.(e); }}
            onChange={e => {
                onValueChange(e.target.value);
                if (ON_LINUX && e.target.value && Date.now() - lastKey.current > 400) {
                    const field = e.currentTarget;
                    // After the change has been taken in, so the pick isn't lost.
                    window.setTimeout(() => field.blur(), 0);
                }
            }}
        />
    );
}
