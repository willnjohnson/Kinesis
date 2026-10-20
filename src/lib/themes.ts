import { getSetting, setSetting } from '../api';

// Text/icons sitting on a solid, colored (non-white/near-white) fill — a button, a selected row,
// a chip — are always light, in every theme, full stop. No per-theme contrast computation: an
// earlier version of this picked dark text for Solarized's blue accent because it measured a hair
// better under strict WCAG luminance math, which was wrong in practice (dark-on-saturated-color
// reads worse than the numbers suggest). White unconditionally is simpler and matches the rule.
const TEXT_ON_ACCENT = '#ffffff';

// The Theme system: a small, human-friendly palette (`ThemeColors`) that both built-in themes and
// user-imported JSON files provide, expanded at runtime into the much larger set of raw CSS custom
// properties (`RAW_TOKEN_KEYS`) that index.css actually reads. Two tiers, not one, because Dark and
// Light need to stay pixel-identical to the hand-tuned values Kinesis already shipped (which don't
// reduce cleanly to ~12 semantic slots), while a theme a user hand-writes or imports should only
// ever need to fill in a handful of recognizable fields, not dozens of near-duplicate grays.

// The small, public palette — what BUILTIN_THEMES (other than dark/light) and an imported JSON file
// provide. Every value is a CSS color (hex, rgb()/rgba(), etc.).
export interface ThemeColors {
    bg: string;             // page background
    surface: string;        // panel/card background
    surfaceAlt: string;     // a second, slightly different panel shade (tooltips, dropdowns)
    surfaceRaised: string;  // hover/raised surfaces (buttons, active rows)
    border: string;         // default border color
    borderStrong: string;   // a more visible border (dividers, focused inputs)
    text: string;           // primary text
    textMuted: string;      // secondary/dim text
    accent: string;         // brand/primary accent (buttons, selection)
    accentHover: string;
    danger: string;         // destructive actions, errors
    success: string;        // confirmations
    warning: string;        // caution/hint indicators (shortcut hints, bookmarked markers, ...)
}

// The colors of code in a fenced block (lib/code-highlight.ts marks its parts; index.css's `.hljs-*` rules read these
// as --k-code-*). A built-in theme has its palette's own syntax colors, so a block reads as that theme does in an
// editor. An imported theme may give them (a `syntax` object in its JSON, any of these keys); what it leaves out is
// taken from its ThemeColors (deriveSyntax).
export interface SyntaxColors {
    keyword: string;        // if, return, class, and a tag's name in markup
    string: string;
    number: string;         // numbers, and true / false / null
    comment: string;
    function: string;       // a function's or a class's name where it's defined
    type: string;           // int, string, a class used as a type
    builtin: string;        // what the language provides: print, std, console
    meta: string;           // #include, decorators, a doctype
}

export interface Theme {
    name: string;           // stable id, stored in the `theme` setting and as the React key
    label: string;          // shown in the picker
    scheme: 'dark' | 'light'; // drives `color-scheme` for native scrollbars/form controls
    colors: ThemeColors;    // always present — used for the picker's swatch preview even for dark/light
    syntax?: Partial<SyntaxColors>; // code colors; see SyntaxColors
    builtin?: boolean;      // hides the delete affordance in ThemeTab
}

// The full set of raw CSS custom properties index.css's per-class overrides consume. Dark/Light
// supply every one of these directly (RAW_TOKENS_DARK/LIGHT below) to stay pixel-identical to the
// values index.css originally hardcoded; every other theme has its (much larger) set of levels
// derived from the small ThemeColors palette by deriveRawTokens.
interface RawTokens { [cssVarName: string]: string }

// Named directly after the Tailwind class each one replaces (`bg-121212` <- `.bg-[#121212]`)
// rather than a semantic elevation scale — with 20+ distinct background shades alone, per-class
// naming is what's actually verifiable against the old override block, which is the point of this
// being a mechanical port. A handful of the old file's rules are deliberately NOT represented here
// at all (`.prose` colors, bare `code`/`input`/`select`) — see index.css's own comment where those
// are kept as literal, unconverted `:root:not(.dark)` rules instead, and why.
const RAW_TOKEN_KEYS = [
    'bg', 'bg-121212', 'bg-141414', 'bg-1a1a1a', 'bg-202020', 'bg-222222', 'bg-272727', 'bg-2a2a2a',
    'bg-303030', 'bg-333333', 'bg-3f3f3f', 'bg-444444',
    'overlay-black-20', 'overlay-black-40', 'overlay-black-60', 'overlay-black-70', 'overlay-black-80',
    'bg-gray-900-50', 'bg-gray-800', 'bg-white-5',
    // Text
    'text-white', 'text-aaaaaa', 'text-888888', 'text-gray-200', 'text-gray-300', 'text-gray-400',
    'text-gray-500', 'text-gray-600', 'text-gray-700', 'text-gray-800', 'text-gray-900',
    // Borders
    'border-303030', 'border-333', 'border-333333', 'border-383838', 'border-404040', 'border-444',
    'border-505050', 'border-gray-700', 'border-gray-800', 'border-white-5',
    // Hover backgrounds/borders
    'hover-bg-333333', 'hover-bg-3f3f3f', 'hover-bg-444', 'hover-bg-444444', 'hover-bg-272727', 'hover-bg-2a2a2a', 'hover-bg-202020',
    'hover-bg-gray-700', 'hover-text-white', 'hover-border-505050', 'hover-border-555555',
    // Brand / semantic colors. `text-on-accent` is deliberately separate from `text-white` above:
    // `text-white` means "primary text on the page/surface background" (flips dark<->light per
    // theme), while `text-on-accent` means "text sitting on top of a solid accent-colored button/
    // row" (a selected WdbsTreePanel row, the Drive/Bulk-Assign toggle buttons, a Delete
    // confirmation button, ...) — those need to stay legible against the *accent* color specifically,
    // regardless of what the page background is doing, so they can't share Tailwind's `text-white`
    // class with ordinary page text without one of the two contexts rendering unreadable.
    'accent', 'accent-hover', 'success', 'success-hover', 'info', 'info-hover', 'purple', 'text-on-accent',
    // Danger surfaces (Sidebar delete button, etc.)
    'danger-surface', 'danger-text', 'danger-surface-hover',
    // Misc
    'warning', 'scrollbar-thumb', 'scrollbar-thumb-hover',
] as const;

