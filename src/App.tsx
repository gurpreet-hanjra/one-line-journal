import { useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import './App.css'
import {
  dayChangeMessage, draftForDay, formatDay, hasUnsavedChanges, switchDayMessage, syncDraftToToday, watchTabReturn,
} from './dayChange'
import type { Draft } from './dayChange'
import { countCharacters, MAX_TEXT_LENGTH, saveJournal, toLocalDay, truncateToCharacters } from './journal'
import type { Journal, Mood } from './journal'
import { createLocalStorageStore } from './storage'
import type { JournalStore } from './storage'
import { describeCell, getWeekStrip, shortWeekday } from './weekStrip'
import type { DayCell } from './weekStrip'

const MOOD_OPTIONS: { value: Mood, label: string, emoji: string }[] = [
  { value: 'happy', label: 'Happy', emoji: '😊' },
  { value: 'sad', label: 'Sad', emoji: '😔' },
]
const MOOD_EMOJI: Record<Mood, string> = { happy: '😊', sad: '😔' }

function cellIcon(cell: DayCell): string {
  if (cell.kind === 'written') return MOOD_EMOJI[cell.entry.mood]
  if (cell.kind === 'missed') return '✏️'
  return ''
}

// Screen readers hear the remaining count after typing pauses, not on every keystroke.
const ANNOUNCE_DELAY_MS = 600

type Status =
  | { kind: 'idle' }
  | { kind: 'saved' }
  | { kind: 'error', message: string }

const defaultStore = createLocalStorageStore()

function remainingLabel(remaining: number): string {
  return `${remaining} ${remaining === 1 ? 'character' : 'characters'} left`
}

function App({ store = defaultStore }: { store?: JournalStore }) {
  const [journal, setJournal] = useState<Journal | null>(null)
  // `today` is the real local day; `draft.day` is the day loaded in the form (today or a past day).
  const [today, setToday] = useState(() => toLocalDay(new Date()))
  const [draft, setDraft] = useState<Draft>(() => draftForDay({}, today))
  const [notice, setNotice] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [announcement, setAnnouncement] = useState('')

  // Latest values for the tab-return listener, which is subscribed once.
  const draftRef = useRef(draft)
  const journalRef = useRef(journal)
  const todayRef = useRef(today)
  useEffect(() => {
    draftRef.current = draft
    journalRef.current = journal
    todayRef.current = today
  })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const ids = useId()
  const textId = `${ids}-text`
  const countId = `${ids}-count`
  const errorId = `${ids}-error`

  const remaining = MAX_TEXT_LENGTH - countCharacters(draft.text)
  const loading = journal === null

  // Load once; prefill today's entry so saving edits it instead of starting blank.
  useEffect(() => {
    let cancelled = false
    store.load().then(
      (loaded) => {
        if (cancelled) return
        const loadDay = toLocalDay(new Date())
        setJournal(loaded)
        setToday(loadDay)
        setDraft(draftForDay(loaded, loadDay))
      },
      () => {
        if (cancelled) return
        setJournal({})
        setStatus({ kind: 'error', message: 'Could not load your journal. New entries may not be saved.' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [store])

  // When the user comes back to the tab on a new day, move the week strip to it.
  // If the form was on "today", follow it to the new today and clear the draft;
  // a past day the user chose stays put.
  useEffect(() => {
    return watchTabReturn(() => {
      const current = journalRef.current
      if (!current) return
      const now = new Date()
      const previousToday = todayRef.current
      if (toLocalDay(now) === previousToday) return
      setToday(toLocalDay(now))
      if (draftRef.current.day !== previousToday) return
      const sync = syncDraftToToday(draftRef.current, current, now)
      if (!sync.changed) return
      setDraft(sync.draft)
      setNotice(dayChangeMessage(sync.notice))
      setStatus({ kind: 'idle' })
    })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setAnnouncement(remainingLabel(remaining)), ANNOUNCE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [remaining])

  function handleTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const text = truncateToCharacters(e.target.value, MAX_TEXT_LENGTH)
    setDraft((d) => ({ ...d, text }))
    setStatus({ kind: 'idle' })
  }

  function handleMoodChange(e: ChangeEvent<HTMLInputElement>) {
    const mood = e.target.value as Mood
    setDraft((d) => ({ ...d, mood }))
    setStatus({ kind: 'idle' })
  }

  function handleSelectDay(day: string) {
    if (!journal) return
    if (day !== draft.day) {
      const lost = hasUnsavedChanges(draft, journal)
      setDraft(draftForDay(journal, day))
      setNotice(lost ? switchDayMessage(draft.day) : null)
      setStatus({ kind: 'idle' })
    }
    textareaRef.current?.focus()
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!journal) return
    // Save to the day the user sees. Past days are allowed, so a tab left open
    // past midnight still saves where the user expects.
    const { day } = draft
    const result = saveJournal(journal, draft.text, draft.mood as Mood, day, new Date())
    if (!result.ok) {
      setStatus({ kind: 'error', message: result.error })
      return
    }
    try {
      await store.save(result.journal)
    } catch {
      setStatus({ kind: 'error', message: 'Could not save. Your browser storage may be full or disabled.' })
      return
    }
    setJournal(result.journal)
    setDraft(draftForDay(result.journal, day))
    setNotice(null)
    setStatus({ kind: 'saved' })
  }

  const hasError = status.kind === 'error'
  const week = getWeekStrip(journal ?? {}, today, today)

  return (
    <main className="journal">
      <h1>One-line journal</h1>
      <form className="journal-form" onSubmit={handleSubmit} noValidate>
        <label htmlFor={textId} className="journal-label">
          {draft.day === today ? 'How was today?' : 'How was your day?'}{' '}
          <span className="journal-date">{formatDay(draft.day)}</span>
        </label>
        <p role="status" className="journal-day-notice">
          {notice ?? ''}
        </p>
        <textarea
          ref={textareaRef}
          id={textId}
          name="text"
          rows={3}
          value={draft.text}
          onChange={handleTextChange}
          disabled={loading}
          required
          aria-describedby={hasError ? `${countId} ${errorId}` : countId}
          aria-invalid={hasError || undefined}
        />
        <p id={countId} className={`journal-count${remaining <= 20 ? ' is-low' : ''}`}>
          {remainingLabel(remaining)}
        </p>
        <p className="visually-hidden" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>

        <fieldset className="journal-mood" disabled={loading}>
          <legend>Mood</legend>
          {MOOD_OPTIONS.map((option) => (
            <label key={option.value} className="journal-mood-option">
              <input
                type="radio"
                name="mood"
                value={option.value}
                checked={draft.mood === option.value}
                onChange={handleMoodChange}
                required
              />
              <span aria-hidden="true">{option.emoji}</span> {option.label}
            </label>
          ))}
        </fieldset>

        <button type="submit" disabled={loading}>Save</button>

        <div role="alert" id={errorId} className="journal-error">
          {status.kind === 'error' ? status.message : ''}
        </div>
        <div role="status" className="journal-saved">
          {status.kind === 'saved' ? 'Saved.' : ''}
        </div>
      </form>

      <hr className="journal-separator" />

      <div role="group" aria-label="This week" className="week-strip">
        {week.map((cell) => (
          <button
            key={cell.day}
            type="button"
            data-day={cell.day}
            className={`week-day is-${cell.kind}`}
            aria-label={describeCell(cell, today)}
            aria-pressed={cell.day === draft.day}
            aria-current={cell.day === today ? 'date' : undefined}
            disabled={loading || cell.kind === 'future'}
            onClick={() => handleSelectDay(cell.day)}
          >
            <span aria-hidden="true" className="week-day-name">{shortWeekday(cell.day)}</span>
            <span aria-hidden="true" className="week-day-num">{Number(cell.day.slice(8))}</span>
            <span aria-hidden="true" className="week-day-icon">{cellIcon(cell)}</span>
          </button>
        ))}
      </div>
    </main>
  )
}

export default App
