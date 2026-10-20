import type { ReactNode } from 'react'

const BADGE_COLOR: Record<string, 'warn' | 'ok' | 'info' | 'neutral'> = {
  'b-warn': 'warn',
  'b-ok': 'ok',
  'b-info': 'info',
  'b-neu': 'neutral',
}

const CALLOUT_LABEL: Record<string, string> = {
  NOTE: 'Note', TIP: 'Tip', WARNING: 'Warning', IMPORTANT: 'Important', CAUTION: 'Caution',
}

/** `{{lane:A}}` reuses the same `.lane-key` badge LaneWorkspace already renders. */
function LaneToken({ value }: { value: string }) {
  return <span className="lane-key help-inline-lane">{value}</span>
}
/** `{{prio:P1}}` reuses Queue's own `.pr` priority styling. */
function PrioToken({ value }: { value: string }) {
  return <span className={`pr mono help-inline-prio ${value.toLowerCase()}`}>{value}</span>
}
/** `{{dot:live}}` reuses the exact status-dot shapes from EstateTree/CameraWall. */
function DotToken({ value }: { value: string }) {
  return <span className={`tile-dot help-inline-dot ${value}`} aria-hidden="true" />
}
/** `{{badge:b-warn|Halted}}` — ladder/record status badges. */
function BadgeToken({ value }: { value: string }) {
  const [kind, label] = value.split('|')
  const color = BADGE_COLOR[kind ?? ''] ?? 'neutral'
  return <span className={`help-badge help-badge-${color}`}>{label ?? value}</span>
}
/** `{{icon:…}}` — the content never actually uses this token (checked against
 * the real data), and this project has no icon set to render one with; kept
 * as an honest text fallback rather than silently dropping the token if a
 * future content edit ever adds one. */
function IconToken({ value }: { value: string }) {
  return <span className="help-icon-tag">{value}</span>
}

/** `[[Shift+?]]` → one `<kbd>` per key, split on `+`. */
function KeyToken({ combo }: { combo: string }) {
  const keys = combo.split('+')
  return (
    <>
      {keys.map((k, i) => (
        <span key={i}>
          {i > 0 && '+'}
          <kbd>{k}</kbd>
        </span>
      ))}
    </>
  )
}

const INLINE_RE =
  /\*\*(.+?)\*\*|\*(.+?)\*|\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)|\{\{(lane|prio|dot|icon|badge):([^}]+)\}\}/g

/** Bold, italic, key combos, links (internal `#id` or external), and the
 * inline UI tokens — the full inline subset from help.js's own doc comment,
 * minus block-level constructs (those are handled by `renderBody` first). */
