import { describe, expect, it } from 'vitest'

import { getWeekStart, saveJournal, toLocalDay, weekStart } from './journal'
import type { Journal, Mood } from './journal'

// Local times in America/Los_Angeles (pinned in vite.config.ts).
// 2026-11-21 is a Saturday.
const NOON_SAT = new Date(2026, 10, 21, 12, 0)
const TODAY = '2026-11-21'
const YESTERDAY = '2026-11-20'
const TOMORROW = '2026-11-22'

const EMPTY: Journal = {}

/** Saves and returns the new journal; fails the test if the save is rejected. */
function saveOk(journal: Journal, text: string, day: string, now: Date = NOON_SAT, mood: Mood = 'happy'): Journal {
  const res = saveJournal(journal, text, mood, day, now)
  if (!res.ok) throw new Error(`expected ok, got error: ${res.error}`)
  return res.journal
}

/** Recursively freezes so any mutation of the input throws in strict mode. */
function deepFreeze<T>(obj: T): T {
  for (const value of Object.values(obj as object)) {
    if (value && typeof value === 'object') deepFreeze(value)
  }
  return Object.freeze(obj)
}

describe('test environment', () => {
  it('runs in a non-UTC timezone (PST, UTC-8)', () => {
    expect(new Date(2026, 10, 21).getTimezoneOffset()).toBe(480)
  })
})

describe('saveJournal is pure', () => {
  it('returns a new journal object, not the one passed in', () => {
    const input: Journal = {}
    const res = saveJournal(input, 'hello', 'happy', TODAY, NOON_SAT)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.journal).not.toBe(input)
  })

  it('does not mutate the input journal or its entries', () => {
    const before = deepFreeze(saveOk(EMPTY, 'original', TODAY))
    const snapshot = structuredClone(before)
    const after = saveOk(before, 'edited', TODAY, new Date(2026, 10, 21, 15, 0))
    expect(before).toEqual(snapshot)
    expect(after[TODAY]).not.toBe(before[TODAY])
  })

  it('does not mutate the input when adding a new day', () => {
    const before = deepFreeze(saveOk(EMPTY, 'yesterday', YESTERDAY))
    const snapshot = structuredClone(before)
    saveOk(before, 'today', TODAY)
    expect(before).toEqual(snapshot)
  })

  it('does not mutate the input when the save is rejected', () => {
    const before = deepFreeze(saveOk(EMPTY, 'keep me', TODAY))
    const snapshot = structuredClone(before)
    expect(saveJournal(before, '   ', 'happy', TODAY, NOON_SAT).ok).toBe(false)
    expect(before).toEqual(snapshot)
  })

  it('is deterministic: same inputs give equal outputs', () => {
    const a = saveJournal(EMPTY, 'same', 'sad', TODAY, NOON_SAT)
    const b = saveJournal(EMPTY, 'same', 'sad', TODAY, NOON_SAT)
    expect(a).toEqual(b)
  })

  it('does not depend on the real clock: a past `now` still decides what "future" means', () => {
    // Relative to now = 2020-01-01, 2020-01-02 is in the future even though the real date is later.
    const jan1 = new Date(2020, 0, 1, 12, 0)
    expect(saveJournal(EMPTY, 'x', 'happy', '2020-01-02', jan1).ok).toBe(false)
    expect(saveJournal(EMPTY, 'x', 'happy', '2020-01-01', jan1).ok).toBe(true)
  })
})

describe('1. toLocalDay uses the local day, not UTC', () => {
  it('returns the local date late in the evening when UTC is already the next day', () => {
    // 23:30 PST on Nov 21 is 07:30 UTC on Nov 22
    const d = new Date(2026, 10, 21, 23, 30)
    expect(d.toISOString().slice(0, 10)).toBe('2026-11-22')
    expect(toLocalDay(d)).toBe('2026-11-21')
  })

  it('zero-pads month and day as YYYY-MM-DD', () => {
    expect(toLocalDay(new Date(2026, 0, 5, 9, 0))).toBe('2026-01-05')
  })
})

describe('2. saveJournal adds an entry keyed by day', () => {
  it('stores the entry under its day with text, day, and mood', () => {
    const journal = saveOk(EMPTY, 'Walked by the river', TODAY)
    expect(Object.keys(journal)).toEqual([TODAY])
    expect(journal[TODAY]).toMatchObject({
      text: 'Walked by the river',
      day: TODAY,
      mood: 'happy',
    })
  })

  it('sets createdAt and updatedAt to the same value on creation', () => {
    const entry = saveOk(EMPTY, 'First entry', TODAY)[TODAY]
    expect(entry.createdAt).toEqual(expect.any(String))
    expect(entry.updatedAt).toBe(entry.createdAt)
  })

  it('keeps entries for different days side by side', () => {
    const j1 = saveOk(EMPTY, 'one', YESTERDAY, NOON_SAT, 'sad')
    const j2 = saveOk(j1, 'two', TODAY)
    expect(Object.keys(j2).sort()).toEqual([YESTERDAY, TODAY])
    expect(j2[YESTERDAY].text).toBe('one')
    expect(j2[TODAY].text).toBe('two')
  })

  it('allows line breaks inside the text', () => {
    expect(saveOk(EMPTY, 'first line\nsecond line', TODAY)[TODAY].text).toBe('first line\nsecond line')
  })
})

