import { createContext, useContext, type ReactNode } from 'react'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  /** Names what happens, e.g. 「破棄する」. Never just 「OK」. */
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
}

/** A confirmation with a second way forward, such as 「保存せずに終了」 beside 「保存して終了」. */
export interface ChoiceOptions extends ConfirmOptions {
  alternativeLabel: string
}

export type Choice = 'confirm' | 'alternative' | 'cancel'

export interface NotifyOptions {
  message: string
  severity?: 'success' | 'info' | 'warning' | 'error'
  actionLabel?: string
  onAction?: () => void
  /** A milestone such as an approval, a merge or a published review: the notice is filled and its mark pops in. */
  celebrate?: boolean
}

export interface Feedback {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  choose: (options: ChoiceOptions) => Promise<Choice>
  notify: (options: NotifyOptions) => void
}

/**
 * Without the provider (isolated component tests) confirmations fall back to the
 * browser dialog and notices are dropped, so components never depend on it being mounted.
 */
const fallback: Feedback = {
  confirm: async ({ message, title }) => globalThis.confirm(typeof message === 'string' ? `${title}\n${message}` : title),
  // The browser's dialog has two buttons, so the alternative is not offered there.
  choose: async ({ message, title }) => globalThis.confirm(typeof message === 'string' ? `${title}\n${message}` : title) ? 'confirm' : 'cancel',
  notify: () => undefined,
}

export const FeedbackContext = createContext<Feedback>(fallback)

export function useConfirm() { return useContext(FeedbackContext).confirm }
export function useChoose() { return useContext(FeedbackContext).choose }
export function useNotify() { return useContext(FeedbackContext).notify }