export function parseInline(text: string, onNavigate: (id: string) => void, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyPrefix}-${i++}`
    if (m[1] !== undefined) out.push(<b key={key}>{m[1]}</b>)
    else if (m[2] !== undefined) out.push(<em key={key}>{m[2]}</em>)
    else if (m[3] !== undefined) out.push(<KeyToken key={key} combo={m[3]} />)
    else if (m[4] !== undefined && m[5] !== undefined) {
      const href = m[5]
      if (href.startsWith('#')) {
        const id = href.slice(1)
        out.push(
          <button key={key} type="button" className="help-link" onClick={() => onNavigate(id)}>
            {m[4]}
          </button>,
        )
      } else {
        out.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="help-link">
            {m[4]}
          </a>,
        )
      }
    } else if (m[6] !== undefined && m[7] !== undefined) {
      const value = m[7]
      if (m[6] === 'lane') out.push(<LaneToken key={key} value={value} />)
      else if (m[6] === 'prio') out.push(<PrioToken key={key} value={value} />)
      else if (m[6] === 'dot') out.push(<DotToken key={key} value={value} />)
      else if (m[6] === 'badge') out.push(<BadgeToken key={key} value={value} />)
      else out.push(<IconToken key={key} value={value} />)
    }
    last = INLINE_RE.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

interface RenderCtx {
  onNavigate: (id: string) => void
  onFigure: (id: string) => void
  figures: Record<string, { src: string; alt: string; caption: string }>
  diagrams: Record<string, { svg: string; alt: string; caption: string }>
  imgBase: string
}

/** v2 help.js's Markdown subset (see its own header comment for the full
 * grammar). Block-level: splits the body into runs of the same construct
 * (heading / paragraph / list / steps / table / callout / figure /
 * diagram), then runs `parseInline` over each block's text content. */
export function renderHelpBody(
  body: string,
  ctx: RenderCtx,
): { nodes: ReactNode[]; headings: { id: string; text: string }[] } {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const nodes: ReactNode[] = []
  const headings: { id: string; text: string }[] = []
  let i = 0
  let key = 0

  const next = () => `b${key++}`

  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    if (line.startsWith('### ')) {
      nodes.push(<h4 key={next()} className="help-h3">{parseInline(line.slice(4), ctx.onNavigate, next())}</h4>)
      i++
      continue
    }
    if (line.startsWith('## ')) {
      const text = line.slice(3)
      const id = `h2-${headings.length}`
      headings.push({ id, text: text.replace(/[*[\]]/g, '') })
      nodes.push(<h3 key={next()} className="help-h2" id={id}>{parseInline(text, ctx.onNavigate, next())}</h3>)
      i++
      continue
    }
    const figMatch = line.trim().match(/^\{\{fig:([\w-]+)\}\}$/)
    if (figMatch) {
      const id = figMatch[1]!
      const fig = ctx.figures[id]
      nodes.push(
        fig ? (
          <button key={next()} type="button" className="help-figure" onClick={() => ctx.onFigure(id)}>
            <img src={`${ctx.imgBase}${fig.src}`} alt={fig.alt} loading="lazy" />
            <span className="help-figure-caption">{fig.caption}</span>
          </button>
        ) : (
          <p key={next()} className="help-missing">[Figure "{id}" not found]</p>
        ),
      )
      i++
      continue
    }
    const diagMatch = line.trim().match(/^\{\{diagram:([\w-]+)\}\}$/)
    if (diagMatch) {
      const id = diagMatch[1]!
      const d = ctx.diagrams[id]
      nodes.push(
        d ? (
          <figure key={next()} className="help-diagram" role="img" aria-label={d.alt}>
            {/* Trusted static content copied verbatim from Oleg's own help.js,
                not user input — see domain/help.ts's file header. */}
            <div dangerouslySetInnerHTML={{ __html: d.svg }} />
            <figcaption>{d.caption}</figcaption>
          </figure>
        ) : (
          <p key={next()} className="help-missing">[Diagram "{id}" not found]</p>
        ),
      )
      i++
      continue
    }
    if (line.startsWith('> ') || line === '>') {
      let type = 'NOTE'
      const first = line.replace(/^>\s?/, '')
      const typeMatch = first.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s?(.*)$/)
      const body1: string[] = []
      if (typeMatch) {
        type = typeMatch[1]!
        if (typeMatch[2]) body1.push(typeMatch[2])
      } else if (first) {
        body1.push(first)
      }
      i++
      while (i < lines.length && (lines[i]!.startsWith('> ') || lines[i] === '>')) {
        body1.push(lines[i]!.replace(/^>\s?/, ''))
        i++
      }
      const bodyText = body1.join(' ').trim()
      nodes.push(
        <div key={next()} className={`help-callout help-callout-${type.toLowerCase()}`} role="note">
          <span className="help-callout-label">{CALLOUT_LABEL[type]}</span>
          <span>{parseInline(bodyText, ctx.onNavigate, next())}</span>
        </div>,
      )
      continue
    }
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i]!.startsWith('- ')) {
        items.push(lines[i]!.slice(2))
        i++
      }
      nodes.push(
        <ul key={next()} className="help-list">
          {items.map((it, ix) => <li key={ix}>{parseInline(it, ctx.onNavigate, `${next()}-${ix}`)}</li>)}
        </ul>,
      )
      continue
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+\.\s/, ''))
        i++
      }
      nodes.push(
        <ol key={next()} className="help-steps">
          {items.map((it, ix) => (
            <li key={ix}>
              <span className="help-step-n">{ix + 1}</span>
              <span>{parseInline(it, ctx.onNavigate, `${next()}-${ix}`)}</span>
            </li>
          ))}
        </ol>,
      )
      continue
    }
    if (line.startsWith('|')) {
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.startsWith('|')) {
        const cells = lines[i]!.split('|').slice(1, -1).map((c) => c.trim())
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells)
        i++
      }
      const [header, ...body2] = rows
      nodes.push(
        <table key={next()} className="help-table">
          {header && (
            <thead>
              <tr>{header.map((c, ix) => <th key={ix}>{parseInline(c, ctx.onNavigate, `${next()}-h${ix}`)}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {body2.map((row, rix) => (
              <tr key={rix}>
                {row.map((c, cix) =>
                  cix === 0 ? (
                    <th key={cix} scope="row">{parseInline(c, ctx.onNavigate, `${next()}-${rix}-${cix}`)}</th>
                  ) : (
                    <td key={cix}>{parseInline(c, ctx.onNavigate, `${next()}-${rix}-${cix}`)}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>,
      )
      continue
    }
    // paragraph: consecutive plain lines until a blank line or a new block
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i]!.trim() !== '' && !/^(#{2,3}\s|\{\{fig:|\{\{diagram:|>\s|>$|-\s|\d+\.\s|\|)/.test(lines[i]!)) {
      para.push(lines[i]!)
      i++
    }
    nodes.push(<p key={next()}>{parseInline(para.join(' '), ctx.onNavigate, next())}</p>)
  }

  return { nodes, headings }
}
