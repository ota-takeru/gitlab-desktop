import { describe, expect, it } from 'vitest'

import english from './messages/en/native.json'

// The native side names its messages by full key, such as `.key("native.merge.forbidden")`.
const rustFiles = import.meta.glob<string>('../../src-tauri/src/**/*.rs', { eager: true, import: 'default', query: '?raw' })
const usedKeys = new Set(Object.values(rustFiles).flatMap((source) => [...source.matchAll(/"native\.([A-Za-z0-9.]+)"/gu)].map((match) => match[1])))

describe('native messages', () => {
  it('reads the Rust sources', () => {
    expect(Object.keys(rustFiles).length).toBeGreaterThan(0)
    expect(usedKeys.size).toBeGreaterThan(0)
  })

  it('has an English message for every key the Rust code sends', () => {
    const missing = [...usedKeys].filter((key) => !Object.hasOwn(english, key))
    expect(missing).toEqual([])
  })

  it('has no message the Rust code no longer sends', () => {
    const unused = Object.keys(english).filter((key) => !usedKeys.has(key))
    expect(unused).toEqual([])
  })
})
