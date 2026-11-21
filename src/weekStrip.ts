import { formatDay } from "./dayChange";
import { getWeekStart } from "./journal";
import type { Journal, JournalEntry } from "./journal";


export type DayCell =
    | { day: string, kind: 'written', entry: JournalEntry }
    | { day: string, kind: 'missed' }
    | { day: string, kind: 'future' }
    | { day: string, kind: 'today-open' }

// `day` and `now` are local days (YYYY-MM-DD); `now` is today.
// A day after `now` is always 'future', even if the journal has an entry for it.
export function getWeekStrip(journal: Journal, day: string, now: string): DayCell[] {
    const monday = getWeekStart(day) // throws RangeError for an invalid day
    return weekDays(monday).map((d): DayCell => {
        // Zero-padded YYYY-MM-DD strings compare correctly as strings.
        if (d > now) return { day: d, kind: 'future' }
        const entry = journal[d]
        if (entry) return { day: d, kind: 'written', entry }
        return d === now ? { day: d, kind: 'today-open' } : { day: d, kind: 'missed' }
    })
}

/** Accessible name for a day button, e.g. "Tuesday, November 17, happy". */
export function describeCell(cell: DayCell, today: string): string {
    const date = formatDay(cell.day)
    const todayPart = cell.day === today ? 'today, ' : ''
    switch (cell.kind) {
        case 'written': return `${date}, ${todayPart}${cell.entry.mood}`
        case 'today-open': return `${date}, today, not written`
        case 'missed': return `${date}, missed`
        case 'future': return `${date}, future`
    }
}

const shortWeekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })

/** '2026-11-17' -> 'Tue' */
export function shortWeekday(day: string): string {
    const [y, m, d] = day.split('-').map(Number)
    return shortWeekdayFormatter.format(new Date(Date.UTC(y, m - 1, d)))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** The 7 consecutive days starting at `monday`. Uses UTC so DST never skips or repeats a day. */
function weekDays(monday: string): string[] {
    const [y, m, d] = monday.split('-').map(Number)
    return Array.from({ length: 7 }, (_, i) => {
        const date = new Date(Date.UTC(y, m - 1, d + i))
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    })
}

/**
 * take current day, show always 7 days a week, start from Monday, with type as above.
 * Mood if entry is there, kind written
 * pencil icon to let user add it only in past, missed
 * today open for today, if journal entry is not there
 * future grayed out and diabled
 * */
