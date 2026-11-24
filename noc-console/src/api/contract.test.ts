import { describe, expect, it } from 'vitest'
import contract from '../../docs/API-CONTRACT.md?raw'
import types from './types.ts?raw'

// docs/API-CONTRACT.md promises a backend can be built from the document
// alone, so its Appendix A carries types.ts verbatim. This keeps that copy
// honest: change types.ts, run `npm run contract:sync`, commit both.
describe('API contract document', () => {
  it("Appendix A is exactly src/api/types.ts", () => {
    const m = contract.match(/<!-- appendix-a:start -->\n```ts\n([\s\S]*?)```\n<!-- appendix-a:end -->/)
    expect(m, 'Appendix A markers missing from docs/API-CONTRACT.md').not.toBeNull()
    const normalized = types.endsWith('\n') ? types : `${types}\n`
    expect(m![1], 'Appendix A is out of date: run `npm run contract:sync`').toBe(normalized)
  })

  it('documents an endpoint for every NocClient method', async () => {
    const client = (await import('./client.ts?raw')).default
    const methods = [...client.matchAll(/^\s{2}(\w+)\(/gm)].map((x) => x[1]!)
    expect(methods.length).toBeGreaterThan(20)
    const ref = contract.slice(contract.indexOf('## 2. Transport'), contract.indexOf('## 3. Commands'))
    const missing = methods.filter((name) => !ref.includes(`| \`${name}\` |`))
    expect(missing, 'NocClient methods with no row in §2b–§2d').toEqual([])
  })
})
