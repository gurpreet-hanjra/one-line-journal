import type { Journal, JournalEntry } from './journal'

/**
 * Storage-agnostic persistence for the journal.
 * Async on purpose so an IndexedDB (or remote) implementation can drop in
 * without changing callers.
 */
export interface JournalStore {
    load(): Promise<Journal>
    save(journal: Journal): Promise<void>
}

/** The subset of the Web Storage API we need; lets tests pass a fake. */
export type KeyValueBackend = Pick<Storage, 'getItem' | 'setItem'>

export const STORAGE_KEY = 'one-line-journal:v1'

function isJournalEntry(value: unknown, day: string): value is JournalEntry {
    if (!value || typeof value !== 'object') return false
    const e = value as Record<string, unknown>
    return (
        typeof e.text === 'string' &&
        typeof e.createdAt === 'string' &&
        typeof e.updatedAt === 'string' &&
        e.day === day &&
        (e.mood === 'happy' || e.mood === 'sad')
    )
}

/** Parses stored JSON, dropping anything malformed instead of crashing the app. */
export function parseJournal(raw: string | null): Journal {
    if (raw === null) return {}
    let data: unknown
    try {
        data = JSON.parse(raw)
    } catch {
        return {}
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const journal: Journal = {}
    for (const [day, entry] of Object.entries(data)) {
        if (isJournalEntry(entry, day)) journal[day] = entry
    }
    return journal
}

export function createLocalStorageStore(
    backend: KeyValueBackend = globalThis.localStorage,
    key: string = STORAGE_KEY,
): JournalStore {
    return {
        async load() {
            return parseJournal(backend.getItem(key))
        },
        async save(journal) {
            // setItem can throw (quota exceeded, private mode); the rejected promise surfaces it.
            backend.setItem(key, JSON.stringify(journal))
        },
    }
}