// The exact values index.css hardcoded before this system existed — dark from each Tailwind
// class's own literal hex, light from the old `:root:not(.dark)` override block — so switching to
// Dark/Light after this change looks exactly like it did before it.
//
// `accent-hover`/`success-hover`/`info-hover`'s dark values are Tailwind's own red-500/green-500/
// blue-500 (NOT the same as `accent`/`success`/`info`, and NOT literally what the old file's
// `.bg-red-600:hover` rule said either): a `.bg-red-600:hover` selector matches on the *pseudo-
// class*, independent of whatever other classes an element has, so it already won the cascade
// over each button's own separate `hover:bg-red-500`/`hover:bg-red-700` class in every mode where
// it applied — the old file only gated it to `:not(.dark)`, so dark mode had no competing rule and
// fell through to each button's own `hover:bg-red-*` class, i.e. Tailwind's stock hover shade.
// Making the rule unconditional here means it now needs an explicit dark value that matches what
// was actually showing before, not the (different) `accent` base color.
const TW_RED_500 = '#ef4444', TW_GREEN_500 = '#22c55e', TW_BLUE_500 = '#3b82f6';
const RAW_TOKENS_DARK: RawTokens = {
    bg: '#0f0f0f',
    'bg-121212': '#121212', 'bg-141414': '#141414', 'bg-1a1a1a': '#1a1a1a', 'bg-202020': '#202020',
    'bg-222222': '#222222', 'bg-272727': '#272727', 'bg-2a2a2a': '#2a2a2a', 'bg-303030': '#303030',
    'bg-333333': '#333333', 'bg-3f3f3f': '#3f3f3f', 'bg-444444': '#444444',
    'overlay-black-20': 'rgba(0,0,0,0.2)', 'overlay-black-40': 'rgba(0,0,0,0.4)',
    'overlay-black-60': 'rgba(0,0,0,0.6)', 'overlay-black-70': 'rgba(0,0,0,0.7)', 'overlay-black-80': 'rgba(0,0,0,0.8)',
    'bg-gray-900-50': 'rgba(17,24,39,0.5)', 'bg-gray-800': '#1f2937', 'bg-white-5': 'rgba(255,255,255,0.05)',
    'text-white': '#ffffff', 'text-aaaaaa': '#aaaaaa', 'text-888888': '#888888',
    'text-gray-200': '#e5e7eb', 'text-gray-300': '#d1d5db', 'text-gray-400': '#9ca3af', 'text-gray-500': '#6b7280',
    'text-gray-600': '#4b5563', 'text-gray-700': '#374151', 'text-gray-800': '#1f2937', 'text-gray-900': '#111827',
    'border-303030': '#303030', 'border-333': '#333333', 'border-333333': '#333333', 'border-383838': '#383838',
    'border-404040': '#404040', 'border-444': '#444444', 'border-505050': '#505050',
    'border-gray-700': '#374151', 'border-gray-800': '#1f2937', 'border-white-5': 'rgba(255,255,255,0.05)',
    'hover-bg-333333': '#333333', 'hover-bg-3f3f3f': '#3f3f3f', 'hover-bg-444': '#444444', 'hover-bg-444444': '#444444',
    'hover-bg-272727': '#272727', 'hover-bg-2a2a2a': '#2a2a2a', 'hover-bg-202020': '#202020', 'hover-bg-gray-700': '#374151',
    'hover-text-white': '#ffffff', 'hover-border-505050': '#505050', 'hover-border-555555': '#555555',
    accent: '#dc2626', 'accent-hover': TW_RED_500, success: '#16a34a', 'success-hover': TW_GREEN_500,
    info: '#2563eb', 'info-hover': TW_BLUE_500, purple: '#9333ea', 'text-on-accent': TEXT_ON_ACCENT,
    'danger-surface': 'rgba(127,29,29,0.1)', 'danger-text': '#ef4444', 'danger-surface-hover': 'rgba(127,29,29,0.2)',
    warning: '#fb923c', 'scrollbar-thumb': '#717171', 'scrollbar-thumb-hover': '#aaaaaa',
};

