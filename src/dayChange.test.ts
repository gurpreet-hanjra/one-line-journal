import { describe, expect, it, vi } from 'vitest'

import { dayChangeMessage, draftForDay, formatDay, hasUnsavedChanges, switchDayMessage, syncDraftToToday, watchTabReturn } from './dayChange'
import type { Draft } from './dayChange'
import { saveJournal } from './journal'
import type { Journal } from './journal'

// Local times in America/Los_Angeles (pinned in vite.config.ts).
const SUNDAY = '2026-11-22'
const MONDAY = '2026-11-23'
const SUNDAY_NIGHT = new Date(2026, 10, 22, 23, 30) // already Monday in UTC
const MONDAY_MORNING = new Date(2026, 10, 23, 8, 0)

function journalWith(text: string, day: string, now: Date, mood: 'happy' | 'sad' = 'happy'): Journal {
  const res = saveJournal({}, text, mood, day, now)
  if (!res.ok) throw new Error(res.error)
  return res.journal
}

describe('formatDay', () => {
  it('shows the weekday and date', () => {
    expect(formatDay(SUNDAY)).toBe('Sunday, November 22')
    expect(formatDay(MONDAY)).toBe('Monday, November 23')
  })

  it('is not shifted by the local timezone', () => {
    expect(formatDay('2026-01-01')).toBe('Thursday, January 1')
  })
})

describe('draftForDay', () => {
  it('is empty when the day has no entry', () => {
    expect(draftForDay({}, MONDAY)).toEqual({ day: MONDAY, text: '', mood: '' })
  })

  it('prefills the saved entry for that day', () => {
    const journal = journalWith('lazy day', SUNDAY, SUNDAY_NIGHT, 'sad')
    expect(draftForDay(journal, SUNDAY)).toEqual({ day: SUNDAY, text: 'lazy day', mood: 'sad' })
  })
})

describe('syncDraftToToday', () => {
  const unsavedSunday: Draft = { day: SUNDAY, text: 'typed but not saved', mood: 'happy' }

  it('changes nothing while it is still the same local day', () => {
    expect(syncDraftToToday(unsavedSunday, {}, SUNDAY_NIGHT)).toEqual({ changed: false })
  })

  it('uses the local day, not UTC: Sunday 23:30 PST is still Sunday', () => {
    expect(SUNDAY_NIGHT.toISOString().slice(0, 10)).toBe(MONDAY)
    expect(syncDraftToToday(unsavedSunday, {}, SUNDAY_NIGHT).changed).toBe(false)
  })

  it('moves to the new day and clears the unsaved draft when the day has changed', () => {
    const result = syncDraftToToday(unsavedSunday, {}, MONDAY_MORNING)
    expect(result).toEqual({
      changed: true,
      draft: { day: MONDAY, text: '', mood: '' },
      notice: { from: SUNDAY, to: MONDAY, discardedDraft: true },
    })
  })

  it('does not report a discarded draft when the draft was empty', () => {
    const empty: Draft = { day: SUNDAY, text: '   ', mood: '' }
    const result = syncDraftToToday(empty, {}, MONDAY_MORNING)
    expect(result.changed && result.notice.discardedDraft).toBe(false)
  })

  it('does not report a discarded draft when the draft matches what was saved', () => {
    const journal = journalWith('saved already', SUNDAY, SUNDAY_NIGHT, 'sad')
    const saved: Draft = { day: SUNDAY, text: 'saved already', mood: 'sad' }
    const result = syncDraftToToday(saved, journal, MONDAY_MORNING)
    expect(result.changed && result.notice.discardedDraft).toBe(false)
  })

  it('reports a discarded draft when only the mood was changed and not saved', () => {
    const journal = journalWith('saved already', SUNDAY, SUNDAY_NIGHT, 'sad')
    const moodChanged: Draft = { day: SUNDAY, text: 'saved already', mood: 'happy' }
    const result = syncDraftToToday(moodChanged, journal, MONDAY_MORNING)
    expect(result.changed && result.notice.discardedDraft).toBe(true)
  })

  it('prefills the new day if it already has an entry (e.g. saved in another tab)', () => {
    const journal = journalWith('written elsewhere', MONDAY, MONDAY_MORNING)
    const result = syncDraftToToday(unsavedSunday, journal, MONDAY_MORNING)
    expect(result.changed && result.draft).toEqual({ day: MONDAY, text: 'written elsewhere', mood: 'happy' })
  })

  it('handles skipping several days', () => {
    const wednesday = new Date(2026, 10, 25, 9, 0)
    const result = syncDraftToToday(unsavedSunday, {}, wednesday)
    expect(result.changed && result.notice).toEqual({ from: SUNDAY, to: '2026-11-25', discardedDraft: true })
  })
})

