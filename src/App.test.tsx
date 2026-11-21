// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { saveJournal } from './journal'
import type { Journal, Mood } from './journal'
import type { JournalStore } from './storage'

// Local times in America/Los_Angeles (pinned in vite.config.ts).
const SATURDAY_NOON = new Date(2026, 10, 21, 12, 0)
const SATURDAY = '2026-11-21'
const FRIDAY = '2026-11-20'
const SUNDAY_NIGHT = new Date(2026, 10, 22, 23, 30)
const SUNDAY = '2026-11-22'
const MONDAY_MORNING = new Date(2026, 10, 23, 8, 0)

type FakeStore = JournalStore & { saved: Journal | null, save: ReturnType<typeof vi.fn> }

function fakeStore(initial: Journal = {}): FakeStore {
  const store: FakeStore = {
    saved: null,
    load: vi.fn(async () => initial),
    save: vi.fn(async (journal: Journal) => {
      store.saved = journal
    }),
  }
  return store
}

function journalWith(text: string, mood: Mood, day: string, now: Date): Journal {
  const res = saveJournal({}, text, mood, day, now)
  if (!res.ok) throw new Error(res.error)
  return res.journal
}

let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  // Fake only Date so real timers (the 600ms counter announcement) still run.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(SATURDAY_NOON)
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

async function renderApp(store: JournalStore = fakeStore()) {
  const user = userEvent.setup()
  const utils = render(<App store={store} />)
  const textbox = screen.getByRole('textbox', { name: /how was today/i })
  await waitFor(() => expect(textbox).toBeEnabled())
  return { user, textbox, ...utils }
}

const happy = () => screen.getByRole('radio', { name: 'Happy' })
const sad = () => screen.getByRole('radio', { name: 'Sad' })
const saveButton = () => screen.getByRole('button', { name: 'Save' })