// The old `:root:not(.dark)` override block's target values, carried over 1:1. A few genuine
// duplicate/conflicting rules existed in the old file for identical selectors (`.bg-[#1a1a1a]`,
// `.bg-[#303030]`, `.border-[#333]`, `.text-gray-300`, `.text-gray-500` were each declared twice
// with the same value — harmless; `.hover\:bg-[#272727]:hover` and `.text-gray-200` were each
// declared twice with *different* values — `#dddddd` then `#bbbbbb` for the former, `#222222`
// then `#333333` for the latter — CSS cascade order meant the later rule silently won everywhere
// that class was used, so `#bbbbbb`/`#333333` (below) is what light mode has actually been
// rendering, not `#dddddd`/`#222222`).
const RAW_TOKENS_LIGHT: RawTokens = {
    bg: '#ffffff',
    'bg-121212': '#f5f5f5', 'bg-141414': '#f0f0f0', 'bg-1a1a1a': '#f0f0f0', 'bg-202020': '#e5e5e5',
    'bg-222222': '#ebebeb', 'bg-272727': '#e8e8e8', 'bg-2a2a2a': '#e0e0e0', 'bg-303030': '#e0e0e0',
    'bg-333333': '#d5d5d5', 'bg-3f3f3f': '#d5d5d5', 'bg-444444': '#cccccc',
    'overlay-black-20': '#f5f5f5', 'overlay-black-40': 'rgba(0,0,0,0.05)',
    'overlay-black-60': 'rgba(0,0,0,0.08)', 'overlay-black-70': 'rgba(0,0,0,0.4)', 'overlay-black-80': 'rgba(0,0,0,0.45)',
    'bg-gray-900-50': '#e8e8e8', 'bg-gray-800': '#d5d5d5', 'bg-white-5': '#f9f9f9',
    'text-white': '#1a1a1a', 'text-aaaaaa': '#5c5c5c', 'text-888888': '#555555',
    'text-gray-200': '#333333', 'text-gray-300': '#333333', 'text-gray-400': '#555555', 'text-gray-500': '#666666',
    'text-gray-600': '#555555', 'text-gray-700': '#444444', 'text-gray-800': '#222222', 'text-gray-900': '#1a1a1a',
    'border-303030': '#d8d8d8', 'border-333': '#cccccc', 'border-333333': '#dddddd', 'border-383838': '#cccccc',
    'border-404040': '#cccccc', 'border-444': '#bbbbbb', 'border-505050': '#999999',
    'border-gray-700': '#cccccc', 'border-gray-800': '#bbbbbb', 'border-white-5': '#e5e5e5',
    'hover-bg-333333': '#d0d0d0', 'hover-bg-3f3f3f': '#d0d0d0', 'hover-bg-444': '#cccccc', 'hover-bg-444444': '#d5d5d5',
    'hover-bg-272727': '#bbbbbb', 'hover-bg-2a2a2a': '#e5e5e5', 'hover-bg-202020': '#d5d5d5', 'hover-bg-gray-700': '#cccccc',
    'hover-text-white': '#000000', 'hover-border-505050': '#999999', 'hover-border-555555': '#777777',
    accent: '#cc0000', 'accent-hover': '#aa0000', success: '#16a34a', 'success-hover': '#15803d',
    info: '#2563eb', 'info-hover': '#1d4ed8', purple: '#9333ea', 'text-on-accent': TEXT_ON_ACCENT,
    'danger-surface': '#ffebee', 'danger-text': '#cc0000', 'danger-surface-hover': '#ffcdd2',
    warning: '#c2410c', 'scrollbar-thumb': '#cccccc', 'scrollbar-thumb-hover': '#999999',
};

