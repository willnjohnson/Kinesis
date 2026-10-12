/**
 * What the Tab key does in the app: it moves between the fields that are typed in, and nothing else. Left to the
 * webview, Tab walks every button, tab, link and row on the page in turn, which puts a focus ring on things that were
 * never meant to be reached that way and makes Enter or Space press whatever it landed on.
 *
 * So: from a field, Tab goes to the next field and Shift+Tab to the one before (Find to Replace, a log's Entry to its
 * Description, one box of a dialog to the next), in the order they're on the page, round again at the end. Buttons,
 * tabs and rows are passed over. Outside a field, Tab does nothing.
 *
 * A field that uses Tab itself keeps it: the handlers on the field run first, and a Tab they've taken (a list indented
 * in a Markdown editor, a suggestion accepted in the search bar) never gets here.
 */

/** Marks an element that stands in for a field while it isn't being typed in (a log's Description, drawn as text until
 *  it's focused), so Tab stops on it like the field it becomes. */
export const TAB_FIELD_ATTR = 'data-tab-field';

// Inputs that are typed in. Not the ones that are clicked: checkboxes, radios, sliders, color and file pickers, buttons.
const TYPED = new Set(['', 'text', 'search', 'number', 'email', 'url', 'tel', 'password', 'date', 'time', 'datetime-local', 'month', 'week']);

function isField(el: Element): el is HTMLElement {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hasAttribute(TAB_FIELD_ATTR)) return true;
    if (el instanceof HTMLInputElement) return TYPED.has((el.getAttribute('type') ?? '').toLowerCase());
    return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable;
}

/** A field Tab can land on: on screen, and able to be typed in. */
function usable(el: HTMLElement): boolean {
    if (el.tabIndex < 0 || el.getClientRects().length === 0) return false;
    if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return false;
    return getComputedStyle(el).visibility !== 'hidden';
}

/** Where Tab stays: the dialog or menu the field is in (each is drawn straight under the page's body, over the app),
 *  or the app itself. So Tab in a dialog never leaves it for a field underneath. */
function scopeOf(el: Element): Element {
    let at: Element = el;
    while (at.parentElement && at.parentElement !== document.body) at = at.parentElement;
    return at;
}

function onTab(e: KeyboardEvent) {
    if (e.key !== 'Tab' || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    // A field that took the key for itself.
    if (e.defaultPrevented) return;
    // From here on the webview's own walk through everything focusable never happens.
    e.preventDefault();
    const active = document.activeElement;
    if (!active || !isField(active)) return;
    const fields = [...scopeOf(active).querySelectorAll<HTMLElement>(`input, textarea, select, [contenteditable], [${TAB_FIELD_ATTR}]`)]
        .filter(el => el === active || (isField(el) && usable(el)));
    const at = fields.indexOf(active);
    if (at === -1 || fields.length < 2) return;
    const next = fields[(at + (e.shiftKey ? -1 : 1) + fields.length) % fields.length];
    next.focus();
    // As Tab does in any form: what's in a one-line box is selected, ready to be typed over.
    if (next instanceof HTMLInputElement) next.select();
}

/** Turns it on, once, for the whole app (main.tsx). */
export function installTabBetweenFields() {
    window.addEventListener('keydown', onTab);
}
