import {
    Bed, Bike, BookOpen, Brain, Briefcase, Calculator, CalendarOff, Camera, Car, ClipboardCheck, Code, Coffee, Dumbbell, FileText,
    FlaskConical, Flag, Footprints, Gamepad2, Gift, GraduationCap, Headphones, HeartPulse, House, Languages, ListTodo, Mic, Music,
    NotebookPen, Palette, PartyPopper, Pencil, Plane, Presentation, Snowflake, Star, Sun, Tent,
    TreePalm, Users, Utensils,
    type LucideIcon,
} from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { DiamondHigh, DiamondLow, DiamondMedium } from '../components/ui/MarkIcons';

/**
 * The icons a Calendar task can have (the task's icon in the database is one of these names: src-tauri/src/db/calendar.rs
 * only checks it looks like a name). Grouped for the picker. A name that isn't here (or "") shows the default task icon.
 */
export const CALENDAR_ICON_GROUPS: { label: string; icons: { name: string; Icon: LucideIcon; label: string }[] }[] = [
    {
        label: 'Study',
        icons: [
            { name: 'book-open', Icon: BookOpen, label: 'Reading' },
            { name: 'notebook-pen', Icon: NotebookPen, label: 'Notes' },
            { name: 'pencil', Icon: Pencil, label: 'Writing' },
            { name: 'clipboard-check', Icon: ClipboardCheck, label: 'Quiz or exam' },
            { name: 'graduation-cap', Icon: GraduationCap, label: 'Class' },
            { name: 'flask-conical', Icon: FlaskConical, label: 'Lab' },
            { name: 'calculator', Icon: Calculator, label: 'Problem set' },
            { name: 'languages', Icon: Languages, label: 'Language' },
            { name: 'brain', Icon: Brain, label: 'Review' },
            { name: 'file-text', Icon: FileText, label: 'Paper' },
        ],
    },
    {
        label: 'Exercise',
        icons: [
            { name: 'dumbbell', Icon: Dumbbell, label: 'Workout' },
            { name: 'bike', Icon: Bike, label: 'Ride' },
            { name: 'footprints', Icon: Footprints, label: 'Walk or run' },
            { name: 'heart-pulse', Icon: HeartPulse, label: 'Cardio' },
        ],
    },
    {
        label: 'Breaks',
        icons: [
            { name: 'calendar-off', Icon: CalendarOff, label: 'Day off' },
            { name: 'tree-palm', Icon: TreePalm, label: 'Vacation' },
            { name: 'plane', Icon: Plane, label: 'Travel' },
            { name: 'tent', Icon: Tent, label: 'Trip' },
            { name: 'sun', Icon: Sun, label: 'Summer' },
            { name: 'snowflake', Icon: Snowflake, label: 'Winter break' },
            { name: 'party-popper', Icon: PartyPopper, label: 'Holiday' },
            { name: 'gift', Icon: Gift, label: 'Celebration' },
            { name: 'coffee', Icon: Coffee, label: 'Rest' },
            { name: 'bed', Icon: Bed, label: 'Sleep in' },
        ],
    },
    {
        label: 'Work and life',
        icons: [
            { name: 'briefcase', Icon: Briefcase, label: 'Work' },
            { name: 'presentation', Icon: Presentation, label: 'Presentation' },
            { name: 'code', Icon: Code, label: 'Coding' },
            { name: 'users', Icon: Users, label: 'Meeting' },
            { name: 'house', Icon: House, label: 'Home' },
            { name: 'utensils', Icon: Utensils, label: 'Meal' },
            { name: 'car', Icon: Car, label: 'Errand' },
        ],
    },
    {
        label: 'Hobbies',
        icons: [
            { name: 'music', Icon: Music, label: 'Music' },
            { name: 'headphones', Icon: Headphones, label: 'Listening' },
            { name: 'mic', Icon: Mic, label: 'Recording' },
            { name: 'camera', Icon: Camera, label: 'Photography' },
            { name: 'palette', Icon: Palette, label: 'Art' },
            { name: 'gamepad-2', Icon: Gamepad2, label: 'Games' },
            { name: 'star', Icon: Star, label: 'Important' },
            { name: 'flag', Icon: Flag, label: 'Milestone' },
        ],
    },
];

/** A task's priority levels (0 is none), with the diamond and color each is shown with, and its name. The diamond's fill
 *  carries the level as well as its color (components/ui/MarkIcons.tsx); Low is gray, not green, since green means done. */
export const PRIORITIES: { level: number; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>>; color: string }[] = [
    { level: 1, label: 'Low', Icon: DiamondLow, color: 'text-gray-400' },
    { level: 2, label: 'Medium', Icon: DiamondMedium, color: 'text-amber-400' },
    { level: 3, label: 'High', Icon: DiamondHigh, color: 'text-red-400' },
];

/** A priority's level by its number, or undefined for none. */
export function priorityOf(level: number | null | undefined) {
    return PRIORITIES.find(p => p.level === level);
}

const BY_NAME = new Map(CALENDAR_ICON_GROUPS.flatMap(g => g.icons).map(i => [i.name, i.Icon]));

/** A task's icon by its name, or the default task icon for none (or one this set no longer has). */
export function calendarIcon(name: string | null | undefined): LucideIcon {
    return (name && BY_NAME.get(name)) || ListTodo;
}
