import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import KeyRoundedIcon from '@mui/icons-material/KeyRounded'
import LaunchRoundedIcon from '@mui/icons-material/LaunchRounded'
import LoginRoundedIcon from '@mui/icons-material/LoginRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import { useConfirm } from '../../components/feedbackContext'
import { alignTop, firstLine } from '../../components/rows'
import { listGlabConnections, normalizeGitLabError, openTokenCreationPage, type ConnectGitLabInput } from '../../lib/gitlab'
import { useT } from '../../i18n/useT'
import { useAutoUpdateSafety } from '../shared/autoUpdateSafetyContext'
import { useConnection } from './connectionContext'
import { normalizeInstanceInput, readLastInstanceUrl, sameInstance } from './lastInstance'

export function ConnectionView({ compact = false }: { compact?: boolean }) {
  const { connect, connectFromGlab, disconnect, error, reauthRequired, refreshToken, restore, restoreFailed, session, status } = useConnection()
  const confirm = useConfirm()
  const t = useT()
  const { setUnsafe: setPatUnsafe } = useAutoUpdateSafety('pat-form')
  const [url, setUrl] = useState(() => reauthRequired?.instanceUrl ?? readLastInstanceUrl() ?? 'https://gitlab.com')
  const [token, setToken] = useState('')
  const [tokenFormOpen, setTokenFormOpen] = useState(false)
  const [tokenLinkStatus, setTokenLinkStatus] = useState<string | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const [glabDialogOpen, setGlabDialogOpen] = useState(false)
  const [glabTargets, setGlabTargets] = useState<string[]>([])
  const [selectedGlabTarget, setSelectedGlabTarget] = useState('')
  const [glabListLoading, setGlabListLoading] = useState(false)
  const [glabConnecting, setGlabConnecting] = useState(false)
  const [glabListError, setGlabListError] = useState<string | null>(null)
  const [glabNoConnections, setGlabNoConnections] = useState(false)
  const [glabConnectAttempted, setGlabConnectAttempted] = useState(false)

  const handleSubmit = async () => {
    const normalizedUrl = normalizeInstanceInput(url)
    if (!isHttpsUrl(normalizedUrl)) {
      setValidation(t('connection.connect.urlInvalid'))
      return
    }
    if (!token.trim()) {
      setValidation(t('connection.token.required'))
      return
    }
    setValidation(null)
    const input: ConnectGitLabInput = { token: token.trim(), url: normalizedUrl }
    try {
      // The expired account's own instance reconnects in place, keeping its unsent input.
      if (reauthRequired && sameInstance(normalizedUrl, reauthRequired.instanceUrl)) await refreshToken(input.token)
      else await connect(input)
    } finally {
      // The PAT is only a transient form value. Clear it regardless of the
      // result so failures cannot leave a secret in the DOM longer than needed.
      setToken('')
      setPatUnsafe(false)
    }
  }

  const handleOpenGlabDialog = async () => {
    setValidation(null)
    setGlabDialogOpen(true)
    setGlabTargets([])
    setSelectedGlabTarget('')
    setGlabListError(null)
    setGlabNoConnections(false)
    setGlabConnectAttempted(false)
    setGlabListLoading(true)
    try {
      const savedUrls = await listGlabConnections()
      const safeTargets = Array.from(new Set(savedUrls.filter(isSafeGlabUrl)))
      setGlabTargets(safeTargets)
      if (safeTargets.length === 1) setSelectedGlabTarget(safeTargets[0])
      if (savedUrls.length === 0) setGlabNoConnections(true)
      else if (safeTargets.length === 0) setGlabListError(t('connection.glab.noHttps'))
    } catch {
      setGlabListError(t('connection.glab.readFailed'))
    } finally {
      setGlabListLoading(false)
    }
  }

  const handleGlabConnect = async () => {
    if (!glabTargets.includes(selectedGlabTarget) || !isSafeGlabUrl(selectedGlabTarget)) {
      setGlabListError(t('connection.glab.selectRequired'))
      return
    }
    setValidation(null)
    setGlabConnectAttempted(true)
    setGlabConnecting(true)
    try {
      const connected = await connectFromGlab(selectedGlabTarget)
      if (connected) setGlabDialogOpen(false)
    } finally {
      // Keep the manual PAT transient even when the glab lookup fails. This
      // also removes the unsafe-update guard if the user entered a PAT first.
      setToken('')
      setPatUnsafe(false)
      setGlabConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      confirmLabel: t('connection.disconnect.confirm'),
      destructive: true,
      message: t('connection.disconnect.message'),
      title: t('connection.disconnect.title'),
    })
    if (confirmed) void disconnect()
  }

  const handleTokenRefresh = async () => {
    if (!token.trim()) {
      setValidation(t('connection.token.required'))
      return
    }
    setValidation(null)
    try {
      if (await refreshToken(token.trim())) setTokenFormOpen(false)
    } finally {
      setToken('')
      setPatUnsafe(false)
    }
  }

  // GitLab's own page for a new token, also before connecting. Rust validates
  // the instance like a connection URL and opens only that page.
  const openTokenPage = async (instanceUrl: string) => {
    const normalized = normalizeInstanceInput(instanceUrl)
    if (!isHttpsUrl(normalized)) {
      setTokenLinkStatus(t('connection.token.urlFirst'))
      return
    }
    try {
      await openTokenCreationPage(normalized)
      setTokenLinkStatus(null)
    } catch (error) {
      setTokenLinkStatus(normalizeGitLabError(error).message)
    }
  }
  const tokenPageLink = (instanceUrl: string) => <>
    <Button onClick={() => void openTokenPage(instanceUrl)} size="small" startIcon={<LaunchRoundedIcon />} sx={{ alignSelf: 'flex-start' }} variant="text">{t('connection.token.create')}</Button>
    {tokenLinkStatus ? <Typography color="textSecondary" role="status" sx={{ overflowWrap: 'anywhere' }} variant="caption">{tokenLinkStatus}</Typography> : null}
  </>

  if (session) {
    return (
      <Box component="section" aria-labelledby="gitlab-connection-title">
        <Box sx={{ p: compact ? 2 : 0 }}>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} sx={{ ...alignTop, justifyContent: 'space-between' }}>
              <Stack direction="row" spacing={1} sx={{ ...alignTop, minWidth: 0 }}>
                <Box sx={firstLine(6)}><CheckCircleOutlineRoundedIcon color="success" /></Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="h3" id="gitlab-connection-title" sx={{ fontWeight: 600 }} variant="body1">
                    {t('connection.connected.title')}
                  </Typography>
                  <Typography color="textSecondary" noWrap title={session.instanceUrl} variant="body2">
                    {session.instanceUrl}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="row" spacing={1} sx={firstLine(6)}>
                <Button disabled={status === 'checking' || tokenFormOpen} onClick={() => { setValidation(null); setTokenFormOpen(true) }} startIcon={<KeyRoundedIcon />} variant="outlined">
                  {t('connection.token.update')}
                </Button>
                <Button color="error" disabled={status === 'checking'} onClick={() => void handleDisconnect()} startIcon={<LogoutRoundedIcon />} variant="outlined">
                  {t('connection.disconnect.button')}
                </Button>
              </Stack>
            </Stack>
            {tokenFormOpen ? <Stack component="form" noValidate onSubmit={(event) => { event.preventDefault(); void handleTokenRefresh() }} spacing={1.5}>
              <Typography color="textSecondary" variant="body2">{t('connection.token.updateDescription', { username: session.user.username })}</Typography>
              {validation ? <Alert onClose={() => setValidation(null)} severity="warning">{validation}</Alert> : null}
              <TextField
                autoComplete="off"
                autoFocus
                fullWidth
                helperText={t('connection.token.scopeHint')}
                label={t('connection.token.newLabel')}
                onChange={(event) => { setToken(event.target.value); setPatUnsafe(Boolean(event.target.value)) }}
                type="password"
                value={token}
              />
              {tokenPageLink(session.instanceUrl)}
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                <Button disabled={status === 'checking'} onClick={() => { setToken(''); setPatUnsafe(false); setValidation(null); setTokenFormOpen(false) }} variant="text">{t('connection.cancel')}</Button>
                <Button disabled={status === 'checking'} type="submit" variant="contained">{status === 'checking' ? t('connection.token.updating') : t('connection.token.update')}</Button>
              </Stack>
            </Stack> : null}
            <Divider />
            <Stack direction={{ md: 'row', xs: 'column' }} spacing={2}>
              <ConnectionValue label={t('connection.connected.user')} value={`@${session.user.username}`} />
              <ConnectionValue label={t('connection.connected.name')} value={session.user.name} />
              <ConnectionValue label={t('connection.connected.version')} value={session.serverVersion ?? t('connection.connected.versionUnavailable')} />
            </Stack>
            {error ? <ConnectionError error={error.message} /> : null}
          </Stack>
        </Box>
      </Box>
    )
  }

  return (
    <Box component="section" aria-labelledby="gitlab-connection-title">
      <Box sx={{ p: compact ? 2 : 0 }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={alignTop}>
            <Box sx={firstLine(6)}><LoginRoundedIcon color="primary" /></Box>
            <Box>
              <Typography component="h3" id="gitlab-connection-title" sx={{ fontWeight: 600 }} variant="body1">
                {reauthRequired ? t('connection.reauth.title') : t('connection.connect.title')}
              </Typography>
              <Typography color="textSecondary" variant="body2">
                {reauthRequired
                  ? reauthRequired.username ? t('connection.reauth.descriptionUser', { username: reauthRequired.username }) : t('connection.reauth.descriptionSaved')
                  : t('connection.connect.description')}
              </Typography>
            </Box>
          </Stack>
          {status === 'unsupported' ? (
            <Alert severity="warning">{t('connection.connect.unsupported')}</Alert>
          ) : null}
          {validation ? <Alert onClose={() => setValidation(null)} severity="warning">{validation}</Alert> : null}
          {error && !glabDialogOpen ? <ConnectionError error={error.message} /> : null}
          <Stack component="form" noValidate onSubmit={(event) => { event.preventDefault(); void handleSubmit() }} spacing={1.5}>
            <Button
              disabled={status === 'checking' || status === 'unsupported' || glabListLoading || glabConnecting}
              onClick={() => void handleOpenGlabDialog()}
              startIcon={<LoginRoundedIcon />}
              variant="outlined"
              sx={{ alignSelf: 'flex-start' }}
            >
              {glabListLoading ? t('connection.glab.checking') : t('connection.glab.connect')}
            </Button>
            <Typography color="textSecondary" variant="caption">{t('connection.glab.hint')}</Typography>
            <Divider />
            <Typography sx={{ fontWeight: 600 }} variant="body2">{t('connection.connect.withToken')}</Typography>
            <TextField
              fullWidth
              helperText={t('connection.connect.urlHint')}
              label={t('connection.connect.urlLabel')}
              onChange={(event) => setUrl(event.target.value)}
              value={url}
            />
            <TextField
              fullWidth
              autoComplete="off"
              helperText={t('connection.token.scopeHint')}
              label={t('connection.token.label')}
              onChange={(event) => { setToken(event.target.value); setPatUnsafe(Boolean(event.target.value)) }}
              type="password"
              value={token}
            />
            {tokenPageLink(url)}
            <Typography color="textSecondary" variant="caption">{t('connection.connect.storage')}</Typography>
            <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1} sx={{ justifyContent: 'flex-end' }}>
              {/* Only a failed restore can succeed on retry; without a saved connection there is nothing to restore. */}
              {restoreFailed ? <Button disabled={status === 'checking'} onClick={() => void restore()} startIcon={<RefreshRoundedIcon />} variant="text">
                {t('connection.connect.retryRestore')}
              </Button> : null}
              <Button disabled={status === 'checking' || status === 'unsupported'} startIcon={<LoginRoundedIcon />} type="submit" variant="contained">
                {status === 'checking' ? t('connection.connect.connecting') : t('connection.connect.submit')}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Box>
      <Dialog
        aria-labelledby="glab-connections-title"
        fullWidth
        maxWidth="sm"
        onClose={() => { if (!glabConnecting) setGlabDialogOpen(false) }}
        open={glabDialogOpen}
      >
        <DialogTitle id="glab-connections-title">{t('connection.glab.dialogTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography color="textSecondary" variant="body2">{t('connection.glab.dialogDescription')}</Typography>
            {glabListLoading ? <Typography aria-live="polite" color="textSecondary" role="status" variant="body2">{t('connection.glab.loading')}</Typography> : null}
            {glabNoConnections ? <Alert severity="info">{t('connection.glab.none')}</Alert> : null}
            {glabListError ? <Alert severity="warning">{glabListError}</Alert> : null}
            {glabTargets.length > 0 ? <RadioGroup
              aria-label={t('connection.glab.targetsLabel')}
              onChange={(event) => setSelectedGlabTarget(event.target.value)}
              value={selectedGlabTarget}
            >
              {glabTargets.map((target) => <FormControlLabel control={<Radio disabled={glabConnecting} />} key={target} label={<Typography sx={{ overflowWrap: 'anywhere' }} variant="body2">{target}</Typography>} value={target} />)}
            </RadioGroup> : null}
            {glabConnectAttempted && error ? <ConnectionError error={error.message} /> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={glabConnecting} onClick={() => setGlabDialogOpen(false)} variant="text">{t('connection.cancel')}</Button>
          <Button
            disabled={!selectedGlabTarget || glabListLoading || glabConnecting || status === 'checking'}
            onClick={() => void handleGlabConnect()}
            variant="contained"
          >
            {glabConnecting ? t('connection.connect.connecting') : t('connection.glab.connectTarget')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function ConnectionValue({ label, value }: { label: string; value: string }) {
  return (
    <Stack sx={{ minWidth: 140 }}>
      <Typography color="textSecondary" variant="caption">{label}</Typography>
      <Typography noWrap title={value} variant="body2">{value}</Typography>
    </Stack>
  )
}

function ConnectionError({ error }: { error: string }) {
  return <Alert severity="error">{error}</Alert>
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isSafeGlabUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
  } catch {
    return false
  }
}
