export type Mood = 'happy' | 'sad';

export type JournalEntry = {
    text: string; // 300 chars limit (user-perceived characters)
    createdAt: string // local time, ISO 8601 with offset
    updatedAt: string // local time, ISO 8601 with offset
    day: string // YYYY-MM-DD
    mood: Mood
}

export type Journal = Record<string, JournalEntry> // keyed by day (YYYY-MM-DD)

export type JournalResult = { ok: true, journal: Journal } | { ok: false, error: string }

export const MAX_TEXT_LENGTH = 300
export const weekStart = 'Monday'

const MOODS: readonly Mood[] = ['happy', 'sad']
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const pad = (n: number, width = 2) => String(n).padStart(width, '0')

/** Local calendar day of `d` as YYYY-MM-DD (not the UTC day). */
export function toLocalDay(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local wall-clock time with UTC offset, e.g. 2026-11-21T12:05:00.000-08:00 */
function toLocalTimestamp(d: Date): string {
    const offset = -d.getTimezoneOffset()
    const sign = offset >= 0 ? '+' : '-'
    const abs = Math.abs(offset)
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
    return `${toLocalDay(d)}T${time}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** Parses YYYY-MM-DD into a UTC-midnight Date, or null if it isn't a real calendar day. */
function parseDay(day: string): Date | null {
    const match = DAY_PATTERN.exec(day)
    if (!match) return null
    const [, y, m, d] = match.map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    return valid ? date : null
}

/** Counts user-perceived characters (grapheme clusters), so 👨‍👩‍👧 counts as 1. */
export function countCharacters(text: string): number {
    let count = 0
    for (const _ of graphemes.segment(text)) count++
    return count
}

/** Cuts `text` to at most `max` user-perceived characters without splitting an emoji. */
export function truncateToCharacters(text: string, max: number): string {
    let out = ''
    let count = 0
    for (const { segment } of graphemes.segment(text)) {
        if (count === max) break
        out += segment
        count++
    }
    return out
}

function isMood(value: unknown): value is Mood {
    return MOODS.includes(value as Mood)
}

/**
 * Pure: never mutates `journal`; returns a new Journal on success.
 * `now` decides "today" (local day) and stamps createdAt/updatedAt.
 * Saving an existing day edits it in place: createdAt is kept, updatedAt is refreshed.
 */
export function saveJournal(journal: Journal, text: string, mood: Mood, day: string, now: Date): JournalResult {
    const trimmed = text.trim()
    if (trimmed === '') return { ok: false, error: 'Text cannot be empty' }
    if (countCharacters(trimmed) > MAX_TEXT_LENGTH) {
        return { ok: false, error: `Text cannot exceed ${MAX_TEXT_LENGTH} characters` }
    }
    if (!isMood(mood)) return { ok: false, error: 'Mood must be happy or sad' }
    if (!parseDay(day)) return { ok: false, error: 'Day must be a valid YYYY-MM-DD date' }
    // Zero-padded YYYY-MM-DD strings compare correctly as strings.
    if (day > toLocalDay(now)) return { ok: false, error: 'Cannot write an entry for a future day' }

    const timestamp = toLocalTimestamp(now)
    const existing = journal[day]
    const entry: JournalEntry = {
        text: trimmed,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        day,
        mood,
    }
    return { ok: true, journal: { ...journal, [day]: entry } }
}

/** Returns the Monday (YYYY-MM-DD) of the week containing `day`. */
export function getWeekStart(day: string): string {
    const date = parseDay(day)
    if (!date) throw new RangeError(`Invalid day: ${day}`)
    const daysSinceMonday = (date.getUTCDay() + 6) % 7 // Sun=0 -> 6, Mon=1 -> 0
    date.setUTCDate(date.getUTCDate() - daysSinceMonday)
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}
