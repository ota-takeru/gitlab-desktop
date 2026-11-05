import { initializeLocale } from './i18n'

/**
 * Imported first by main.tsx, so the language files load while the rest of the
 * app's modules evaluate. The app opens even if no language could load.
 */
export const localeReady = initializeLocale().catch(() => undefined)
