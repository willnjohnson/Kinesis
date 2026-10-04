import { Clock, Flag, History, KeyRound, Star, type LucideIcon } from 'lucide-react';
import { BUILT_IN_TAGS, foldName } from './glossary';

/** Each built-in tag's icon (lib/glossary.ts's BUILT_IN_TAGS), shown in place of a bullet wherever they're listed: the
 *  Glossary's "Essentials" section and the video sidebar's tag dropdown. */
const ICONS: Record<string, LucideIcon> = {
    [foldName('Watch Later')]: Clock,
    [foldName('Favorite')]: Star,
    [foldName('Revisit')]: History,
    [foldName('Key Source')]: KeyRound,
    [foldName('Follow Up')]: Flag,
};

/** What each built-in tag is for, shown as its tooltip in the Glossary. */
const DESCRIPTIONS: Record<string, string> = {
    [foldName('Watch Later')]: "Videos you haven't watched yet and want to get to.",
    [foldName('Favorite')]: 'Videos you liked most and want to find again easily.',
    [foldName('Revisit')]: "Videos you've watched but want to go through again.",
    [foldName('Key Source')]: 'Videos you rely on as a main source: worth citing, or checking other claims against.',
    [foldName('Follow Up')]: 'Videos that left you something to do: a claim to check, a lead to chase, a question to look into.',
};

/** What the built-in tag called `name` (any case) is for, or undefined for any other name. */
export function builtInTagDescription(name: string): string | undefined {
    return DESCRIPTIONS[foldName(name.trim())];
}

/** The icon of the built-in tag called `name` (any case), or undefined for any other name. */
export function builtInTagIcon(name: string): LucideIcon | undefined {
    return ICONS[foldName(name.trim())];
}

/** Where a built-in tag sits in BUILT_IN_TAGS' order, or -1 for any other name: to list them in that order, not A-Z. */
export function builtInTagRank(name: string): number {
    return BUILT_IN_TAGS.findIndex(t => foldName(t) === foldName(name.trim()));
}