describe('mood is required', () => {
  // Callers outside TypeScript (e.g. form data) can still pass bad values.
  const saveUntyped = saveJournal as (journal: Journal, text: string, mood: unknown, day: string, now: Date) => ReturnType<typeof saveJournal>

  it('stores either mood', () => {
    expect(saveOk(EMPTY, 'good day', TODAY, NOON_SAT, 'happy')[TODAY].mood).toBe('happy')
    expect(saveOk(EMPTY, 'rough day', TODAY, NOON_SAT, 'sad')[TODAY].mood).toBe('sad')
  })

  it('rejects a missing or unknown mood', () => {
    expect(saveUntyped(EMPTY, 'no mood', undefined, TODAY, NOON_SAT).ok).toBe(false)
    expect(saveUntyped(EMPTY, 'bad mood', 'angry', TODAY, NOON_SAT).ok).toBe(false)
  })
})

describe('3. saving the same day again edits that entry (no duplicates)', () => {
  it('keeps exactly one entry for the day after re-saving', () => {
    const j1 = saveOk(EMPTY, 'draft', TODAY)
    const j2 = saveOk(j1, 'final', TODAY)
    expect(Object.keys(j2)).toEqual([TODAY])
    expect(j2[TODAY].text).toBe('final')
  })

  it('can be edited any number of times; updatedAt moves each time, createdAt never changes', () => {
    let journal = saveOk(EMPTY, 'draft', TODAY)
    const original = journal[TODAY]
    let previousUpdatedAt = original.updatedAt

    for (let n = 1; n <= 10; n++) {
      const now = new Date(2026, 10, 21, 12, n * 5) // later the same day
      journal = saveOk(journal, `edit #${n}`, TODAY, now)
      expect(Object.keys(journal)).toHaveLength(1)
      const entry = journal[TODAY]
      expect(entry.text).toBe(`edit #${n}`)
      expect(entry.createdAt).toBe(original.createdAt)
      expect(entry.updatedAt).not.toBe(previousUpdatedAt)
      previousUpdatedAt = entry.updatedAt
    }
  })

  it('on update, only updatedAt changes; createdAt stays exactly as it was', () => {
    const j1 = saveOk(EMPTY, 'same words', TODAY)
    const j2 = saveOk(j1, 'same words', TODAY, new Date(2026, 10, 21, 15, 0))
    const original = j1[TODAY]
    const updated = j2[TODAY]
    expect(updated.createdAt).toBe(original.createdAt)
    expect(updated.updatedAt).not.toBe(original.updatedAt)
    const { updatedAt: _a, ...restOriginal } = original
    const { updatedAt: _b, ...restUpdated } = updated
    expect(restUpdated).toEqual(restOriginal)
  })

  it('stamps createdAt and updatedAt from `now`, so later `now` gives a different stamp', () => {
    const early = saveOk(EMPTY, 'x', TODAY, new Date(2026, 10, 21, 8, 0))[TODAY]
    const late = saveOk(EMPTY, 'x', TODAY, new Date(2026, 10, 21, 20, 0))[TODAY]
    expect(late.createdAt).not.toBe(early.createdAt)
  })

  it('updates the mood on edit', () => {
    const j1 = saveOk(EMPTY, 'meh', TODAY, NOON_SAT, 'sad')
    expect(saveOk(j1, 'better now', TODAY, NOON_SAT, 'happy')[TODAY].mood).toBe('happy')
  })

  it('leaves other days untouched when editing one day', () => {
    const j1 = saveOk(EMPTY, 'yesterday', YESTERDAY, NOON_SAT, 'sad')
    const j2 = saveOk(j1, 'today v1', TODAY)
    const j3 = saveOk(j2, 'today v2', TODAY, new Date(2026, 10, 21, 18, 0))
    expect(j3[YESTERDAY]).toEqual(j1[YESTERDAY])
  })
})

describe('4. entries cannot be written for a future day', () => {
  it('rejects tomorrow', () => {
    expect(saveJournal(EMPTY, 'from the future', 'happy', TOMORROW, NOON_SAT).ok).toBe(false)
  })

  it('accepts today', () => {
    expect(saveJournal(EMPTY, 'today', 'happy', TODAY, NOON_SAT).ok).toBe(true)
  })

  it('decides "future" by local day: 23:30 PST Nov 21 still cannot write Nov 22', () => {
    const lateNight = new Date(2026, 10, 21, 23, 30) // already Nov 22 in UTC
    expect(saveJournal(EMPTY, 'sneaky', 'happy', TOMORROW, lateNight).ok).toBe(false)
    expect(saveJournal(EMPTY, 'fine', 'happy', TODAY, lateNight).ok).toBe(true)
  })
})

