import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import { Activity, memo, useState, type ElementType, type ReactNode } from 'react'

interface KeepAliveProps {
  /** The screen on view; null hides every kept screen. */
  activeKey: string | null
  /** The active screen's content. A kept screen shows the content it last had until it is active again. */
  children: ReactNode
  /** How many screens stay mounted, the active one included, besides those in `keep`. */
  max: number
  /** Screens that stay mounted once shown, however many there are, until they leave this list. */
  keep?: readonly string[]
  component?: ElementType
  sx?: SxProps<Theme>
  /**
   * While set, the active screen renders again from here only when this
   * changes, e.g. a list under an open MR that only needs to follow which MR is open.
   */
  renderKey?: string
}

const noKeys: readonly string[] = []

interface KeptScreens {
  /** Render order: the order screens were first shown, so returning to one never moves its DOM (and its scroll). */
  order: string[]
  /** Most recently shown first; the last ones not kept are dropped beyond `max`. */
  recent: string[]
  /** The `keep` list the screens were last counted with. */
  kept: string
}

function keptScreens(screens: KeptScreens, activeKey: string | null, max: number, keep: readonly string[]): KeptScreens {
  const kept = new Set(keep)
  let others = 0
  const recent = [...(activeKey === null ? [] : [activeKey]), ...screens.recent.filter((key) => key !== activeKey)]
    .filter((key) => key === activeKey || kept.has(key) || ++others < Math.max(1, max))
  const order = [...screens.order.filter((key) => recent.includes(key)), ...(activeKey === null || screens.order.includes(activeKey) ? [] : [activeKey])]
  return { kept: keep.join(' '), order, recent }
}

/**
 * Screens visited recently stay mounted but hidden, so returning to one shows
 * its rendered page, input and scroll at once instead of building it again.
 * Hidden screens run no effects: their requests, polling and key handlers stop
 * until they show again, when their queries refresh in the background.
 * Only the active screen's wrapper carries `data-screen-active="true"`, for
 * document queries that must ignore the hidden ones.
 */
export function KeepAlive({ activeKey, children, component = 'div', keep = noKeys, max, renderKey, sx }: KeepAliveProps) {
  const [screens, setScreens] = useState<KeptScreens>({ kept: '', order: [], recent: [] })
  let current = screens
  if ((activeKey !== null && screens.recent[0] !== activeKey) || screens.kept !== keep.join(' ')) {
    current = keptScreens(screens, activeKey, max, keep)
    setScreens(current)
  }
  return <>{current.order.map((key) => {
    const active = key === activeKey
    // The wrapper sits outside Activity: React defers updates inside a hidden subtree, the marker must change at once.
    return <Box component={component} data-screen-active={active ? 'true' : 'false'} key={key} sx={[...(Array.isArray(sx) ? sx : [sx]), !active && { display: 'none' }]}>
      <Activity mode={active ? 'visible' : 'hidden'}>
        <LastContent hidden={!active} renderKey={active ? renderKey : undefined}>{active ? children : null}</LastContent>
      </Activity>
    </Box>
  })}</>
}

/**
 * A hidden screen keeps what it rendered last: its new (empty) content is
 * skipped until it shows again. Context values that change meanwhile still
 * reach it, so callers provide frequently changing ones inside the content.
 */
const LastContent = memo(function LastContent({ children }: { children: ReactNode; hidden: boolean; renderKey?: string }) {
  return children
}, (previous, next) => next.hidden || (!previous.hidden && next.renderKey !== undefined && next.renderKey === previous.renderKey))