// Fans a small, human-friendly palette out to the full raw token set for any theme that isn't Dark
// or Light. Doesn't try to reproduce Kinesis's original ~11-step background scale exactly — a
// themed palette (Dracula, Nord, a custom import) just needs a handful of visually distinct,
// coherent levels, not an exact copy of it.
function deriveRawTokens(colors: ThemeColors): RawTokens {
    // The hovers that were a step *up* from #272727/#303030 in Dark (#333333, #3f3f3f, #444...) have to land a step up
    // from surfaceRaised here too, since that's what bg-272727/303030 become: mapping them to surfaceRaised itself made
    // hovering a menu item or button on a raised surface (every right-click menu, for one) change nothing at all. Nudged
    // toward the text color, so it goes lighter in a dark theme and darker in a light one.
    const raisedHover = `color-mix(in srgb, ${colors.surfaceRaised}, ${colors.text} 12%)`;
    return {
        bg: colors.bg,
        'bg-121212': colors.surface, 'bg-141414': colors.surface, 'bg-1a1a1a': colors.surfaceAlt, 'bg-202020': colors.surfaceAlt,
        'bg-222222': colors.surfaceAlt, 'bg-272727': colors.surfaceRaised, 'bg-2a2a2a': colors.surfaceRaised, 'bg-303030': colors.surfaceRaised,
        'bg-333333': colors.borderStrong, 'bg-3f3f3f': colors.borderStrong, 'bg-444444': colors.borderStrong,
        'overlay-black-20': 'rgba(0,0,0,0.2)', 'overlay-black-40': 'rgba(0,0,0,0.4)',
        'overlay-black-60': 'rgba(0,0,0,0.6)', 'overlay-black-70': 'rgba(0,0,0,0.7)', 'overlay-black-80': 'rgba(0,0,0,0.8)',
        'bg-gray-900-50': colors.surfaceAlt, 'bg-gray-800': colors.surfaceRaised, 'bg-white-5': colors.surfaceAlt,
        'text-white': colors.text, 'text-aaaaaa': colors.textMuted, 'text-888888': colors.textMuted,
        'text-gray-200': colors.text, 'text-gray-300': colors.textMuted, 'text-gray-400': colors.textMuted, 'text-gray-500': colors.textMuted,
        'text-gray-600': colors.textMuted, 'text-gray-700': colors.textMuted, 'text-gray-800': colors.text, 'text-gray-900': colors.text,
        'border-303030': colors.border, 'border-333': colors.border, 'border-333333': colors.border, 'border-383838': colors.border,
        'border-404040': colors.border, 'border-444': colors.borderStrong, 'border-505050': colors.borderStrong,
        'border-gray-700': colors.border, 'border-gray-800': colors.borderStrong, 'border-white-5': colors.border,
        'hover-bg-333333': raisedHover, 'hover-bg-3f3f3f': raisedHover, 'hover-bg-444': raisedHover, 'hover-bg-444444': raisedHover,
        'hover-bg-272727': colors.surfaceRaised, 'hover-bg-2a2a2a': colors.surfaceRaised, 'hover-bg-202020': colors.surfaceRaised, 'hover-bg-gray-700': raisedHover,
        'hover-text-white': colors.text, 'hover-border-505050': colors.borderStrong, 'hover-border-555555': colors.borderStrong,
        accent: colors.accent, 'accent-hover': colors.accentHover, success: colors.success, 'success-hover': colors.success,
        info: colors.accent, 'info-hover': colors.accentHover, purple: colors.accentHover,
        'text-on-accent': TEXT_ON_ACCENT,
        'danger-surface': colors.danger, 'danger-text': colors.danger, 'danger-surface-hover': colors.danger,
        warning: colors.warning, 'scrollbar-thumb': colors.borderStrong, 'scrollbar-thumb-hover': colors.textMuted,
    };
}

