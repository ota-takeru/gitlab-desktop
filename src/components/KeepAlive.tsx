import Box from '@mui/material/Box'
import type { SxProps, Theme } from '@mui/material/styles'
import { Activity, memo, useEffect, useLayoutEffect, useRef, useState, type ElementType, type ReactNode, type SyntheticEvent } from 'react'
import { fadeInSx } from './paneSx'
import { ScreenReadinessGate } from './ScreenReadiness'

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
  /**
   * A screen shown for the first time builds out of sight, the screen before it still
   * showing, until its reads have checked the saved data (see ScreenReadinessGate), so
   * it does not show empty for a moment before data already saved arrives.
   */
  revealWhenReady?: boolean
  /** Whether a new screen is out of sight or still fading in with no kept screen under it, so the caller shows what was there. */
  onRevealPendingChange?: (pending: boolean) => void
  /** Behind a screen fading in, so what it replaces does not show through it. */
  arrivalBackground?: string
}

/** A screen fading in stops covering the one before it by now, should its fade never report an end (reduced motion, a hidden parent). */
const ARRIVAL_LIMIT_MS = 500

const noKeys: readonly string[] = []

interface KeptScreens {
  /** Render order: the order screens were first shown, so returning to one never moves its DOM (and its scroll). */
  order: string[]
  /** Most recently shown first; the last ones not kept are dropped beyond `max`. */
  recent: string[]
  /** The `keep` list the screens were last counted with. */
  kept: string
  /** The limit they were last counted with; a lower one drops screens at once. */
  max: number
  /** The active screen they were last counted with. */
  active: string | null
  /** A new active screen still out of sight with `revealWhenReady`. */
  pending: string | null
  /** The active screen while it fades in, over the screen before it. */
  arriving: string | null
  /** The screen showing in place of `pending`, or under `arriving`, so no blank shows between the two. */
  previous: string | null
}

function keptScreens(screens: KeptScreens, activeKey: string | null, max: number, keep: readonly string[], revealWhenReady: boolean): KeptScreens {
  const kept = new Set(keep)
  let others = 0
  const recent = [...(activeKey === null ? [] : [activeKey]), ...screens.recent.filter((key) => key !== activeKey)]
    .filter((key) => key === activeKey || kept.has(key) || ++others < Math.max(1, max))
  const switching = activeKey !== screens.active
  // The screen showing stays mounted, past `max` too, until the new one has arrived over it: dropped at once, it
  // would leave nothing under a screen fading in or out of sight.
  const showing = switching && activeKey !== null ? (screens.pending === null ? screens.active : screens.previous) : null
  const order = [...screens.order.filter((key) => recent.includes(key) || key === showing), ...(activeKey === null || screens.order.includes(activeKey) ? [] : [activeKey])]
  if (!switching) return { ...screens, kept: keep.join(' '), max, order, previous: screens.previous !== null && order.includes(screens.previous) ? screens.previous : null, recent }
  // Another new screen chosen while one waits keeps the screen that was showing.
  const pending = revealWhenReady && activeKey !== null && !screens.order.includes(activeKey) ? activeKey : null
  const previous = showing !== null && order.includes(showing) ? showing : null
  return { active: activeKey, arriving: pending === null ? activeKey : null, kept: keep.join(' '), max, order, pending, previous, recent }
}

// The screen it covered goes too, when only the arrival kept it.
const arrived = (key: string) => (latest: KeptScreens): KeptScreens => latest.arriving === key ? { ...latest, arriving: null, order: latest.order.filter((screen) => latest.recent.includes(screen)), previous: null } : latest

/**
 * Screens visited recently stay mounted but hidden, so returning to one shows
 * its rendered page, input and scroll at once instead of building it again.
 * Hidden screens run no effects: their requests, polling and key handlers stop
 * until they show again, when their queries refresh in the background.
 * Only the active screen's wrapper carries `data-screen-active="true"`, for
 * document queries that must ignore the hidden ones.
 */
export function KeepAlive({ activeKey, arrivalBackground = 'background.default', children, component = 'div', keep = noKeys, max, onRevealPendingChange, renderKey, revealWhenReady = false, sx }: KeepAliveProps) {
  // The first screen shows at once: there is nothing before it to keep showing.
  const [screens, setScreens] = useState<KeptScreens>({ active: activeKey, arriving: null, kept: '', max, order: [], pending: null, previous: null, recent: [] })
  let current = screens
  if ((activeKey !== null && screens.recent[0] !== activeKey) || screens.active !== activeKey || screens.kept !== keep.join(' ') || screens.max !== max) {
    current = keptScreens(screens, activeKey, max, keep, revealWhenReady)
    setScreens(current)
  }
  const pending = current.pending !== null && current.pending === activeKey
  const arriving = current.arriving !== null && current.arriving === activeKey
  const revealPendingAlone = (pending || arriving) && current.previous === null
  // Before paint, so the caller's screen does not disappear for a frame.
  useLayoutEffect(() => { onRevealPendingChange?.(revealPendingAlone) }, [onRevealPendingChange, revealPendingAlone])
  const arrivingRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (current.arriving === null) return
    const key = current.arriving
    // A fade still running waits for its end: a screen whose first render blocks the page for longer than
    // the limit starts its fade only after it, and hiding the screen under it then shows a blank pane.
    const check = () => {
      if (arrivingRef.current?.getAnimations?.().some((animation) => animation.playState === 'running')) timer = setTimeout(check, ARRIVAL_LIMIT_MS)
      else setScreens(arrived(key))
    }
    let timer = setTimeout(check, ARRIVAL_LIMIT_MS)
    return () => clearTimeout(timer)
  }, [current.arriving])
  return <>{current.order.map((key) => {
    const active = key === activeKey
    const waiting = pending && active
    const under = key === current.previous && !active
    const shown = under || (active && !waiting)
    // A fade inside the screen bubbles here too.
    const fadeEnded = (event: SyntheticEvent) => { if (event.target === event.currentTarget) setScreens(arrived(key)) }
    const reveal = () => setScreens((latest) => latest.pending === key ? { ...latest, arriving: key, pending: null } : latest)
    // The wrapper sits outside Activity: React defers updates inside a hidden subtree, the marker must change at once.
    // A waiting screen is laid out at its full size, transparent, so it measures itself and can take focus as when it shows.
    // A screen coming back from display: none starts the fade again, so every switch fades in.
    // It fades in on top of the screen before it, which hides only when the fade ends: hiding it first shows a blank pane.
    return <Box component={component} data-screen-active={active ? 'true' : 'false'} key={key} ref={active && arriving ? arrivingRef : undefined} onAnimationCancel={fadeEnded} onAnimationEnd={fadeEnded} sx={[...(Array.isArray(sx) ? sx : [sx]), !active && !shown && { display: 'none' }, under && { isolation: 'isolate' }, waiting && { inset: 0, opacity: 0, pointerEvents: 'none', position: 'absolute' }, active && arriving && { bgcolor: arrivalBackground, inset: 0, position: 'absolute', zIndex: 1 }, active && !waiting && fadeInSx]}>
      <Activity mode={active || shown ? 'visible' : 'hidden'}>
        <ScreenReadinessGate onReady={reveal} waiting={waiting}>
          <LastContent hidden={!active} renderKey={active ? renderKey : undefined}>{active ? children : null}</LastContent>
        </ScreenReadinessGate>
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
