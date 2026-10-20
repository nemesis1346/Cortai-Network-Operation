/**
 * v2 HelpModal (Part 7): types for the real content shipped in
 * `public/help/help.json` — converted verbatim from Oleg's actual
 * `docs-v2/prototype/help/help.js` deliverable (41 articles, 7 sections, 27
 * figures, 4 diagrams), not rewritten. See docs/V2-BUILD-PLAN.md's Part 7
 * notes for the handful of articles that describe screens this build
 * doesn't have yet (sign-in, lock, connection-lost, History) or an
 * interaction that diverges (a "T" take-next key this build never bound) —
 * flagged there rather than silently edited.
 */
export type HelpArticleType = 'start' | 'task' | 'concept' | 'reference' | 'troubleshoot'

export interface HelpArticle {
  title: string
  type: HelpArticleType
  summary: string
  keywords: string[]
  related: string[]
  updated?: string
  body: string
}

/** [xPct, yPct, label, detail, anchor] — anchor is which side the callout
 * label should read from, so it doesn't clip off the edge of the figure. */
export type HelpFigureSpot = [number, number, string, string, 'l' | 'c' | 'r']

export interface HelpFigure {
  src: string
  w: number
  h: number
  alt: string
  caption: string
  spots: HelpFigureSpot[]
}

export interface HelpDiagram {
  alt: string
  caption: string
  svg: string
}

export interface HelpTocSection {
  id: string
  title: string
  items: string[]
}

export interface HelpContent {
  version: string
  updated: string
  start: string
  imgBase: string
  toc: HelpTocSection[]
  articles: Record<string, HelpArticle>
  figures: Record<string, HelpFigure>
  diagrams: Record<string, HelpDiagram>
}

export const ARTICLE_TYPE_LABEL: Record<HelpArticleType, string> = {
  start: 'Getting started',
  task: 'How-to',
  concept: 'Concept',
  reference: 'Reference',
  troubleshoot: 'Troubleshooting',
}

/**
 * Previous/Next follow tree order (HELP.md). Flattens toc sections into one
 * ordered article-id list.
 */
export function flatArticleOrder(content: HelpContent): string[] {
  return content.toc.flatMap((s) => s.items)
}

export function prevNextArticle(content: HelpContent, id: string): { prev: string | null; next: string | null } {
  const order = flatArticleOrder(content)
  const i = order.indexOf(id)
  if (i === -1) return { prev: null, next: null }
  return { prev: order[i - 1] ?? null, next: order[i + 1] ?? null }
}

export interface HelpSearchHit {
  id: string
  title: string
  summary: string
  snippet: string | null
}

/**
 * HELP.md: "search over title (×6), keywords (×4), summary (×2) and body;
 * all terms must match". Every query word must appear somewhere in the
 * weighted fields for the article to match at all; score is the sum of the
 * per-field weights the word was found in, highest first.
 */
export function searchHelp(content: HelpContent, query: string): HelpSearchHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const hits: (HelpSearchHit & { score: number })[] = []
  for (const [id, a] of Object.entries(content.articles)) {
    const title = a.title.toLowerCase()
    const keywords = a.keywords.join(' ').toLowerCase()
    const summary = a.summary.toLowerCase()
    const body = a.body.toLowerCase()
    let score = 0
    let allMatch = true
    for (const t of terms) {
      let weight = 0
      if (title.includes(t)) weight += 6
      if (keywords.includes(t)) weight += 4
      if (summary.includes(t)) weight += 2
      if (body.includes(t)) weight += 1
      if (weight === 0) {
        allMatch = false
        break
      }
      score += weight
    }
    if (!allMatch) continue
    const bodyIdx = body.indexOf(terms[0]!)
    const snippet = bodyIdx === -1 ? null : extractSnippet(a.body, bodyIdx)
    hits.push({ id, title: a.title, summary: a.summary, snippet, score })
  }
  hits.sort((x, y) => y.score - x.score)
  return hits.map(({ score: _score, ...h }) => h)
}

/**
 * v2 STATES.md §10: F1/(?) opens the article for whatever's on screen, in a
 * fixed priority order. Takes plain booleans/ids rather than `UiState`
 * directly — `domain/` sits below `store/` in this project's layering, and
 * this keeps it that way; the caller (the modal, or wherever F1 is handled)
 * assembles these from `ui`/`server`. Rows this build has no screen for yet
 * (sign-in, lock, offline, History) are left out rather than mapped to
 * something approximate.
 */
export function helpContext(ctx: {
  wallOpen: boolean
  shiftReportOpen: boolean
  settingsOpen: boolean
  closingIncidentId: string | null
  shortcutsOpen: boolean
  paletteOpen: boolean
  queueRefusal: string | null
  viewingCameraId: string | null
  hasEscalation: boolean
  hasOpenLanes: boolean
}): string {
  if (ctx.wallOpen) return 'camera-wall'
  if (ctx.shiftReportOpen) return 'shift-report'
  if (ctx.settingsOpen) return 'settings'
  if (ctx.closingIncidentId) return 'close-incident'
  if (ctx.shortcutsOpen) return 'keyboard-shortcuts'
  if (ctx.paletteOpen) return 'command-palette'
  if (ctx.queueRefusal) return 'lane-limit'
  if (ctx.viewingCameraId) return 'camera-view'
  if (ctx.hasEscalation) return 'escalation'
  return ctx.hasOpenLanes ? 'lane-workspace' : 'console-overview'
}

function extractSnippet(body: string, around: number): string {
  const plain = body.replace(/\{\{[^}]+\}\}/g, '').replace(/[#>*_[\]`]/g, '')
  const start = Math.max(0, around - 40)
  const end = Math.min(plain.length, around + 80)
  return `${start > 0 ? '…' : ''}${plain.slice(start, end).trim()}${end < plain.length ? '…' : ''}`
}
