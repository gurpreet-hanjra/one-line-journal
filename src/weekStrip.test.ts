import { describe, expect, it } from 'vitest'

import { saveJournal } from './journal'
import type { Journal, Mood } from './journal'
import { describeCell, getWeekStrip, shortWeekday } from './weekStrip'

// 2026-11-21 is a Saturday; its week runs Mon 2026-11-16 .. Sun 2026-11-22.
const MON = '2026-11-16'
const TUE = '2026-11-17'
const WED = '2026-11-18'
const THU = '2026-11-19'
const FRI = '2026-11-20'
const SAT = '2026-11-21'
const SUN = '2026-11-22'
const WEEK = [MON, TUE, WED, THU, FRI, SAT, SUN]

// `now` is today's local day (YYYY-MM-DD), the same format as `day`.
const TODAY = SAT

function withEntries(...entries: [day: string, text: string, mood: Mood][]): Journal {
  let journal: Journal = {}
  for (const [day, text, mood] of entries) {
    const res = saveJournal(journal, text, mood, day, new Date(2026, 10, 21, 12, 0))
    if (!res.ok) throw new Error(res.error)
    journal = res.journal
  }
  return journal
}

const days = (journal: Journal, day: string, now: string) => getWeekStrip(journal, day, now).map((c) => c.day)
const kinds = (journal: Journal, day: string, now: string) => getWeekStrip(journal, day, now).map((c) => c.kind)

describe('getWeekStrip: always 7 days, Monday first', () => {
  it('returns Monday..Sunday for a mid-week day', () => {
    expect(days({}, WED, TODAY)).toEqual(WEEK)
  })

  it('returns the same week whether given its Monday, Saturday, or Sunday', () => {
    expect(days({}, MON, TODAY)).toEqual(WEEK)
    expect(days({}, SAT, TODAY)).toEqual(WEEK)
    expect(days({}, SUN, TODAY)).toEqual(WEEK)
  })

  it('crosses a month boundary', () => {
    // 2026-11-01 is a Sunday
    expect(days({}, '2026-11-01', TODAY)).toEqual([
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ])
  })

  it('crosses a year boundary', () => {
    // 2026-01-01 is a Thursday
    expect(days({}, '2026-01-01', TODAY)).toEqual([
      '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04',
    ])
  })

  it('has 7 distinct consecutive days across DST changes (US: 2026-03-08 and 2026-11-01)', () => {
    expect(days({}, '2026-03-08', TODAY)).toEqual([
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08',
    ])
    expect(new Set(days({}, '2026-11-01', TODAY)).size).toBe(7)
  })

  it('handles a leap day', () => {
    // 2028-02-29 is a Tuesday
    expect(days({}, '2028-02-29', '2028-03-10')).toEqual([
      '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02', '2028-03-03', '2028-03-04', '2028-03-05',
    ])
  })

  it('rejects an invalid day', () => {
    expect(() => getWeekStrip({}, '2026-02-30', TODAY)).toThrow(RangeError)
    expect(() => getWeekStrip({}, 'not-a-day', TODAY)).toThrow(RangeError)
  })
})