// Approximate ThemeColors read off each palette's own official spec, for the picker's swatch
// preview — verify against the theme's source (draculatheme.com/api, nordtheme.com, etc.) if a
// palette ever looks off, since these were transcribed from memory rather than fetched live.
//
// `textMuted` deliberately is NOT each theme's own "comment" color, even though that's the most
// authentic-looking choice — a real syntax-highlighting theme's comment color is often
// *intentionally* low-contrast against its own background (comments are meant to visually recede),
// which measured under WCAG well below the 4.5:1 this app needs for `textMuted` to stay legible
// everywhere it's actually used here (secondary button/icon labels sitting on `surfaceRaised`, not
// just body text on `bg`). Each value below was computed by blending that authentic comment color
// toward neutral gray until it cleared 4.5:1 against `surfaceRaised`, `surface`, and `bg` alike, so
// it reads as "dimmer than primary text" without ever becoming genuinely hard to read. Solarized's
// `surfaceRaised` needed the same treatment in the other direction (darkened, since even its own
// full-brightness `text` failed contrast against the original value).
const DRACULA: ThemeColors = {
    bg: '#282a36', surface: '#21222c', surfaceAlt: '#343746', surfaceRaised: '#44475a',
    border: '#44475a', borderStrong: '#6272a4', text: '#f8f8f2', textMuted: '#b7b7b4',
    accent: '#bd93f9', accentHover: '#ff79c6', danger: '#ff5555', success: '#50fa7b', warning: '#f1fa8c',
};
const NORD: ThemeColors = {
    bg: '#2e3440', surface: '#3b4252', surfaceAlt: '#434c5e', surfaceRaised: '#4c566a',
    border: '#434c5e', borderStrong: '#4c566a', text: '#eceff4', textMuted: '#d8dee9',
    accent: '#88c0d0', accentHover: '#81a1c1', danger: '#bf616a', success: '#a3be8c', warning: '#ebcb8b',
};
const SOLARIZED_DARK: ThemeColors = {
    bg: '#002b36', surface: '#073642', surfaceAlt: '#0a4551', surfaceRaised: '#0d3a46',
    border: '#586e75', borderStrong: '#657b83', text: '#93a1a1', textMuted: '#92a0a0',
    accent: '#268bd2', accentHover: '#2aa198', danger: '#dc322f', success: '#859900', warning: '#b58900',
};
const MONOKAI: ThemeColors = {
    bg: '#272822', surface: '#2d2e27', surfaceAlt: '#3e3d32', surfaceRaised: '#49483e',
    border: '#49483e', borderStrong: '#75715e', text: '#f8f8f2', textMuted: '#b7b7b4',
    accent: '#66d9ef', accentHover: '#f92672', danger: '#f92672', success: '#a6e22e', warning: '#fd971f',
};
const GRUVBOX: ThemeColors = {
    bg: '#282828', surface: '#32302f', surfaceAlt: '#3c3836', surfaceRaised: '#504945',
    border: '#504945', borderStrong: '#665c54', text: '#ebdbb2', textMuted: '#c4baa0',
    accent: '#d79921', accentHover: '#fe8019', danger: '#fb4934', success: '#b8bb26', warning: '#fabd2f',
};
const ONE_DARK: ThemeColors = {
    bg: '#282c34', surface: '#21252b', surfaceAlt: '#2c313c', surfaceRaised: '#3b4048',
    border: '#3b4048', borderStrong: '#4b5263', text: '#abb2bf', textMuted: '#a5abb6',
    accent: '#61afef', accentHover: '#c678dd', danger: '#e06c75', success: '#98c379', warning: '#e5c07b',
};
const TOKYO_NIGHT: ThemeColors = {
    bg: '#1a1b26', surface: '#1f2335', surfaceAlt: '#24283b', surfaceRaised: '#414868',
    border: '#414868', borderStrong: '#565f89', text: '#c0caf5', textMuted: '#b1b8d9',
    accent: '#7aa2f7', accentHover: '#bb9af7', danger: '#f7768e', success: '#9ece6a', warning: '#e0af68',
};
// Two light palettes for long reading. Gruvbox's own light variant (github.com/morhetz/gruvbox): its warm, manila
// bg0/bg0_s/bg1/bg2/bg3 as the surfaces, fg1 as the text, and the "faded" colors it gives light backgrounds (orange as
// the accent: dark enough for the white text that sits on an accent). `textMuted` is its fg2, not the lighter fg3/fg4,
// which fall short of 4.5:1 on `surfaceRaised` (see the note above).
const GRUVBOX_LIGHT: ThemeColors = {
    bg: '#fbf1c7', surface: '#f2e5bc', surfaceAlt: '#ebdbb2', surfaceRaised: '#d5c4a1',
    border: '#d5c4a1', borderStrong: '#bdae93', text: '#3c3836', textMuted: '#504945',
    accent: '#af3a03', accentHover: '#d65d0e', danger: '#9d0006', success: '#79740e', warning: '#b57614',
};
// Catppuccin's light flavor, Latte (catppuccin.com/palette): a cool, soft gray-blue page. Base/Mantle/Crust/Surface 0
// as the surfaces, Text, Mauve and Blue as the accents, Red/Green/Yellow. `textMuted` sits between its Text and
// Subtext 1, which alone falls short of 4.5:1 on `surfaceRaised`.
const CATPPUCCIN_LATTE: ThemeColors = {
    bg: '#eff1f5', surface: '#e6e9ef', surfaceAlt: '#dce0e8', surfaceRaised: '#ccd0da',
    border: '#ccd0da', borderStrong: '#acb0be', text: '#4c4f69', textMuted: '#54576f',
    accent: '#8839ef', accentHover: '#1e66f5', danger: '#d20f39', success: '#40a02b', warning: '#df8e1d',
};
// Pulled from github.com/Foreglow/foreglow-theme's README color table — the base "Foreglow"
// variant specifically (the repo also ships Afterglow/Alpenglow/Airglow, which aren't included
// here), using its own Background/Bg Alt/Current Line/Selection/Border/Foreground/Foreground Dim/
// Cursor-Accent/Error/Warning/Success rows directly rather than approximated substitutes.
const FOREGLOW: ThemeColors = {
    bg: '#161221', surface: '#1D182A', surfaceAlt: '#281F3D', surfaceRaised: '#3D2556',
    border: '#322C44', borderStrong: '#736699', text: '#E8E3F2', textMuted: '#A49BBF',
    accent: '#F471C8', accentHover: '#CB81E4', danger: '#E46772', success: '#6BC7A8', warning: '#F2A65A',
};

