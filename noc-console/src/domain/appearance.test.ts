import { describe, expect, it } from 'vitest'
import { applyStoredAppearance, getStoredTheme, getStoredTypeface, setTheme, setTypeface } from './appearance'

// Regression coverage: this module used to crash on import under Node (no
// localStorage/document), which broke every store.test.ts import too, since
// store.ts reads getStoredTheme/getStoredTypeface at module-eval time to
// seed its initial UI state. The whole suite runs in environment: 'node'
// (vite.config.ts) on purpose, so these guards are load-bearing, not
// defensive filler.
describe('appearance (Node-safe fallbacks, no localStorage/document here)', () => {
  it('defaults to dark/plex without throwing', () => {
    expect(getStoredTheme()).toBe('dark')
    expect(getStoredTypeface()).toBe('plex')
  })
  it('setTheme/setTypeface/applyStoredAppearance do not throw with no DOM to apply to', () => {
    expect(() => setTheme('light')).not.toThrow()
    expect(() => setTypeface('inter')).not.toThrow()
    expect(() => applyStoredAppearance()).not.toThrow()
  })
})
