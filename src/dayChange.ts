import { toLocalDay } from './journal'
import type { Journal, Mood } from './journal'

export type Draft = { day: string, text: string, mood: Mood | '' }
export type DayChangeNotice = { from: string, to: string, discardedDraft: boolean }
export type DaySync = { changed: false } | { changed: true, draft: Draft, notice: DayChangeNotice }

// The day string is a calendar date, so format it in UTC to avoid local-offset shifts.
const dayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

/** '2026-11-23' -> 'Monday, November 23' */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayFormatter.format(new Date(Date.UTC(y, m - 1, d)))
}

/** The form state for `day`: the saved entry if there is one, otherwise blank. */
export function draftForDay(journal: Journal, day: string): Draft {
  const entry = journal[day]
  return entry ? { day, text: entry.text, mood: entry.mood } : { day, text: '', mood: '' }
}

function hasUnsavedChanges(draft: Draft, journal: Journal): boolean {
  if (draft.text.trim() === '') return false
  const saved = journal[draft.day]
  return !saved || saved.text !== draft.text || saved.mood !== draft.mood
}

/**
 * Pure: if the local day of `now` differs from the draft's day, returns a fresh
 * draft for the new day plus a notice describing the change.
 */
export function syncDraftToToday(draft: Draft, journal: Journal, now: Date): DaySync {
  const today = toLocalDay(now)
  if (today === draft.day) return { changed: false }
  return {
    changed: true,
    draft: draftForDay(journal, today),
    notice: { from: draft.day, to: today, discardedDraft: hasUnsavedChanges(draft, journal) },
  }
}

export function dayChangeMessage(notice: DayChangeNotice): string {
  const now = `It's now ${formatDay(notice.to)}.`
  return notice.discardedDraft
    ? `${now} Your unsaved entry for ${formatDay(notice.from)} was cleared.`
    : now
}

/**
 * Calls `onReturn` whenever the user comes back to the tab (it becomes visible
 * or the window regains focus). Returns an unsubscribe function.
 */
export function watchTabReturn(
  onReturn: () => void,
  doc: Pick<Document, 'visibilityState'> & EventTarget = document,
  win: EventTarget = window,
): () => void {
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') onReturn()
  }
  doc.addEventListener('visibilitychange', onVisibility)
  win.addEventListener('focus', onReturn)
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility)
    win.removeEventListener('focus', onReturn)
  }
}