describe('getWeekStrip: kinds relative to today', () => {
  it('with no entries: past days missed, today open, later days future', () => {
    expect(kinds({}, SAT, TODAY)).toEqual(['missed', 'missed', 'missed', 'missed', 'missed', 'today-open', 'future'])
  })

  it('marks past days with an entry as written, carrying the entry (and so its mood)', () => {
    const journal = withEntries([TUE, 'good tuesday', 'happy'], [THU, 'rough thursday', 'sad'])
    const strip = getWeekStrip(journal, SAT, TODAY)

    expect(strip[1]).toEqual({ day: TUE, kind: 'written', entry: journal[TUE] })
    expect(strip[3]).toEqual({ day: THU, kind: 'written', entry: journal[THU] })
    expect(kinds(journal, SAT, TODAY)).toEqual(['missed', 'written', 'missed', 'written', 'missed', 'today-open', 'future'])
  })

  it('exposes the mood of a written day', () => {
    const journal = withEntries([THU, 'rough thursday', 'sad'])
    const cell = getWeekStrip(journal, SAT, TODAY)[3]
    expect(cell.kind).toBe('written')
    if (cell.kind !== 'written') return
    expect(cell.entry).toMatchObject({ mood: 'sad', text: 'rough thursday', day: THU })
  })

  it('marks today as written (not today-open) once it has an entry', () => {
    const journal = withEntries([SAT, 'today done', 'happy'])
    const today = getWeekStrip(journal, SAT, TODAY)[5]
    expect(today).toEqual({ day: SAT, kind: 'written', entry: journal[SAT] })
  })

  it('marks today-open on Monday when today is Monday', () => {
    expect(kinds({}, MON, MON)).toEqual(['today-open', 'future', 'future', 'future', 'future', 'future', 'future'])
  })

  it('has no future days when today is Sunday', () => {
    expect(kinds({}, SUN, SUN)).toEqual(['missed', 'missed', 'missed', 'missed', 'missed', 'missed', 'today-open'])
  })

  it('a past week has only missed or written days', () => {
    const journal = withEntries(['2026-11-10', 'last week', 'happy'])
    expect(kinds(journal, '2026-11-12', TODAY)).toEqual(['missed', 'written', 'missed', 'missed', 'missed', 'missed', 'missed'])
  })

  it('a future week is all future', () => {
    expect(kinds({}, '2026-11-25', TODAY)).toEqual(Array(7).fill('future'))
  })

  it('a future day is always future, even if the journal somehow has an entry for it', () => {
    const journal: Journal = {
      [SUN]: { text: 'from the future', mood: 'happy', day: SUN, createdAt: 'x', updatedAt: 'x' },
    }
    expect(getWeekStrip(journal, SAT, TODAY)[6]).toEqual({ day: SUN, kind: 'future' })
  })

  it('only missed/future/today-open cells have no entry', () => {
    for (const cell of getWeekStrip({}, SAT, TODAY)) {
      expect(cell).not.toHaveProperty('entry')
    }
  })

  it('ignores entries outside the requested week', () => {
    const journal = withEntries(['2026-11-15', 'previous Sunday', 'happy'], [WED, 'this week', 'sad'])
    const strip = getWeekStrip(journal, SAT, TODAY)
    expect(strip.filter((c) => c.kind === 'written').map((c) => c.day)).toEqual([WED])
  })
})

describe('getWeekStrip is pure', () => {
  it('does not mutate the journal', () => {
    const journal = Object.freeze(withEntries([TUE, 'frozen', 'happy']))
    Object.values(journal).forEach((e) => Object.freeze(e))
    const snapshot = structuredClone(journal)
    getWeekStrip(journal, SAT, TODAY)
    expect(journal).toEqual(snapshot)
  })

  it('gives equal results for equal inputs', () => {
    const journal = withEntries([TUE, 'same', 'happy'])
    expect(getWeekStrip(journal, SAT, TODAY)).toEqual(getWeekStrip(journal, SAT, TODAY))
  })
})

describe('describeCell (accessible name for a day button)', () => {
  const journal = withEntries([TUE, 'good', 'happy'], [SAT, 'done', 'sad'])
  const strip = getWeekStrip(journal, SAT, TODAY)
  const blankStrip = getWeekStrip({}, SAT, TODAY)

  it('written past day: date and mood', () => {
    expect(describeCell(strip[1], TODAY)).toBe('Tuesday, November 17, happy')
  })

  it('missed past day', () => {
    expect(describeCell(strip[0], TODAY)).toBe('Monday, November 16, missed')
  })

  it('today, written and not written', () => {
    expect(describeCell(strip[5], TODAY)).toBe('Saturday, November 21, today, sad')
    expect(describeCell(blankStrip[5], TODAY)).toBe('Saturday, November 21, today, not written')
  })

  it('future day', () => {
    expect(describeCell(strip[6], TODAY)).toBe('Sunday, November 22, future')
  })
})

describe('shortWeekday', () => {
  it('gives the 3-letter weekday, unaffected by timezone', () => {
    expect(WEEK.map(shortWeekday)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  })
})