describe('5. past days can be written and edited', () => {
  it('accepts an entry for a past day', () => {
    expect(saveOk(EMPTY, 'looking back', YESTERDAY)[YESTERDAY].day).toBe(YESTERDAY)
  })

  it('allows editing a past day long after it has passed', () => {
    const j1 = saveOk(EMPTY, 'yesterday I...', YESTERDAY)
    const j2 = saveOk(j1, 'yesterday I actually...', YESTERDAY, new Date(2026, 10, 25, 9, 0))
    expect(Object.keys(j2)).toEqual([YESTERDAY])
    expect(j2[YESTERDAY].text).toBe('yesterday I actually...')
    expect(j2[YESTERDAY].createdAt).toBe(j1[YESTERDAY].createdAt)
  })
})

describe('6. text is trimmed, max 300 chars, never empty', () => {
  it('trims surrounding whitespace', () => {
    expect(saveOk(EMPTY, '   hello world  \n', TODAY)[TODAY].text).toBe('hello world')
  })

  it('accepts exactly 300 characters', () => {
    expect(saveOk(EMPTY, 'a'.repeat(300), TODAY)[TODAY].text).toHaveLength(300)
  })

  it('rejects 301 characters', () => {
    expect(saveJournal(EMPTY, 'a'.repeat(301), 'happy', TODAY, NOON_SAT).ok).toBe(false)
  })

  it('measures the limit after trimming', () => {
    expect(saveOk(EMPTY, `  ${'a'.repeat(300)}  `, TODAY)[TODAY].text).toHaveLength(300)
  })

  describe('emojis count as one character each', () => {
    // '😀' is 2 UTF-16 code units, so a naive .length check would cap at 150.
    it('accepts 300 emojis', () => {
      const text = '😀'.repeat(300)
      expect(text.length).toBe(600)
      expect(saveOk(EMPTY, text, TODAY)[TODAY].text).toBe(text)
    })

    it('rejects 301 emojis', () => {
      expect(saveJournal(EMPTY, '😀'.repeat(301), 'happy', TODAY, NOON_SAT).ok).toBe(false)
    })

    // Multi-code-point emojis (skin tone, ZWJ family) still read as one emoji.
    it('accepts 300 skin-tone / ZWJ emojis', () => {
      const text = '👍🏽'.repeat(150) + '👨‍👩‍👧'.repeat(150)
      expect(saveOk(EMPTY, text, TODAY)[TODAY].text).toBe(text)
    })

    it('rejects 301 skin-tone / ZWJ emojis', () => {
      const text = '👍🏽'.repeat(150) + '👨‍👩‍👧'.repeat(151)
      expect(saveJournal(EMPTY, text, 'happy', TODAY, NOON_SAT).ok).toBe(false)
    })

    it('counts mixed text and emojis together: 299 letters + 1 emoji is ok, + 2 is not', () => {
      expect(saveJournal(EMPTY, 'a'.repeat(299) + '🎉', 'happy', TODAY, NOON_SAT).ok).toBe(true)
      expect(saveJournal(EMPTY, 'a'.repeat(299) + '🎉🎉', 'happy', TODAY, NOON_SAT).ok).toBe(false)
    })
  })

  it('rejects empty text', () => {
    expect(saveJournal(EMPTY, '', 'happy', TODAY, NOON_SAT).ok).toBe(false)
  })

  it('rejects whitespace-only text', () => {
    expect(saveJournal(EMPTY, '   \t  ', 'happy', TODAY, NOON_SAT).ok).toBe(false)
  })

  it('applies the same rules when editing an existing day', () => {
    const j1 = saveOk(EMPTY, 'valid', TODAY)
    expect(saveJournal(j1, 'b'.repeat(301), 'happy', TODAY, NOON_SAT).ok).toBe(false)
    expect(saveOk(j1, '  tidy  ', TODAY)[TODAY].text).toBe('tidy')
  })
})

describe('7. weeks start on Monday', () => {
  it('exposes weekStart as Monday', () => {
    expect(weekStart).toBe('Monday')
  })

  it('maps a Monday to itself', () => {
    expect(getWeekStart('2026-11-16')).toBe('2026-11-16')
  })

  it('maps Saturday to the preceding Monday', () => {
    expect(getWeekStart('2026-11-21')).toBe('2026-11-16')
  })

  it('maps Sunday to the preceding Monday (Sunday ends the week)', () => {
    expect(getWeekStart('2026-11-22')).toBe('2026-11-16')
  })

  it('crosses month boundaries', () => {
    // 2026-11-01 is a Sunday -> week started Monday 2026-10-26
    expect(getWeekStart('2026-11-01')).toBe('2026-10-26')
  })
})
