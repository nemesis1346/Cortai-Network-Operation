// Copies src/api/types.ts verbatim into docs/API-CONTRACT.md's Appendix A,
// between the appendix-a markers. Run after changing types.ts:
//   npm run contract:sync
// src/api/contract.test.ts fails until the two match.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const docPath = `${root}docs/API-CONTRACT.md`
const START = '<!-- appendix-a:start -->'
const END = '<!-- appendix-a:end -->'

const types = readFileSync(`${root}src/api/types.ts`, 'utf8')
const doc = readFileSync(docPath, 'utf8')
const i = doc.indexOf(START)
const j = doc.indexOf(END)
if (i < 0 || j < i) throw new Error(`Appendix A markers not found in ${docPath}`)

const block = `${START}\n\`\`\`ts\n${types.endsWith('\n') ? types : `${types}\n`}\`\`\`\n`
writeFileSync(docPath, doc.slice(0, i) + block + doc.slice(j))
console.log('Appendix A synced from src/api/types.ts')
