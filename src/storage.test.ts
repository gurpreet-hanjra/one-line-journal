import { describe, expect, it } from 'vitest'

import { saveJournal } from './journal'
import type { Journal } from './journal'
import { createLocalStorageStore, parseJournal, STORAGE_KEY } from './storage'
import type { KeyValueBackend } from './storage'

function fakeBackend(initial: Record<string, string> = {}): KeyValueBackend & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

function sampleJournal(): Journal {
  const res = saveJournal({}, 'Walked by the river 🌊', 'happy', '2026-11-21', new Date(2026, 10, 21, 12, 0))
  if (!res.ok) throw new Error(res.error)
  return res.journal
}

describe('createLocalStorageStore', () => {
  it('loads an empty journal when nothing is stored', async () => {
    expect(await createLocalStorageStore(fakeBackend()).load()).toEqual({})
  })

  it('round-trips a saved journal', async () => {
    const backend = fakeBackend()
    const store = createLocalStorageStore(backend)
    const journal = sampleJournal()
    await store.save(journal)
    expect(await store.load()).toEqual(journal)
  })

  it('writes under the versioned key by default', async () => {
    const backend = fakeBackend()
    await createLocalStorageStore(backend).save(sampleJournal())
    expect([...backend.data.keys()]).toEqual([STORAGE_KEY])
  })

  it('supports a custom key', async () => {
    const backend = fakeBackend()
    await createLocalStorageStore(backend, 'other').save(sampleJournal())
    expect(backend.data.has('other')).toBe(true)
  })

  it('rejects when the backend throws (e.g. quota exceeded)', async () => {
    const store = createLocalStorageStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    })
    await expect(store.save(sampleJournal())).rejects.toThrow('QuotaExceededError')
  })
})

describe('parseJournal', () => {
  it('returns {} for null, invalid JSON, arrays, and primitives', () => {
    expect(parseJournal(null)).toEqual({})
    expect(parseJournal('{not json')).toEqual({})
    expect(parseJournal('[]')).toEqual({})
    expect(parseJournal('42')).toEqual({})
  })

  it('drops malformed entries but keeps valid ones', () => {
    const valid = sampleJournal()
    const raw = JSON.stringify({
      ...valid,
      '2026-11-19': { text: 'no mood', createdAt: 'x', updatedAt: 'x', day: '2026-11-19' },
      '2026-11-18': { text: 'wrong key', createdAt: 'x', updatedAt: 'x', day: '2026-01-01', mood: 'sad' },
    })
    expect(parseJournal(raw)).toEqual(valid)
  })
})
