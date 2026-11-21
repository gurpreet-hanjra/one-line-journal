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
