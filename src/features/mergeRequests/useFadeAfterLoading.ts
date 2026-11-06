import { useEffect, useState } from 'react'
import { contentFadeInSx } from '../../components/paneSx'

/** A placeholder shown longer than this was seen; the content after it fades in. Saved data arrives sooner. */
const SEEN_MS = 100

/** The sx for content that replaces a placeholder: it fades in only after a placeholder that was seen. */
export function useFadeAfterLoading(placeholder: boolean) {
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (!placeholder) return
    const timer = setTimeout(() => setSeen(true), SEEN_MS)
    return () => clearTimeout(timer)
  }, [placeholder])
  return seen ? contentFadeInSx : undefined
}
