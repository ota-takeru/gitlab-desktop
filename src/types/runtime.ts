export interface RuntimeInfo {
  appVersion: string
  os: string
  arch: string
}

export type HealthStatus = 'idle' | 'pending' | 'success' | 'error'

export interface RuntimeHealthState {
  status: HealthStatus
  info?: RuntimeInfo
  message?: string
}
