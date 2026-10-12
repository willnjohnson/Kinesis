import { describe, expect, it } from 'vitest';
import type { CalendarRepeat } from '../../api';
import { firstDays, repeatLabel } from '../../components/calendar/shared';

// The Edit Track window's preview of a pattern. The rule that decides is the backend's (Repeat::lands_on in
// src-tauri/src/db/calendar.rs); these are the same days its tests expect, so the two can't drift apart unnoticed.
const cases: [CalendarRepeat, string, number[], string[], string][] = [
    [{ kind: 'weekly', every: 2, ordinal: 1 }, '2026-09-09', [1, 3, 5], ['2026-09-09', '2026-09-11', '2026-09-21', '2026-09-23'], 'Mon/Wed/Fri, every other week'],
    [{ kind: 'interval', every: 2, ordinal: 1 }, '2026-09-08', [], ['2026-09-08', '2026-09-10', '2026-09-12', '2026-09-14'], 'Every other day'],
    [{ kind: 'monthly', every: 1, ordinal: 1 }, '2026-09-08', [1], ['2026-10-05', '2026-11-02', '2026-12-07', '2027-01-04'], 'First Mon of the month'],
    [{ kind: 'monthly', every: 1, ordinal: 5 }, '2026-09-01', [1], ['2026-09-28', '2026-10-26', '2026-11-30', '2026-12-28'], 'Last Mon of the month'],
    [{ kind: 'weekly', every: 1, ordinal: 1 }, '2026-09-01', [2, 4], ['2026-09-01', '2026-09-03', '2026-09-08', '2026-09-10'], 'Tue/Thu'],
    // Across the autumn clock change, a week is still seven days.
    [{ kind: 'interval', every: 14, ordinal: 1 }, '2026-10-19', [], ['2026-10-19', '2026-11-02', '2026-11-16', '2026-11-30'], 'Every 14 days'],
    [{ kind: 'weekly', every: 3, ordinal: 1 }, '2026-10-19', [1], ['2026-10-19', '2026-11-09', '2026-11-30', '2026-12-21'], 'Mon, every 3 weeks'],
];

describe("a track's repeat pattern", () => {
    it.each(cases)('%o from %s', (repeat, start, weekdays, days, label) => {
        expect(firstDays(repeat, start, weekdays, 4)).toEqual(days);
        expect(repeatLabel(repeat, weekdays)).toBe(label);
    });
});
