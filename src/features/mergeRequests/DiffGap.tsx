import UnfoldMoreRoundedIcon from '@mui/icons-material/UnfoldMoreRounded'
import { useMemo, type ReactNode } from 'react'

import { highlightLines, type SyntaxToken } from '../../lib/syntaxHighlight'
import type { FileQuery } from '../../types/gitlab'
import { useGitLabQuery } from '../shared/useGitLabQuery'
import type { ParsedLine } from './diffParser'
import { GAP_STEP, gapLines, type DiffGapInfo } from './diffGaps'
import { useT } from '../../i18n/useT'

export interface GapExpansion {
  /** Hidden lines shown so far, by gap. */
  shown: ReadonlyMap<string, number>
  onExpand: (key: string, shown: number) => void
  /** The file as the diff's new side has it, when it is already loaded. */
  content?: string
  /** Otherwise the file is read on demand, sharing the cache of the whole-file view. */
  query?: FileQuery | null
  sessionId?: string | null
  language: string | null
}

type RenderLines = (lines: ParsedLine[], tokens: SyntaxToken[][]) => ReactNode

/**
 * The 「変更のないn行」 row. When the file can be read it opens the hidden lines,
 * keeping the row for the rest when the gap is longer than one step.
 */
export function DiffGap({ expansion, gap, renderLines }: { expansion?: GapExpansion; gap: DiffGapInfo; renderLines: RenderLines }) {
  const t = useT()
  const key = gap.start ? String(gap.start.newLine) : null
  if (!expansion || !key || (expansion.content === undefined && !(expansion.query && expansion.sessionId))) return <div aria-hidden className="diff-gap"><span>{t('review.gap.unchanged', { count: gap.count })}</span></div>
  const shown = expansion.shown.get(key) ?? 0
  const expand = () => expansion.onExpand(key, shown + GAP_STEP)
  if (shown === 0) return <GapButton count={gap.count} onClick={expand} />
  if (expansion.content !== undefined) return <GapLines content={expansion.content} gap={gap} language={expansion.language} onMore={expand} renderLines={renderLines} shown={shown} />
  return <FetchedGapLines gap={gap} language={expansion.language} onMore={expand} query={expansion.query!} renderLines={renderLines} sessionId={expansion.sessionId!} shown={shown} />
}

function GapButton({ count, error, onClick }: { count: number; error?: string; onClick: () => void }) {
  const t = useT()
  return <div className="diff-gap">
    <button aria-label={t('review.gap.show', { count })} className="diff-gap-toggle" onClick={onClick} title={t('review.gap.showTitle')} type="button"><UnfoldMoreRoundedIcon aria-hidden fontSize="inherit" /><span>{t('review.gap.unchanged', { count })}</span></button>
    {error ? <span className="diff-gap-error" role="status">{error}</span> : null}
  </div>
}

function FetchedGapLines({ query, sessionId, ...rest }: { gap: DiffGapInfo; language: string | null; onMore: () => void; query: FileQuery; renderLines: RenderLines; sessionId: string; shown: number }) {
  const t = useT()
  const result = useGitLabQuery<FileQuery>(sessionId, query)
  if (result.data) return <GapLines content={result.data.content} {...rest} />
  if (result.error) return <GapButton count={rest.gap.count} error={t('review.gap.fetchError')} onClick={result.refresh} />
  return <div className="diff-gap" role="status"><span>{t('review.gap.loading', { count: rest.gap.count })}</span></div>
}

function GapLines({ content, gap, language, onMore, renderLines, shown }: { content: string; gap: DiffGapInfo; language: string | null; onMore: () => void; renderLines: RenderLines; shown: number }) {
  const t = useT()
  const { count, newPath, next, oldPath, start } = gap
  // The gap is rebuilt on every render, so memoize on its values.
  const lines = useMemo(() => gapLines(content, { count, newPath, next, oldPath, start }, shown), [content, count, newPath, next?.newLine, next?.text, oldPath, start?.newLine, start?.oldLine, shown]) // eslint-disable-line react-hooks/exhaustive-deps
  const tokens = useMemo(() => lines ? highlightLines(lines.map((line) => line.text), language) : [], [language, lines])
  if (!lines) return <div className="diff-gap"><span>{t('review.gap.unchanged', { count })}</span><span className="diff-gap-error" role="status">{t('review.gap.mismatch')}</span></div>
  return <>
    {renderLines(lines, tokens)}
    {count > lines.length ? <GapButton count={count - lines.length} onClick={onMore} /> : null}
  </>
}