async function leaveAndReturnAt(now: Date) {
  act(() => {
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
  })
  vi.setSystemTime(now)
  act(() => {
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('rendering and accessibility', () => {
  it('has a labelled text box that includes the current day', async () => {
    const { textbox } = await renderApp()
    expect(textbox).toHaveAccessibleName(/Saturday, November 21/)
  })

  it('groups the mood radios under a "Mood" legend, unselected by default', async () => {
    await renderApp()
    const group = screen.getByRole('group', { name: 'Mood' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('value'))).toEqual(['happy', 'sad'])
    radios.forEach((r) => expect(r).not.toBeChecked())
  })

  it('hides the mood emoji from screen readers so names are just "Happy" / "Sad"', async () => {
    await renderApp()
    expect(happy()).toHaveAccessibleName('Happy')
    expect(sad()).toHaveAccessibleName('Sad')
  })

  it('has a Save submit button', async () => {
    await renderApp()
    expect(saveButton()).toHaveAttribute('type', 'submit')
  })

  it('describes the text box with the remaining-character count', async () => {
    const { textbox } = await renderApp()
    expect(textbox).toHaveAccessibleDescription('300 characters left')
  })
})

describe('loading', () => {
  it('disables the controls until the journal has loaded', async () => {
    let resolve!: (j: Journal) => void
    const store = fakeStore()
    store.load = () => new Promise((r) => (resolve = r))
    render(<App store={store} />)

    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(saveButton()).toBeDisabled()
    expect(happy()).toBeDisabled()

    await act(async () => resolve({}))
    expect(screen.getByRole('textbox')).toBeEnabled()
    expect(saveButton()).toBeEnabled()
    expect(happy()).toBeEnabled()
  })

  it("prefills today's saved entry", async () => {
    const { textbox } = await renderApp(fakeStore(journalWith('already wrote', 'sad', SATURDAY, SATURDAY_NOON)))
    expect(textbox).toHaveValue('already wrote')
    expect(sad()).toBeChecked()
  })

  it("does not prefill another day's entry", async () => {
    const { textbox } = await renderApp(fakeStore(journalWith('yesterday', 'happy', FRIDAY, SATURDAY_NOON)))
    expect(textbox).toHaveValue('')
    expect(happy()).not.toBeChecked()
  })

  it('shows an alert if the journal cannot be loaded', async () => {
    const store = fakeStore()
    store.load = () => Promise.reject(new Error('boom'))
    await renderApp(store)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your journal')
  })
})

describe('character counter', () => {
  it('updates live while typing', async () => {
    const { user, textbox } = await renderApp()
    await user.type(textbox, 'hello')
    expect(screen.getByText('295 characters left')).toBeVisible()
  })

  it('uses the singular for one character left', async () => {
    const { textbox } = await renderApp()
    fireEvent.change(textbox, { target: { value: 'a'.repeat(299) } })
    expect(textbox).toHaveAccessibleDescription('1 character left')
  })

  it('counts an emoji as one character', async () => {
    const { textbox } = await renderApp()
    fireEvent.change(textbox, { target: { value: '😀👨‍👩‍👧' } })
    expect(textbox).toHaveAccessibleDescription('298 characters left')
  })

  it('stops input at 300 characters', async () => {
    const { textbox } = await renderApp()
    fireEvent.change(textbox, { target: { value: 'a'.repeat(305) } })
    expect(textbox).toHaveValue('a'.repeat(300))
    expect(textbox).toHaveAccessibleDescription('0 characters left')
  })

  it('stops at 300 emojis without splitting one', async () => {
    const { textbox } = await renderApp()
    fireEvent.change(textbox, { target: { value: '👍🏽'.repeat(301) } })
    expect(textbox).toHaveValue('👍🏽'.repeat(300))
  })

  it('announces the count to screen readers after typing pauses, not on every keystroke', async () => {
    const { container, textbox } = await renderApp()
    const live = container.querySelector('[aria-live="polite"]')!
    await waitFor(() => expect(live).toHaveTextContent('300 characters left'))

    fireEvent.change(textbox, { target: { value: 'hi' } })
    expect(live).toHaveTextContent('300 characters left') // not yet
    await waitFor(() => expect(live).toHaveTextContent('298 characters left'))
  })
})

describe('saving', () => {
  it('saves today with trimmed text and mood, then confirms', async () => {
    const store = fakeStore()
    const { user, textbox } = await renderApp(store)
    await user.type(textbox, '  a good day  ')
    await user.click(happy())
    await user.click(saveButton())

    const saved = await screen.findByText('Saved.')
    expect(saved).toHaveAttribute('role', 'status')
    expect(store.save).toHaveBeenCalledTimes(1)
    expect(store.saved?.[SATURDAY]).toMatchObject({ text: 'a good day', mood: 'happy', day: SATURDAY })
    expect(textbox).toHaveValue('a good day')
  })

  it('saves with the Enter key on the button (keyboard only)', async () => {
    const store = fakeStore()
    const { user, textbox } = await renderApp(store)
    await user.type(textbox, 'keyboard')
    await user.click(sad())
    saveButton().focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(store.save).toHaveBeenCalledTimes(1))
  })

  it('editing keeps createdAt and changes updatedAt', async () => {
    const initial = journalWith('first', 'happy', SATURDAY, new Date(2026, 10, 21, 9, 0))
    const store = fakeStore(initial)
    const { user, textbox } = await renderApp(store)
    await user.clear(textbox)
    await user.type(textbox, 'second')
    await user.click(saveButton())

    await screen.findByText('Saved.')
    expect(store.saved?.[SATURDAY].createdAt).toBe(initial[SATURDAY].createdAt)
    expect(store.saved?.[SATURDAY].updatedAt).not.toBe(initial[SATURDAY].updatedAt)
    expect(Object.keys(store.saved!)).toEqual([SATURDAY])
  })

  it('shows an alert and does not save when no mood is chosen', async () => {
    const store = fakeStore()
    const { user, textbox } = await renderApp(store)
    await user.type(textbox, 'no mood')
    await user.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Mood must be happy or sad')
    expect(textbox).toHaveAttribute('aria-invalid', 'true')
    expect(textbox).toHaveAccessibleDescription(/Mood must be happy or sad/)
    expect(store.save).not.toHaveBeenCalled()
  })

  it('shows an alert and does not save empty text', async () => {
    const store = fakeStore()
    const { user, textbox } = await renderApp(store)
    await user.type(textbox, '   ')
    await user.click(happy())
    await user.click(saveButton())

    expect(screen.getByRole('alert')).toHaveTextContent('Text cannot be empty')
    expect(store.save).not.toHaveBeenCalled()
  })

  it('clears the error once the user edits again', async () => {
    const { user, textbox } = await renderApp()
    await user.click(saveButton())
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement()

    await user.type(textbox, 'x')
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
    expect(textbox).not.toHaveAttribute('aria-invalid')
  })

  it('shows an alert when storage fails', async () => {
    const store = fakeStore()
    store.save = vi.fn(async () => {
      throw new Error('QuotaExceededError')
    })
    const { user, textbox } = await renderApp(store)
    await user.type(textbox, 'too much')
    await user.click(happy())
    await user.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
  })
})

describe('day change when returning to the tab', () => {
  beforeEach(() => {
    vi.setSystemTime(SUNDAY_NIGHT)
  })

  it('switches to the new day, clears the unsaved draft, and shows a note', async () => {
    const { user, textbox } = await renderApp()
    expect(textbox).toHaveAccessibleName(/Sunday, November 22/)
    await user.type(textbox, 'unsaved Sunday thought')
    await user.click(happy())

    await leaveAndReturnAt(MONDAY_MORNING)

    expect(textbox).toHaveAccessibleName(/Monday, November 23/)
    expect(textbox).toHaveValue('')
    expect(happy()).not.toBeChecked()
    expect(screen.getByText(
      "It's now Monday, November 23. Your unsaved entry for Sunday, November 22 was cleared.",
    )).toBeInTheDocument()
  })

  it('announces the note in a status region', async () => {
    const { user, textbox } = await renderApp()
    await user.type(textbox, 'draft')
    await leaveAndReturnAt(MONDAY_MORNING)

    const note = screen.getByText(/It's now Monday, November 23/)
    expect(note).toHaveAttribute('role', 'status')
  })

  it('omits the "cleared" part when nothing was typed', async () => {
    await renderApp()
    await leaveAndReturnAt(MONDAY_MORNING)
    expect(screen.getByText("It's now Monday, November 23.")).toBeInTheDocument()
  })

  it('does nothing when returning on the same day', async () => {
    const { user, textbox } = await renderApp()
    await user.type(textbox, 'still Sunday')
    await leaveAndReturnAt(new Date(2026, 10, 22, 23, 50))

    expect(textbox).toHaveValue('still Sunday')
    expect(screen.queryByText(/It's now/)).not.toBeInTheDocument()
  })

  it('also checks when the window regains focus', async () => {
    const { textbox } = await renderApp()
    vi.setSystemTime(MONDAY_MORNING)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(textbox).toHaveAccessibleName(/Monday, November 23/)
  })

  it("prefills the new day's entry if one already exists", async () => {
    const journal = journalWith('saved Monday elsewhere', 'sad', '2026-11-23', MONDAY_MORNING)
    const { textbox } = await renderApp(fakeStore(journal))
    await leaveAndReturnAt(MONDAY_MORNING)

    expect(textbox).toHaveValue('saved Monday elsewhere')
    expect(sad()).toBeChecked()
  })

  it('saves to the new day and removes the note after saving', async () => {
    const store = fakeStore()
    const { user, textbox } = await renderApp(store)
    await leaveAndReturnAt(MONDAY_MORNING)

    await user.type(textbox, 'Monday entry')
    await user.click(happy())
    await user.click(saveButton())

    await screen.findByText('Saved.')
    expect(Object.keys(store.saved!)).toEqual(['2026-11-23'])
    expect(screen.queryByText(/It's now/)).not.toBeInTheDocument()
  })

  it('saves to the displayed day if the tab stayed open past midnight', async () => {
    const store = fakeStore()
    const { user, textbox } = await renderApp(store)
    await user.type(textbox, 'late Sunday')
    await user.click(happy())

    vi.setSystemTime(new Date(2026, 10, 23, 0, 10)) // Monday, tab never left
    await user.click(saveButton())

    await screen.findByText('Saved.')
    expect(Object.keys(store.saved!)).toEqual([SUNDAY])
  })

  it('removes its visibility and focus listeners on unmount', async () => {
    const docRemove = vi.spyOn(document, 'removeEventListener')
    const winRemove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = await renderApp()
    unmount()
    expect(docRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(winRemove).toHaveBeenCalledWith('focus', expect.any(Function))
    docRemove.mockRestore()
    winRemove.mockRestore()
  })
})

describe('week strip', () => {
  // Today is Saturday 2026-11-21; the week is Mon 16 .. Sun 22.
  const strip = () => screen.getByRole('group', { name: 'This week' })
  const dayButton = (name: string | RegExp) => within(strip()).getByRole('button', { name })
  const TUESDAY = '2026-11-17'

  describe('layout and accessibility', () => {
    it('sits under the form, after a separator', async () => {
      const { textbox } = await renderApp()
      const form = textbox.closest('form')!
      const separator = screen.getByRole('separator')
      expect(form.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(separator.compareDocumentPosition(strip()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(form).not.toContainElement(strip())
    })

    it('shows 7 day buttons, Monday to Sunday of the current week', async () => {
      await renderApp()
      const buttons = within(strip()).getAllByRole('button')
      expect(buttons.map((b) => b.getAttribute('data-day'))).toEqual([
        '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22',
      ])
    })

    it('gives each button a full accessible name: date plus its state', async () => {
      await renderApp(fakeStore(journalWith('good', 'happy', TUESDAY, SATURDAY_NOON)))
      expect(dayButton('Monday, November 16, missed')).toBeInTheDocument()
      expect(dayButton('Tuesday, November 17, happy')).toBeInTheDocument()
      expect(dayButton('Saturday, November 21, today, not written')).toBeInTheDocument()
      expect(dayButton('Sunday, November 22, future')).toBeInTheDocument()
    })

    it("names today's button with its mood once written", async () => {
      await renderApp(fakeStore(journalWith('done', 'sad', SATURDAY, SATURDAY_NOON)))
      expect(dayButton('Saturday, November 21, today, sad')).toBeInTheDocument()
    })

    it('shows a short weekday and the date number on each button', async () => {
      await renderApp()
      const tuesday = dayButton(/Tuesday, November 17/)
      expect(within(tuesday).getByText('Tue')).toBeInTheDocument()
      expect(within(tuesday).getByText('17')).toBeInTheDocument()
    })

    it('marks only today with aria-current="date"', async () => {
      await renderApp()
      const current = within(strip()).getAllByRole('button').filter((b) => b.getAttribute('aria-current') === 'date')
      expect(current).toEqual([dayButton(/Saturday, November 21/)])
    })

    it('disables future days only', async () => {
      await renderApp()
      expect(dayButton(/Sunday, November 22/)).toBeDisabled()
      for (const name of [/Monday/, /Tuesday/, /Wednesday/, /Thursday/, /Friday/, /Saturday/]) {
        expect(dayButton(name)).toBeEnabled()
      }
    })

    it('shows a pencil on missed past days only', async () => {
      await renderApp(fakeStore(journalWith('good', 'happy', TUESDAY, SATURDAY_NOON)))
      expect(within(dayButton(/Monday/)).getByText('✏️')).toBeInTheDocument()
      expect(within(dayButton(/Tuesday/)).queryByText('✏️')).not.toBeInTheDocument() // written
      expect(within(dayButton(/Saturday/)).queryByText('✏️')).not.toBeInTheDocument() // today
      expect(within(dayButton(/Sunday/)).queryByText('✏️')).not.toBeInTheDocument() // future
      expect(within(strip()).getAllByText('✏️')).toHaveLength(4) // Mon, Wed, Thu, Fri
    })

    it('shows the mood emoji on written days, hidden from screen readers', async () => {
      await renderApp(fakeStore(journalWith('good', 'happy', TUESDAY, SATURDAY_NOON)))
      const emoji = within(dayButton(/Tuesday/)).getByText('😊')
      expect(emoji).toHaveAttribute('aria-hidden', 'true')
    })

    it('marks the day loaded in the form as pressed (today by default)', async () => {
      await renderApp()
      expect(dayButton(/Saturday/)).toHaveAttribute('aria-pressed', 'true')
      expect(dayButton(/Monday/)).toHaveAttribute('aria-pressed', 'false')
    })

    it('disables the day buttons until the journal has loaded', async () => {
      let resolve!: (j: Journal) => void
      const store = fakeStore()
      store.load = () => new Promise((r) => (resolve = r))
      render(<App store={store} />)
      within(strip()).getAllByRole('button').forEach((b) => expect(b).toBeDisabled())
      await act(async () => resolve({}))
      expect(dayButton(/Monday/)).toBeEnabled()
    })
  })

  describe('choosing a day', () => {
    it('clicking a missed day loads it blank into the form and focuses the text box', async () => {
      const { user, textbox } = await renderApp()
      await user.type(textbox, 'today draft')
      await user.click(dayButton(/Tuesday/))

      expect(textbox).toHaveAccessibleName(/Tuesday, November 17/)
      expect(textbox).toHaveValue('')
      expect(happy()).not.toBeChecked()
      expect(sad()).not.toBeChecked()
      expect(textbox).toHaveFocus()
    })

    it('moves the pressed state to the chosen day', async () => {
      const { user } = await renderApp()
      await user.click(dayButton(/Tuesday/))
      expect(dayButton(/Tuesday/)).toHaveAttribute('aria-pressed', 'true')
      expect(dayButton(/Saturday/)).toHaveAttribute('aria-pressed', 'false')
    })

    it('clicking a written day prefills its entry for editing', async () => {
      const { user, textbox } = await renderApp(fakeStore(journalWith('tuesday words', 'sad', TUESDAY, SATURDAY_NOON)))
      await user.click(dayButton(/Tuesday/))
      expect(textbox).toHaveValue('tuesday words')
      expect(sad()).toBeChecked()
    })

    it('clicking today goes back to today (prefilled if saved)', async () => {
      const { user, textbox } = await renderApp(fakeStore(journalWith('today words', 'happy', SATURDAY, SATURDAY_NOON)))
      await user.click(dayButton(/Tuesday/))
      await user.click(dayButton(/Saturday/))
      expect(textbox).toHaveAccessibleName(/Saturday, November 21/)
      expect(textbox).toHaveValue('today words')
      expect(happy()).toBeChecked()
    })

    it('clicking a future day does nothing', async () => {
      const { user, textbox } = await renderApp()
      await user.type(textbox, 'keep me')
      await user.click(dayButton(/Sunday/))
      expect(textbox).toHaveAccessibleName(/Saturday, November 21/)
      expect(textbox).toHaveValue('keep me')
    })

    it('can be chosen with the keyboard', async () => {
      const { user, textbox } = await renderApp()
      dayButton(/Tuesday/).focus()
      await user.keyboard('{Enter}')
      expect(textbox).toHaveAccessibleName(/Tuesday, November 17/)
    })
  })

  describe('saving a chosen day', () => {
    it('saves a missed past day under that day and updates its button', async () => {
      const store = fakeStore()
      const { user, textbox } = await renderApp(store)
      await user.click(dayButton(/Tuesday/))
      await user.type(textbox, 'catching up')
      await user.click(happy())
      await user.click(saveButton())

      await screen.findByText('Saved.')
      expect(Object.keys(store.saved!)).toEqual([TUESDAY])
      expect(store.saved![TUESDAY]).toMatchObject({ text: 'catching up', mood: 'happy', day: TUESDAY })
      expect(dayButton('Tuesday, November 17, happy')).toBeInTheDocument()
      expect(within(dayButton(/Tuesday/)).queryByText('✏️')).not.toBeInTheDocument()
    })

    it('editing a written past day keeps createdAt and changes updatedAt', async () => {
      const initial = journalWith('first', 'happy', TUESDAY, new Date(2026, 10, 17, 20, 0))
      const store = fakeStore(initial)
      const { user, textbox } = await renderApp(store)
      await user.click(dayButton(/Tuesday/))
      await user.clear(textbox)
      await user.type(textbox, 'revised')
      await user.click(sad())
      await user.click(saveButton())

      await screen.findByText('Saved.')
      expect(store.saved![TUESDAY].createdAt).toBe(initial[TUESDAY].createdAt)
      expect(store.saved![TUESDAY].updatedAt).not.toBe(initial[TUESDAY].updatedAt)
      expect(dayButton('Tuesday, November 17, sad')).toBeInTheDocument()
    })

    it("saving today updates today's button", async () => {
      const { user, textbox } = await renderApp()
      await user.type(textbox, 'today done')
      await user.click(sad())
      await user.click(saveButton())
      await screen.findByText('Saved.')
      expect(dayButton('Saturday, November 21, today, sad')).toBeInTheDocument()
    })

    it('stays on the chosen day after saving', async () => {
      const { user, textbox } = await renderApp()
      await user.click(dayButton(/Tuesday/))
      await user.type(textbox, 'catching up')
      await user.click(happy())
      await user.click(saveButton())
      await screen.findByText('Saved.')
      expect(textbox).toHaveAccessibleName(/Tuesday, November 17/)
      expect(dayButton(/Tuesday/)).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('with the tab-return day change', () => {
    it('keeps a chosen past day when returning to the tab on the same day', async () => {
      const { user, textbox } = await renderApp()
      await user.click(dayButton(/Tuesday/))
      await user.type(textbox, 'tuesday draft')
      await leaveAndReturnAt(new Date(2026, 10, 21, 18, 0)) // still Saturday

      expect(textbox).toHaveAccessibleName(/Tuesday, November 17/)
      expect(textbox).toHaveValue('tuesday draft')
      expect(screen.queryByText(/It's now/)).not.toBeInTheDocument()
    })

    it('keeps a chosen past day (and its draft) when returning on a later day', async () => {
      const { user, textbox } = await renderApp()
      await user.click(dayButton(/Tuesday/))
      await user.type(textbox, 'tuesday draft')
      await leaveAndReturnAt(new Date(2026, 10, 22, 9, 0)) // Sunday

      expect(textbox).toHaveAccessibleName(/Tuesday, November 17/)
      expect(textbox).toHaveValue('tuesday draft')
      expect(screen.queryByText(/It's now/)).not.toBeInTheDocument()
      expect(dayButton(/Sunday, November 22/)).toHaveAttribute('aria-current', 'date')
      expect(dayButton(/Sunday, November 22/)).toBeEnabled()
    })

    it('moves to the new week when returning on Monday', async () => {
      vi.setSystemTime(SUNDAY_NIGHT)
      await renderApp()
      expect(dayButton('Sunday, November 22, today, not written')).toBeInTheDocument()

      await leaveAndReturnAt(MONDAY_MORNING)

      expect(within(strip()).getAllByRole('button').map((b) => b.getAttribute('data-day'))).toEqual([
        '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29',
      ])
      expect(dayButton('Monday, November 23, today, not written')).toHaveAttribute('aria-pressed', 'true')
      expect(dayButton(/Tuesday, November 24/)).toBeDisabled()
    })

    it('on a new day, the previous today becomes a past day', async () => {
      vi.setSystemTime(new Date(2026, 10, 20, 22, 0)) // Friday night
      await renderApp()
      await leaveAndReturnAt(SATURDAY_NOON)
      expect(dayButton('Friday, November 20, missed')).toBeEnabled()
      expect(dayButton('Saturday, November 21, today, not written')).toHaveAttribute('aria-current', 'date')
    })
  })
})

describe('week strip: label and switch note', () => {
  const strip = () => screen.getByRole('group', { name: 'This week' })
  const dayButton = (name: RegExp) => within(strip()).getByRole('button', { name })
  const SWITCH_NOTE = 'Your unsaved entry for Saturday, November 21 was cleared.'

  describe('text box label', () => {
    it('asks "How was today?" for today', async () => {
      const { textbox } = await renderApp()
      expect(textbox).toHaveAccessibleName(/^How was today\?.*Saturday, November 21/)
    })

    it('asks "How was your day?" for a past day', async () => {
      const { user, textbox } = await renderApp()
      await user.click(dayButton(/Tuesday/))
      expect(textbox).toHaveAccessibleName(/^How was your day\?.*Tuesday, November 17/)
    })

    it('goes back to "How was today?" when today is chosen again', async () => {
      const { user, textbox } = await renderApp()
      await user.click(dayButton(/Tuesday/))
      await user.click(dayButton(/Saturday/))
      expect(textbox).toHaveAccessibleName(/^How was today\?/)
    })
  })

  describe('note when switching days drops unsaved changes', () => {
    it('shows a note naming the day whose unsaved text was cleared', async () => {
      const { user, textbox } = await renderApp()
      await user.type(textbox, 'unsaved today')
      await user.click(dayButton(/Tuesday/))

      const note = screen.getByText(SWITCH_NOTE)
      expect(note).toHaveAttribute('role', 'status')
    })

    it('shows the note when only the mood was changed and not saved', async () => {
      const { user } = await renderApp(fakeStore(journalWith('saved', 'happy', SATURDAY, SATURDAY_NOON)))
      await user.click(sad())
      await user.click(dayButton(/Tuesday/))
      expect(screen.getByText(SWITCH_NOTE)).toBeInTheDocument()
    })

    it('shows no note when nothing was typed', async () => {
      const { user } = await renderApp()
      await user.click(dayButton(/Tuesday/))
      expect(screen.queryByText(/was cleared/)).not.toBeInTheDocument()
    })

    it('shows no note when the draft matches what was saved', async () => {
      const { user } = await renderApp(fakeStore(journalWith('saved', 'happy', SATURDAY, SATURDAY_NOON)))
      await user.click(dayButton(/Tuesday/))
      expect(screen.queryByText(/was cleared/)).not.toBeInTheDocument()
    })

    it('shows no note when clicking the day already in the form, and keeps the draft', async () => {
      const { user, textbox } = await renderApp()
      await user.type(textbox, 'still typing')
      await user.click(dayButton(/Saturday/))
      expect(textbox).toHaveValue('still typing')
      expect(screen.queryByText(/was cleared/)).not.toBeInTheDocument()
    })

    it('names the past day when leaving it with unsaved text', async () => {
      const { user, textbox } = await renderApp()
      await user.click(dayButton(/Tuesday/))
      await user.type(textbox, 'tuesday draft')
      await user.click(dayButton(/Wednesday/))
      expect(screen.getByText('Your unsaved entry for Tuesday, November 17 was cleared.')).toBeInTheDocument()
    })

    it('removes the note on the next switch that loses nothing', async () => {
      const { user, textbox } = await renderApp()
      await user.type(textbox, 'unsaved today')
      await user.click(dayButton(/Tuesday/))
      await user.click(dayButton(/Wednesday/))
      expect(screen.queryByText(/was cleared/)).not.toBeInTheDocument()
      expect(textbox).toHaveValue('')
    })

    it('removes the note after saving', async () => {
      const { user, textbox } = await renderApp()
      await user.type(textbox, 'unsaved today')
      await user.click(dayButton(/Tuesday/))
      await user.type(textbox, 'tuesday')
      await user.click(happy())
      await user.click(saveButton())
      await screen.findByText('Saved.')
      expect(screen.queryByText(/was cleared/)).not.toBeInTheDocument()
    })

    it('does not save the dropped draft', async () => {
      const store = fakeStore()
      const { user, textbox } = await renderApp(store)
      await user.type(textbox, 'unsaved today')
      await user.click(happy())
      await user.click(dayButton(/Tuesday/))
      expect(store.save).not.toHaveBeenCalled()
    })
  })
})