describe('dayChangeMessage', () => {
  it('names the new day and says the unsaved entry was cleared', () => {
    expect(dayChangeMessage({ from: SUNDAY, to: MONDAY, discardedDraft: true })).toBe(
      "It's now Monday, November 23. Your unsaved entry for Sunday, November 22 was cleared.",
    )
  })

  it('only names the new day when nothing was lost', () => {
    expect(dayChangeMessage({ from: SUNDAY, to: MONDAY, discardedDraft: false })).toBe(
      "It's now Monday, November 23.",
    )
  })
})

describe('watchTabReturn', () => {
  function fakeEnv() {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    const win = new EventTarget()
    const setVisibility = (state: DocumentVisibilityState) => {
      doc.visibilityState = state
      doc.dispatchEvent(new Event('visibilitychange'))
    }
    return { doc, win, setVisibility }
  }

  it('calls back when the tab becomes visible again', () => {
    const { doc, win, setVisibility } = fakeEnv()
    const onReturn = vi.fn()
    watchTabReturn(onReturn, doc, win)
    setVisibility('hidden')
    expect(onReturn).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('calls back when the window regains focus', () => {
    const { doc, win } = fakeEnv()
    const onReturn = vi.fn()
    watchTabReturn(onReturn, doc, win)
    win.dispatchEvent(new Event('focus'))
    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('stops calling back after unsubscribing', () => {
    const { doc, win, setVisibility } = fakeEnv()
    const onReturn = vi.fn()
    const stop = watchTabReturn(onReturn, doc, win)
    stop()
    setVisibility('hidden')
    setVisibility('visible')
    win.dispatchEvent(new Event('focus'))
    expect(onReturn).not.toHaveBeenCalled()
  })
})

describe('hasUnsavedChanges', () => {
  const journal = journalWith('saved text', SUNDAY, SUNDAY_NIGHT, 'sad')

  it('is false for a blank or whitespace-only draft', () => {
    expect(hasUnsavedChanges({ day: MONDAY, text: '', mood: '' }, {})).toBe(false)
    expect(hasUnsavedChanges({ day: MONDAY, text: '  ', mood: 'happy' }, {})).toBe(false)
  })

  it('is true for new text on a day with no entry', () => {
    expect(hasUnsavedChanges({ day: MONDAY, text: 'new', mood: '' }, {})).toBe(true)
  })

  it('is false when the draft matches the saved entry', () => {
    expect(hasUnsavedChanges({ day: SUNDAY, text: 'saved text', mood: 'sad' }, journal)).toBe(false)
  })

  it('is true when the text or only the mood differs from the saved entry', () => {
    expect(hasUnsavedChanges({ day: SUNDAY, text: 'saved text!', mood: 'sad' }, journal)).toBe(true)
    expect(hasUnsavedChanges({ day: SUNDAY, text: 'saved text', mood: 'happy' }, journal)).toBe(true)
  })
})

describe('switchDayMessage', () => {
  it('names the day whose unsaved entry was cleared', () => {
    expect(switchDayMessage(SUNDAY)).toBe('Your unsaved entry for Sunday, November 22 was cleared.')
  })
})
