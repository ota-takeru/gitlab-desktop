import { Image } from '@tauri-apps/api/image'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { appBadgeColors } from '../theme'
import { isTauri } from './runtime'

/** Drawn at twice the taskbar's small-icon size, so it stays sharp on high-DPI screens. */
const OVERLAY_SIZE = 32

let shown = ''
let writeTail: Promise<void> = Promise.resolve()

/**
 * Shows the unread notifications on the app icon, as chat apps do: a badge count on macOS and
 * Linux, and on Windows, which has no badge, a red mark with `label` over the taskbar button.
 * An empty label clears both.
 */
export function setAppBadge(count: number, label: string): void {
  if (!isTauri() || label === shown) return
  shown = label
  // One write at a time, so a quick clear after a count cannot land before it.
  writeTail = writeTail.then(() => writeBadge(count, label)).catch(() => undefined)
}

async function writeBadge(count: number, label: string): Promise<void> {
  const window = getCurrentWindow()
  await window.setBadgeCount(label && count > 0 ? count : undefined).catch(() => undefined)
  const pixels = label ? overlayPixels(label) : null
  if (!pixels) {
    await window.setOverlayIcon(undefined)
    return
  }
  const icon = await Image.new(pixels, OVERLAY_SIZE, OVERLAY_SIZE)
  try {
    await window.setOverlayIcon(icon)
  } finally {
    await icon.close()
  }
}

function overlayPixels(label: string): Uint8Array | null {
  const canvas = document.createElement('canvas')
  canvas.width = OVERLAY_SIZE
  canvas.height = OVERLAY_SIZE
  const context = canvas.getContext('2d')
  if (!context) return null
  const center = OVERLAY_SIZE / 2
  context.fillStyle = appBadgeColors.fill
  context.beginPath()
  context.arc(center, center, center, 0, Math.PI * 2)
  context.fill()
  context.fillStyle = appBadgeColors.text
  context.font = `700 ${label.length > 1 ? 17 : 22}px "Segoe UI", system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, center, center + 1)
  return new Uint8Array(context.getImageData(0, 0, OVERLAY_SIZE, OVERLAY_SIZE).data.buffer)
}