// Each built-in theme's code colors, from the palette's own syntax theme (the same caveat as the palettes above:
// transcribed, not fetched). Erebos and Phos are the app's own themes and have no editor theme behind them: theirs are
// a plain dark and a plain light set in the manner of GitHub's. Foreglow's are its palette's own colors given roles
// (its README lists a palette, not a syntax theme).
const SYNTAX: Record<string, SyntaxColors> = {
    dark: { keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', comment: '#8b949e', function: '#d2a8ff', type: '#ffa657', builtin: '#79c0ff', meta: '#8b949e' },
    light: { keyword: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#6e7781', function: '#8250df', type: '#953800', builtin: '#0550ae', meta: '#6e7781' },
    dracula: { keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4', function: '#50fa7b', type: '#8be9fd', builtin: '#8be9fd', meta: '#ffb86c' },
    nord: { keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', comment: '#616e88', function: '#88c0d0', type: '#8fbcbb', builtin: '#88c0d0', meta: '#5e81ac' },
    solarized: { keyword: '#859900', string: '#2aa198', number: '#d33682', comment: '#586e75', function: '#268bd2', type: '#b58900', builtin: '#268bd2', meta: '#cb4b16' },
    monokai: { keyword: '#f92672', string: '#e6db74', number: '#ae81ff', comment: '#75715e', function: '#a6e22e', type: '#66d9ef', builtin: '#66d9ef', meta: '#fd971f' },
    gruvbox: { keyword: '#fb4934', string: '#b8bb26', number: '#d3869b', comment: '#928374', function: '#83a598', type: '#fabd2f', builtin: '#fe8019', meta: '#8ec07c' },
    'gruvbox-light': { keyword: '#9d0006', string: '#79740e', number: '#8f3f71', comment: '#928374', function: '#076678', type: '#b57614', builtin: '#af3a03', meta: '#427b58' },
    'one-dark': { keyword: '#c678dd', string: '#98c379', number: '#d19a66', comment: '#5c6370', function: '#61afef', type: '#e5c07b', builtin: '#56b6c2', meta: '#61afef' },
    'tokyo-night': { keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64', comment: '#565f89', function: '#7aa2f7', type: '#2ac3de', builtin: '#7dcfff', meta: '#89ddff' },
    'catppuccin-latte': { keyword: '#8839ef', string: '#40a02b', number: '#fe640b', comment: '#7c7f93', function: '#1e66f5', type: '#df8e1d', builtin: '#d20f39', meta: '#179299' },
    foreglow: { keyword: '#F471C8', string: '#6BC7A8', number: '#F2A65A', comment: '#736699', function: '#CB81E4', type: '#F2A65A', builtin: '#CB81E4', meta: '#A49BBF' },
};

/** Code colors for a theme that gives none of its own (an imported one): its accent for keywords, its success color
 *  for strings, its warning color for numbers and types, and its muted text for comments. */
function deriveSyntax(colors: ThemeColors): SyntaxColors {
    return {
        keyword: colors.accent, string: colors.success, number: colors.warning, comment: colors.textMuted,
        function: colors.accentHover, type: colors.warning, builtin: colors.accentHover, meta: colors.textMuted,
    };
}

const SYNTAX_KEYS: (keyof SyntaxColors)[] = ['keyword', 'string', 'number', 'comment', 'function', 'type', 'builtin', 'meta'];

/** A theme's code colors, all eight: the built-in theme's own, or an imported theme's (what it gives, the rest from
 *  its palette). What applyTheme sets, and what the theme template a reader copies shows. */
export function syntaxOf(theme: Theme): SyntaxColors {
    return { ...deriveSyntax(theme.colors), ...(theme.builtin ? SYNTAX[theme.name] : theme.syntax) };
}

export const BUILTIN_THEMES: Theme[] = [
    { name: 'dark', label: 'Erebos', scheme: 'dark', builtin: true, colors: {
        bg: RAW_TOKENS_DARK.bg, surface: RAW_TOKENS_DARK['bg-121212'], surfaceAlt: RAW_TOKENS_DARK['bg-1a1a1a'],
        surfaceRaised: RAW_TOKENS_DARK['bg-303030'], border: RAW_TOKENS_DARK['border-303030'], borderStrong: RAW_TOKENS_DARK['border-505050'],
        text: RAW_TOKENS_DARK['text-white'], textMuted: RAW_TOKENS_DARK['text-gray-400'],
        accent: RAW_TOKENS_DARK.accent, accentHover: RAW_TOKENS_DARK['accent-hover'],
        danger: RAW_TOKENS_DARK['danger-text'], success: RAW_TOKENS_DARK.success, warning: RAW_TOKENS_DARK.warning,
    } },
    { name: 'light', label: 'Phos', scheme: 'light', builtin: true, colors: {
        bg: RAW_TOKENS_LIGHT.bg, surface: RAW_TOKENS_LIGHT['bg-121212'], surfaceAlt: RAW_TOKENS_LIGHT['bg-1a1a1a'],
        surfaceRaised: RAW_TOKENS_LIGHT['bg-303030'], border: RAW_TOKENS_LIGHT['border-303030'], borderStrong: RAW_TOKENS_LIGHT['border-505050'],
        text: RAW_TOKENS_LIGHT['text-white'], textMuted: RAW_TOKENS_LIGHT['text-gray-400'],
        accent: RAW_TOKENS_LIGHT.accent, accentHover: RAW_TOKENS_LIGHT['accent-hover'],
        danger: RAW_TOKENS_LIGHT['danger-text'], success: RAW_TOKENS_LIGHT.success, warning: RAW_TOKENS_LIGHT.warning,
    } },
    { name: 'dracula', label: 'Dracula', scheme: 'dark', builtin: true, colors: DRACULA },
    { name: 'nord', label: 'Nord', scheme: 'dark', builtin: true, colors: NORD },
    { name: 'solarized', label: 'Solarized', scheme: 'dark', builtin: true, colors: SOLARIZED_DARK },
    { name: 'monokai', label: 'Monokai', scheme: 'dark', builtin: true, colors: MONOKAI },
    { name: 'gruvbox', label: 'Gruvbox', scheme: 'dark', builtin: true, colors: GRUVBOX },
    { name: 'gruvbox-light', label: 'Gruvbox Light', scheme: 'light', builtin: true, colors: GRUVBOX_LIGHT },
    { name: 'one-dark', label: 'One Dark', scheme: 'dark', builtin: true, colors: ONE_DARK },
    { name: 'tokyo-night', label: 'Tokyo Night', scheme: 'dark', builtin: true, colors: TOKYO_NIGHT },
    { name: 'catppuccin-latte', label: 'Catppuccin Latte', scheme: 'light', builtin: true, colors: CATPPUCCIN_LATTE },
    { name: 'foreglow', label: 'Foreglow', scheme: 'dark', builtin: true, colors: FOREGLOW },
];

export const DEFAULT_THEME = BUILTIN_THEMES[0];

export const BLOCKQUOTE_ACCENT_COLORS: Record<string, string> = {
    red: '#ef4444',
    darkRed: '#991b1b',
    lightRed: '#fca5a5',
    orange: '#f97316',
    darkOrange: '#c2410c',
    lightOrange: '#fdba74',
    yellow: '#eab308',
    gold: '#d97706',
    lightYellow: '#fef08a',
    green: '#22c55e',
    darkGreen: '#15803d',
    lightGreen: '#86efac',
    blue: '#3b82f6',
    darkBlue: '#1d4ed8',
    lightBlue: '#93c5fd',
    purple: '#a855f7',
    violet: '#8b5cf6',
    lavender: '#c4b5fd',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    turquoise: '#2dd4bf',
    pink: '#ec4899',
    magneta: '#d946ef',
    rose: '#f43f5e',
    brown: '#854d0e',
    tan: '#d2b48c',
    beige: '#f5f5dc',
    gray: '#6b7280',
    darkGray: '#374151',
    lightGray: '#d1d5db',
    slate: '#64748b',
    charcoal: '#334155',
    white: '#ffffff',
    ivory: '#fffff0',
    snow: '#fffafa',
    offWhite: '#f8fafc',
    black: '#000000',
    nearBlack: '#111827',
    jetBlack: '#0a0a0a',
};

export const BLOCKQUOTE_ACCENT_COLOR_KEYS = Object.keys(BLOCKQUOTE_ACCENT_COLORS);

export function detectSystemAccentColor(): string | null {
    if (typeof navigator === 'undefined') return null;
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';
    if (/Win/i.test(platform) || /Windows/i.test(ua)) return '#0078D4';
    if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return '#007AFF';
    const lower = (ua + ' ' + platform).toLowerCase();
    if (lower.includes('ubuntu')) return '#E95420';
    if (lower.includes('fedora')) return '#3C6EB4';
    if (lower.includes('red hat') || lower.includes('rhel')) return '#EE0000';
    if (lower.includes('debian')) return '#CE0058';
    if (lower.includes('arch')) return '#1793D1';
    if (lower.includes('mint')) return '#87CF3E';
    if (lower.includes('opensuse') || lower.includes('suse')) return '#73BA25';
    if (lower.includes('manjaro')) return '#35BF5C';
    if (lower.includes('kali')) return '#557C94';
    if (lower.includes('pop')) return '#48B9C7';
    if (lower.includes('zorin')) return '#15A6F0';
    if (lower.includes('nixos') || lower.includes('nix')) return '#5277C3';
    if (lower.includes('gentoo')) return '#54487A';
    if (lower.includes('elementary')) return '#64BAFF';
    return null;
}

export function resolveBlockquoteColor(nameOrColor: string | undefined | null, fallbackAccent?: string): string {
    if (nameOrColor === 'system') {
        const detected = detectSystemAccentColor();
        return detected || fallbackAccent || BLOCKQUOTE_ACCENT_COLORS.blue;
    }
    if (!nameOrColor) return BLOCKQUOTE_ACCENT_COLORS.blue;
    if (BLOCKQUOTE_ACCENT_COLORS[nameOrColor]) return BLOCKQUOTE_ACCENT_COLORS[nameOrColor];
    return nameOrColor;
}

// Applies a theme by setting every raw CSS custom property on <html>, plus `color-scheme` (native
// scrollbar/form-control rendering). Dark/Light use their exact hardcoded raw tokens; everything
// else is fanned out from its small `colors` palette via deriveRawTokens.
//
// Also keeps toggling the `.dark` class itself (the old, pre-theme-system mechanism) — a handful
// of components (BiographyView, Sidebar/TermDefinitionModal's markdown `prose`, SearchBar's
// history dropdown, HistoryTab) use Tailwind's own `dark:` variant directly rather than one of the
// Tailwind classes the raw-token override rules below cover, so they never picked up the CSS
// variables above. Those are out of scope for re-theming to a *specific* palette in this pass (see
// themes.ts's own module comment) — but they still need `.dark` present for every dark-scheme
// theme (not just literally "Dark") to keep looking the way they always have, rather than
// silently reverting to their light styling under Dracula/Nord/etc.
export function applyTheme(theme: Theme, blockquoteAccent?: string | null) {
    const root = document.documentElement;
    const raw = theme.name === 'dark' ? RAW_TOKENS_DARK : theme.name === 'light' ? RAW_TOKENS_LIGHT : deriveRawTokens(theme.colors);
    for (const key of RAW_TOKEN_KEYS) {
        root.style.setProperty(`--k-${key}`, raw[key] ?? '');
    }
    // Code colors: the built-in theme's own, or an imported theme's (what it gives, the rest from its palette).
    const syntax = syntaxOf(theme);
    for (const key of SYNTAX_KEYS) {
        root.style.setProperty(`--k-code-${key}`, syntax[key]);
    }
    if (blockquoteAccent) {
        root.style.setProperty('--k-blockquote-accent', resolveBlockquoteColor(blockquoteAccent, theme.colors.accent));
    } else {
        root.style.removeProperty('--k-blockquote-accent');
    }
    root.style.colorScheme = theme.scheme;
    root.classList.toggle('dark', theme.scheme === 'dark');
}

export function getThemeCssVariables(theme: Theme, blockquoteAccent?: string | null): Record<string, string> {
    const raw = theme.name === 'dark' ? RAW_TOKENS_DARK : theme.name === 'light' ? RAW_TOKENS_LIGHT : deriveRawTokens(theme.colors);
    const vars: Record<string, string> = {};
    for (const key of RAW_TOKEN_KEYS) {
        vars[`--k-${key}`] = raw[key] ?? '';
    }
    const syntax = syntaxOf(theme);
    for (const key of SYNTAX_KEYS) {
        vars[`--k-code-${key}`] = syntax[key];
    }
    if (blockquoteAccent) {
        vars['--k-blockquote-accent'] = resolveBlockquoteColor(blockquoteAccent);
    }
    return vars;
}

export function resolveContentTheme(
    displaySettings: { theme?: string; contentThemeInherit?: boolean; contentTheme?: string } | null | undefined,
    customThemes: Theme[]
): Theme {
    if (!displaySettings) return DEFAULT_THEME;
    const inherit = displaySettings.contentThemeInherit !== false;
    if (inherit) {
        return resolveTheme(displaySettings.theme, customThemes);
    }
    return resolveTheme(displaySettings.contentTheme || 'dark', customThemes);
}

const THEME_COLOR_KEYS: (keyof ThemeColors)[] = [
    'bg', 'surface', 'surfaceAlt', 'surfaceRaised', 'border', 'borderStrong',
    'text', 'textMuted', 'accent', 'accentHover', 'danger', 'success', 'warning',
];

// Validates an imported theme file's shape — every ThemeColors field present as a non-empty
// string, plus a name to show/store it under. Anything else (extra fields, wrong types) is
// ignored/rejected respectively; this doesn't validate that values are *valid* CSS colors, since
// the browser will simply ignore an invalid one when applyTheme sets it (safe failure mode).
export function parseThemeJson(raw: string, fallbackName: string): Theme | { error: string } {
    let data: any;
    try {
        data = JSON.parse(raw);
    } catch {
        return { error: 'That file is not valid JSON.' };
    }
    if (!data || typeof data !== 'object') {
        return { error: 'Expected a JSON object with theme colors.' };
    }
    const colorsSource = typeof data.colors === 'object' && data.colors !== null ? data.colors : data;
    const colors = {} as ThemeColors;
    for (const key of THEME_COLOR_KEYS) {
        const value = colorsSource[key];
        if (typeof value !== 'string' || !value.trim()) {
            return { error: `Missing or invalid "${key}" color.` };
        }
        colors[key] = value.trim();
    }
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName;
    const scheme: 'dark' | 'light' = data.scheme === 'light' ? 'light' : 'dark';
    // Optional code colors: whichever of them the file gives.
    const syntax: Partial<SyntaxColors> = {};
    if (data.syntax && typeof data.syntax === 'object') {
        for (const key of SYNTAX_KEYS) {
            const value = data.syntax[key];
            if (typeof value === 'string' && value.trim()) syntax[key] = value.trim();
        }
    }
    return { name: `custom:${name}`, label: name, scheme, colors, ...(Object.keys(syntax).length > 0 ? { syntax } : {}) };
}

export function isThemeError(result: Theme | { error: string }): result is { error: string } {
    return 'error' in result;
}

const CUSTOM_THEMES_SETTING_KEY = 'customThemes';

// Persists the user's imported themes as one JSON-array string in the generic settings table
// (see api.ts's getSetting/setSetting) — no dedicated backend/schema support needed.
export async function loadCustomThemes(): Promise<Theme[]> {
    try {
        const raw = await getSetting(CUSTOM_THEMES_SETTING_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        // The value can come from a sync server (an admin-enforced theme), so an entry with the
        // wrong shape is dropped here instead of crashing applyTheme's color derivation later.
        return Array.isArray(parsed) ? parsed.filter(isValidTheme) : [];
    } catch {
        return [];
    }
}

function isValidTheme(t: unknown): t is Theme {
    if (!t || typeof t !== 'object') return false;
    const theme = t as Record<string, unknown>;
    if (typeof theme.name !== 'string' || typeof theme.label !== 'string') return false;
    if (theme.scheme !== 'dark' && theme.scheme !== 'light') return false;
    const colors = theme.colors as Record<string, unknown> | null;
    if (!colors || typeof colors !== 'object') return false;
    return THEME_COLOR_KEYS.every(key => typeof colors[key] === 'string' && (colors[key] as string).trim() !== '');
}

export async function saveCustomThemes(themes: Theme[]): Promise<void> {
    await setSetting(CUSTOM_THEMES_SETTING_KEY, JSON.stringify(themes));
}

// Finds the active theme by name across built-ins and custom themes, falling back to Dark for a
// first launch (no `theme` setting yet) or a since-deleted custom theme.
export function resolveTheme(name: string | undefined | null, customThemes: Theme[]): Theme {
    return BUILTIN_THEMES.find(t => t.name === name) ?? customThemes.find(t => t.name === name) ?? DEFAULT_THEME;
}
