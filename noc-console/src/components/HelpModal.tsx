import { useEffect, useRef, useState } from 'react'
import type { HelpContent } from '../domain/help'
import { ARTICLE_TYPE_LABEL, helpContext, prevNextArticle, searchHelp } from '../domain/help'
import { renderHelpBody } from '../domain/helpRender'
import { useHelpContent } from '../hooks/useHelpContent'
import { useServer, useStore, useUi } from '../store/context'
import { mostEscalatedIncident } from '../store/selectors'

function HelpTree({
  content, articleId, expanded, onToggleSection, onSelect,
}: {
  content: HelpContent
  articleId: string | null
  expanded: Set<string>
  onToggleSection: (id: string) => void
  onSelect: (id: string) => void
}) {
  // Flattened visible rows for arrow-key roving focus — simpler than a full
  // WAI-ARIA roving-tabindex tree, but covers the interactions that matter:
  // Up/Down move, Right/Left open/close a section, click always works.
  // No Home/End — flagged as a scope cut in V2-BUILD-PLAN.md's Part 7 notes.
  const rows: { key: string; kind: 'section' | 'article'; id: string }[] = []
  for (const s of content.toc) {
    rows.push({ key: `s-${s.id}`, kind: 'section', id: s.id })
    if (expanded.has(s.id)) for (const a of s.items) rows.push({ key: `a-${a}`, kind: 'article', id: a })
  }
  const refs = useRef(new Map<string, HTMLButtonElement>())

  const move = (fromKey: string, dir: 1 | -1) => {
    const i = rows.findIndex((r) => r.key === fromKey)
    const next = rows[i + dir]
    if (next) refs.current.get(next.key)?.focus()
  }

  return (
    <div className="help-tree" role="tree" aria-label="Help contents">
      {content.toc.map((s) => (
        <div key={s.id} role="group">
          <button
            ref={(el) => {
              if (el) refs.current.set(`s-${s.id}`, el)
            }}
            type="button"
            role="treeitem"
            aria-expanded={expanded.has(s.id)}
            className="help-tree-section"
            onClick={() => onToggleSection(s.id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); move(`s-${s.id}`, 1) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); move(`s-${s.id}`, -1) }
              else if (e.key === 'ArrowRight' && !expanded.has(s.id)) { e.preventDefault(); onToggleSection(s.id) }
              else if (e.key === 'ArrowLeft' && expanded.has(s.id)) { e.preventDefault(); onToggleSection(s.id) }
            }}
          >
            <span className={`caret ${expanded.has(s.id) ? 'open' : ''}`} aria-hidden="true">▶</span>
            {s.title}
          </button>
          {expanded.has(s.id) && (
            <div>
              {s.items.map((id) => (
                <button
                  key={id}
                  ref={(el) => {
                    if (el) refs.current.set(`a-${id}`, el)
                  }}
                  type="button"
                  role="treeitem"
                  aria-current={articleId === id ? 'page' : undefined}
                  className={`help-tree-article ${articleId === id ? 'active' : ''}`}
                  onClick={() => onSelect(id)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); move(`a-${id}`, 1) }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); move(`a-${id}`, -1) }
                    else if (e.key === 'ArrowLeft') { e.preventDefault(); onToggleSection(s.id) }
                  }}
                >
                  {content.articles[id]?.title ?? id}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/** Numbered markers on the full-size figure + a matching legend list —
 * v2 COMPONENTS.md#HelpHotspot/HelpLegendItem: "22px marker... legend under
 * the figure repeats the numbers with label — description." */
function HelpLightbox({
  content, figureId, onClose,
}: {
  content: HelpContent
  figureId: string
  onClose: () => void
}) {
  const fig = content.figures[figureId]
  if (!fig) return null
  return (
    <div className="modal-backdrop help-lightbox-backdrop" onClick={onClose}>
      <div className="help-lightbox" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x help-lightbox-close" aria-label="Close figure" onClick={onClose}>✕</button>
        <div className="help-lightbox-figure">
          <img src={`${content.imgBase}${fig.src}`} alt={fig.alt} />
          {fig.spots.map((s, i) => (
            <span key={i} className={`help-hotspot help-hotspot-${s[4]}`} style={{ left: `${s[0]}%`, top: `${s[1]}%` }}>
              {i + 1}
            </span>
          ))}
        </div>
        <ol className="help-legend">
          {fig.spots.map((s, i) => (
            <li key={i}>
              <span className="help-legend-n">{i + 1}</span>
              <span><b>{s[2]}</b> — {s[3]}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/**
 * v2 HelpModal (Part 7): search, contents tree, one article at a time.
 * Content is the real `public/help/help.json` (41 articles, converted
 * verbatim from Oleg's own help.js — see domain/help.ts's file header).
 * Opens with F1 anywhere, the Help button, the command palette, or a
 * `[text](#id)` link inside another article.
 */
export function HelpModal() {
  const store = useStore()
  const server = useServer()
  const ui = useUi()
  const help = useHelpContent(ui.helpOpen)
  const [articleId, setArticleId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const titleRef = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const close = () => store.setHelpOpen(false)

  // Pick the article for what's on screen the moment Help actually has
  // content to pick from — not just on open, since content may still be
  // loading at that instant.
  useEffect(() => {
    if (!ui.helpOpen || !help.content || articleId) return
    const picked = server
      ? helpContext({
          wallOpen: ui.wallOpen,
          shiftReportOpen: ui.shiftReportOpen,
          settingsOpen: ui.settingsOpen,
          closingIncidentId: ui.closingIncidentId,
          shortcutsOpen: ui.shortcutsOpen,
          paletteOpen: ui.paletteOpen,
          queueRefusal: ui.queueRefusal,
          viewingCameraId: ui.viewingCameraId,
          hasEscalation: !!mostEscalatedIncident(server, Date.now()),
          hasOpenLanes: server.incidents.length > 0,
        })
      : help.content.start
    const id = help.content.articles[picked] ? picked : help.content.start
    setArticleId(id)
    const section = help.content.toc.find((s) => s.items.includes(id))
    if (section) setExpanded(new Set([section.id]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.helpOpen, help.content])

  // Closing clears transient state so the next open re-evaluates context
  // instead of reopening wherever you left off.
  useEffect(() => {
    if (!ui.helpOpen) {
      setArticleId(null)
      setQuery('')
      setLightboxId(null)
    }
  }, [ui.helpOpen])

  // "Article: ... title (receives focus)" — v2 COMPONENTS.md#HelpModal.
  useEffect(() => {
    if (articleId && !query) titleRef.current?.focus()
  }, [articleId, query])

  useEffect(() => {
    if (!ui.helpOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (lightboxId) setLightboxId(null)
        else close()
      } else if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.helpOpen, lightboxId])

  if (!ui.helpOpen) return null

  if (help.status === 'idle' || help.status === 'loading') {
    return (
      <div className="modal-backdrop" onClick={close}>
        <div className="modal help" role="dialog" aria-modal="true" aria-label="Help" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head"><b>Help</b><button className="modal-x" aria-label="Close" onClick={close}>✕</button></div>
          <div className="help-skeleton" aria-busy="true">
            <div className="help-skeleton-line w60" /><div className="help-skeleton-line w90" />
            <div className="help-skeleton-line w40" /><div className="help-skeleton-line w80" />
          </div>
        </div>
      </div>
    )
  }
  if (help.status === 'error') {
    return (
      <div className="modal-backdrop" onClick={close}>
        <div className="modal help" role="dialog" aria-modal="true" aria-label="Help" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head"><b>Help</b><button className="modal-x" aria-label="Close" onClick={close}>✕</button></div>
          <div className="help-error">
            <p>Help could not load.</p>
            <button className="btn" onClick={help.retry}>Try again</button>
          </div>
        </div>
      </div>
    )
  }

  if (help.status !== 'ready') return null // unreachable — narrows `content` below, the two branches above already handled idle/loading/error
  const content = help.content
  const article = articleId ? content.articles[articleId] : null
  const hits = query.trim() ? searchHelp(content, query) : null

  const navigate = (id: string) => {
    if (!content.articles[id]) return
    setArticleId(id)
    setQuery('')
    const section = content.toc.find((s) => s.items.includes(id))
    if (section) setExpanded((prev) => new Set(prev).add(section.id))
  }

  const section = articleId ? content.toc.find((s) => s.items.includes(articleId)) : null
  const { prev, next } = articleId ? prevNextArticle(content, articleId) : { prev: null, next: null }
  const rendered = article
    ? renderHelpBody(article.body, {
        onNavigate: navigate,
        onFigure: setLightboxId,
        figures: content.figures,
        diagrams: content.diagrams,
        imgBase: content.imgBase,
      })
    : null

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal help" role="dialog" aria-modal="true" aria-label="Help" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <b>Help</b>
          <button className="modal-x" aria-label="Close" onClick={close}>✕</button>
        </div>
        <div className="help-search-row">
          <input
            ref={searchRef}
            className="help-search"
            placeholder="Search help… (press / )"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits && hits[0]) navigate(hits[0].id)
            }}
          />
        </div>
        <div className="help-body">
          {query.trim() ? (
            <div className="help-results">
              {hits && hits.length ? (
                hits.map((h) => (
                  <button key={h.id} className="help-result" onClick={() => navigate(h.id)}>
                    <b>{h.title}</b>
                    <span>{h.snippet ?? h.summary}</span>
                  </button>
                ))
              ) : (
                <p className="empty">No results for "{query}".</p>
              )}
            </div>
          ) : (
            <HelpTree
              content={content}
              articleId={articleId}
              expanded={expanded}
              onToggleSection={(id) =>
                setExpanded((prev) => {
                  const next2 = new Set(prev)
                  if (next2.has(id)) next2.delete(id)
                  else next2.add(id)
                  return next2
                })
              }
              onSelect={navigate}
            />
          )}
          <div className="help-article">
            {article && rendered ? (
              <>
                <p className="help-breadcrumb">{section?.title ?? ''} <span aria-hidden="true">›</span> {article.title}</p>
                <span className={`help-type-badge help-type-${article.type}`}>{ARTICLE_TYPE_LABEL[article.type]}</span>
                <h2 className="help-title" tabIndex={-1} ref={titleRef}>{article.title}</h2>
                <p className="help-summary">{article.summary}</p>
                {rendered.headings.length >= 3 && (
                  <nav className="help-toc" aria-label="On this page">
                    <span className="ws-sub-h">On this page</span>
                    <ul>
                      {rendered.headings.map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            className="help-link"
                            onClick={() => document.getElementById(h.id)?.scrollIntoView({ block: 'start' })}
                          >
                            {h.text}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}
                <div className="help-content">{rendered.nodes}</div>
                {article.related.length > 0 && (
                  <div className="help-related">
                    <span className="ws-sub-h">Related</span>
                    <ul>
                      {article.related.map((id) => (
                        <li key={id}>
                          <button type="button" className="help-link" onClick={() => navigate(id)}>
                            {content.articles[id]?.title ?? id}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="help-prevnext">
                  <button className="btn sm" disabled={!prev} onClick={() => prev && navigate(prev)}>
                    ← {prev ? content.articles[prev]?.title : ''}
                  </button>
                  <button className="btn sm" disabled={!next} onClick={() => next && navigate(next)}>
                    {next ? content.articles[next]?.title : ''} →
                  </button>
                </div>
                <p className="help-meta">
                  Updated {article.updated ?? content.updated} · Help v{content.version} · {articleId}
                </p>
              </>
            ) : (
              <p className="empty">Select an article.</p>
            )}
          </div>
        </div>
      </div>
      {lightboxId && <HelpLightbox content={content} figureId={lightboxId} onClose={() => setLightboxId(null)} />}
    </div>
  )
}
