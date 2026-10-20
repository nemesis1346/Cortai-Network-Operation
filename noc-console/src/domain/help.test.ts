import { describe, expect, it } from 'vitest'
import { flatArticleOrder, helpContext, prevNextArticle, searchHelp } from './help'
import type { HelpContent } from './help'

const content: HelpContent = {
  version: '1.0', updated: '1 Jan', start: 'welcome', imgBase: 'help/img/',
  toc: [
    { id: 'start', title: 'Getting started', items: ['welcome', 'overview'] },
    { id: 'alarms', title: 'Handle an alarm', items: ['take-alarm', 'close-incident'] },
  ],
  articles: {
    welcome: { title: 'Welcome', type: 'start', summary: 'An intro to the console.', keywords: ['intro', 'start'], related: [], body: 'Hello **world**.' },
    overview: { title: 'The console at a glance', type: 'start', summary: 'The five areas of the screen.', keywords: ['layout'], related: [], body: 'Overview body.' },
    'take-alarm': { title: 'Take the next alarm', type: 'task', summary: 'Take an alarm from the queue.', keywords: ['queue'], related: [], body: 'Press T.' },
    'close-incident': { title: 'Close an incident', type: 'task', summary: 'Write a memo and close.', keywords: ['memo'], related: [], body: 'Dispatch is never automatic.' },
  },
  figures: {},
  diagrams: {},
}

describe('flatArticleOrder / prevNextArticle', () => {
  it('flattens toc sections in order', () => {
    expect(flatArticleOrder(content)).toEqual(['welcome', 'overview', 'take-alarm', 'close-incident'])
  })
  it('prev/next follow tree order across section boundaries', () => {
    expect(prevNextArticle(content, 'overview')).toEqual({ prev: 'welcome', next: 'take-alarm' })
    expect(prevNextArticle(content, 'welcome')).toEqual({ prev: null, next: 'overview' })
    expect(prevNextArticle(content, 'close-incident')).toEqual({ prev: 'take-alarm', next: null })
  })
})

describe('searchHelp', () => {
  it('all query terms must match, score weights title > keywords > summary > body', () => {
    const hits = searchHelp(content, 'alarm')
    // "take-alarm": title match (6); "welcome"/"overview": no match at all
    expect(hits.map((h) => h.id)).toEqual(['take-alarm'])
  })
  it('multi-word queries require every term to match somewhere', () => {
    expect(searchHelp(content, 'dispatch automatic').map((h) => h.id)).toEqual(['close-incident'])
    expect(searchHelp(content, 'dispatch nonexistentterm')).toEqual([])
  })
  it('empty query returns no hits, not every article', () => {
    expect(searchHelp(content, '   ')).toEqual([])
  })
})

describe('helpContext', () => {
  const base = {
    wallOpen: false, shiftReportOpen: false, settingsOpen: false, closingIncidentId: null,
    shortcutsOpen: false, paletteOpen: false, queueRefusal: null, viewingCameraId: null,
    hasEscalation: false, hasOpenLanes: false,
  }
  it('falls back to console-overview with nothing open', () => {
    expect(helpContext(base)).toBe('console-overview')
  })
  it('lane-workspace once a lane is open, with nothing higher-priority active', () => {
    expect(helpContext({ ...base, hasOpenLanes: true })).toBe('lane-workspace')
  })
  it('follows STATES.md §10 priority order — camera wall beats everything else', () => {
    expect(helpContext({ ...base, wallOpen: true, settingsOpen: true, hasEscalation: true })).toBe('camera-wall')
  })
  it('escalation only wins once nothing higher-priority is open', () => {
    expect(helpContext({ ...base, hasEscalation: true, hasOpenLanes: true })).toBe('escalation')
  })
})
