import Box from '@mui/material/Box'
import ListItemButton from '@mui/material/ListItemButton'
import Typography from '@mui/material/Typography'
import { memo, useEffect, useRef, useState } from 'react'

import { Row } from '../../components/Row'
import { useT } from '../../i18n/useT'
import { LineCounts } from './diffShared'
import type { DiffOutline, OutlineEntry } from './diffOutline'

/** Frames to keep looking for the line at the top of the view after a scroll: about half a second. */
const MAX_LOCATE_RETRIES = 30

const LINE_MARK ={ add: '+', remove: '−', context: '' } as const
const LINE_COLOR = { add: 'success.main', remove: 'error.main', context: 'text.secondary' } as const

/**
 * The table of contents of a file's diff. It follows the page by asking `locate` for the entry at the
 * top of the view once per frame while scrolling, and only this list renders again for it.
 */
export const DiffOutlineList = memo(function DiffOutlineList({ locate, onSelect, outline }: { locate: () => number | null; onSelect: (entry: OutlineEntry) => void; outline: DiffOutline }) {
  const t = useT()
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    let retries = 0
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    function update() {
      frame = 0
      const next = locate()
      if (next !== null) {
        retries = 0
        setActive(next)
      } else if (retries < MAX_LOCATE_RETRIES) {
        // A piece just scrolled onto the screen has no rows to find until its layout, and no further scroll event may follow.
        // A thread at the point has none either, so this gives up in the end and keeps the entry shown.
        retries += 1
        schedule()
      }
    }
    update()
    // The page scrolls in a pane, whose scroll events do not bubble to the window; they do pass it on the way down.
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [locate, outline])
  // Only the list moves to keep the current entry in view; `scrollIntoView` would also move the page being read.
  useEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>('[aria-current="location"]')
    if (!list || !item) return
    const top = item.getBoundingClientRect().top - list.getBoundingClientRect().top
    if (top < 0 || top + item.offsetHeight > list.clientHeight) list.scrollTop += top - list.clientHeight / 2
  }, [active])
  return <Box ref={listRef} sx={{ minHeight: 0, overflowY: 'auto', p: 0.5 }}>
    {outline.entries.map((entry, index) => {
      const current = index === active
      return <ListItemButton aria-current={current ? 'location' : undefined} aria-label={t('review.diff.outline.entry', { label: entry.label, line: String(entry.line) })} key={`${entry.kind}:${entry.lineIndex}`} onClick={() => onSelect(entry)} selected={current} sx={{ display: 'block', pl: entry.nested ? 2 : 1, pr: 0.5, py: 0 }} title={entry.label}>
        {entry.kind === 'hunk' ? <Row spacing={1}><Typography color="textSecondary" sx={{ fontFamily: 'code.fontFamily' }} variant="caption">{entry.line}</Typography>{entry.counts ? <LineCounts {...entry.counts} /> : null}</Row> : null}
        <Row align="top" spacing={0.5} sx={{ minWidth: 0 }}>
          {entry.kind === 'definition' ? <Typography aria-hidden color="textSecondary" component="span" sx={{ flexShrink: 0, fontFamily: 'code.fontFamily', minWidth: 32, textAlign: 'right' }} variant="caption"><Box component="span" sx={{ color: LINE_COLOR[entry.lineKind] }}>{LINE_MARK[entry.lineKind]}</Box>{entry.line}</Typography> : null}
          {/* Two lines tell most entries apart; the title has the rest. */}
          <Typography component="span" sx={{ display: '-webkit-box', fontFamily: 'code.fontFamily', fontWeight: entry.kind === 'hunk' ? 600 : 400, minWidth: 0, overflow: 'hidden', overflowWrap: 'anywhere', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }} variant="caption">{entry.label}</Typography>
        </Row>
      </ListItemButton>
    })}
    {outline.omitted ? <Typography color="textSecondary" component="div" role="note" sx={{ px: 1 }} variant="caption">{t('review.diff.outline.omitted', { count: outline.omitted })}</Typography> : null}
  </Box>
})
