import Box from '@mui/material/Box'
import { alpha, useTheme } from '@mui/material/styles'
import { useEffect, useState } from 'react'

import { auditGrid, describeGridIssue, type GridIssue } from '../lib/gridAudit'
import { grid } from '../theme'

declare global {
  interface Window {
    /** Development builds: the grid audit, for the console and the Playwright grid check. */
    __gridAudit?: () => string[]
    /** The same issues with their elements, for inspecting one in the console. */
    __gridIssues?: () => GridIssue[]
  }
}

/**
 * Development aid: Ctrl+Alt+G (or `?grid` in the URL) lays the 4px grid over the window, with every
 * fourth line stronger, and outlines each box the grid audit finds off the grid (the list is in the console).
 */
export function GridOverlay() {
  const theme = useTheme()
  const [visible, setVisible] = useState(() => new URLSearchParams(window.location.search).has('grid'))
  const [marks, setMarks] = useState<{ key: number; rect: DOMRect; label: string }[]>([])
  useEffect(() => {
    window.__gridAudit = () => auditGrid().map(describeGridIssue)
    window.__gridIssues = () => auditGrid()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.code === 'KeyG') setVisible((current) => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      delete window.__gridAudit
      delete window.__gridIssues
    }
  }, [])
  useEffect(() => {
    if (!visible) return
    // Measured after the page settles and again on scroll, without watching every render.
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const issues = auditGrid()
        setMarks(issues.map((issue, key) => ({ key, label: describeGridIssue(issue), rect: issue.element.getBoundingClientRect() })))
        if (issues.length) console.info(issues.map(describeGridIssue).join('\n'))
      })
    }
    const timer = window.setInterval(measure, 2000)
    measure()
    window.addEventListener('scroll', measure, true)
    return () => {
      cancelAnimationFrame(frame)
      window.clearInterval(timer)
      window.removeEventListener('scroll', measure, true)
      setMarks([])
    }
  }, [visible])
  if (!visible) return null
  const line = (opacity: number, step: number) => `repeating-linear-gradient(to bottom, ${alpha(theme.palette.error.main, opacity)} 0 1px, transparent 1px ${step}px)`
  return (
    <Box aria-hidden data-grid-exempt sx={{ inset: 0, pointerEvents: 'none', position: 'fixed', zIndex: theme.zIndex.tooltip + 1 }}>
      <Box sx={{ backgroundImage: `${line(0.35, grid * 4)}, ${line(0.14, grid)}`, inset: 0, position: 'absolute' }} />
      {marks.map(({ key, label, rect }) => <Box key={key} sx={{ height: rect.height, left: rect.left, outline: `2px solid ${theme.palette.warning.main}`, outlineOffset: -1, position: 'absolute', top: rect.top, width: rect.width }} title={label} />)}
    </Box>
  )
}
