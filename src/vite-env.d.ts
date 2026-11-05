/// <reference types="vite/client" />

declare global {
  interface ImportMetaEnv {
    /** The release build's notes, written by `scripts/release-notes.mjs`. */
    readonly VITE_RELEASE_NOTES?: string
  }

  interface Window {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }
}

export {}
