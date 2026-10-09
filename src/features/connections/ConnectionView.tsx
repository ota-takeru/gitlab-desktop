import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
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

import { listGlabConnections, type ConnectGitLabInput } from '../../lib/gitlab'
import { useAutoUpdateSafety } from '../shared/AutoUpdateSafety'
import { useConnection } from './ConnectionProvider'

export function ConnectionView({ compact = false }: { compact?: boolean }) {
  const { connect, connectFromGlab, disconnect, error, restore, session, status } = useConnection()
  const { setUnsafe: setPatUnsafe } = useAutoUpdateSafety('pat-form')
  const [url, setUrl] = useState('https://gitlab.com')
  const [token, setToken] = useState('')
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
    const normalizedUrl = url.trim().replace(/\/$/u, '')
    if (!isHttpsUrl(normalizedUrl)) {
      setValidation('GitLab URLはhttps://から始めてください。')
      return
    }
    if (!token.trim()) {
      setValidation('Personal Access Tokenを入力してください。')
      return
    }
    setValidation(null)
    const input: ConnectGitLabInput = { token: token.trim(), url: normalizedUrl }
    try {
      await connect(input)
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
      else if (safeTargets.length === 0) setGlabListError('HTTPS形式の接続先を読み取れませんでした。glabの設定を確認するか、下のPATフォームをお使いください。')
    } catch {
      setGlabListError('glabの保存済み接続先を読み取れませんでした。設定を確認するか、下のPATフォームをお使いください。')
    } finally {
      setGlabListLoading(false)
    }
  }

  const handleGlabConnect = async () => {
    if (!glabTargets.includes(selectedGlabTarget) || !isSafeGlabUrl(selectedGlabTarget)) {
      setGlabListError('glabの保存済み接続先を選択してください。')
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

  const handleDisconnect = () => {
    if (globalThis.confirm('切断すると、GitLabの資格情報、キャッシュ、この端末に保存された未送信コメント、結果未確認の投稿記録が削除されます。切断しますか？')) void disconnect()
  }

  if (session) {
    return (
      <Box component="section" aria-labelledby="gitlab-connection-title">
        <Box sx={{ p: compact ? 2 : 0 }}>
          <Stack spacing={1.75}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                <CheckCircleOutlineRoundedIcon color="success" />
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="h3" id="gitlab-connection-title" sx={{ fontWeight: 600 }} variant="body1">
                    GitLab接続済み
                  </Typography>
                  <Typography color="text.secondary" noWrap variant="body2">
                    {session.instanceUrl}
                  </Typography>
                </Box>
              </Stack>
              <Button color="error" disabled={status === 'checking'} onClick={handleDisconnect} startIcon={<LogoutRoundedIcon />} variant="outlined">
                切断
              </Button>
            </Stack>
            <Divider />
            <Stack direction={{ md: 'row', xs: 'column' }} spacing={2}>
              <ConnectionValue label="ユーザー" value={`@${session.user.username}`} />
              <ConnectionValue label="表示名" value={session.user.name} />
              <ConnectionValue label="GitLabバージョン" value={session.serverVersion ?? '取得できませんでした'} />
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
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
            <LinkRoundedIcon color="primary" sx={{ mt: 0.25 }} />
            <Box>
              <Typography component="h3" id="gitlab-connection-title" sx={{ fontWeight: 600 }} variant="body1">
                GitLabに接続
              </Typography>
              <Typography color="text.secondary" variant="body2">
                接続先を選び、レビューを始めましょう。
              </Typography>
            </Box>
          </Stack>
          {status === 'unsupported' ? (
            <Alert severity="warning">ブラウザプレビューでは接続できません。デスクトップ版を起動してください。</Alert>
          ) : null}
          {validation ? <Alert onClose={() => setValidation(null)} severity="warning">{validation}</Alert> : null}
          {error && !glabDialogOpen ? <ConnectionError error={error.message} /> : null}
          <Stack spacing={1.5}>
            <Button
              disabled={status === 'checking' || status === 'unsupported' || glabListLoading || glabConnecting}
              onClick={() => void handleOpenGlabDialog()}
              startIcon={<LinkRoundedIcon />}
              variant="outlined"
              sx={{ alignSelf: 'flex-start' }}
            >
              {glabListLoading ? '接続先を確認中…' : 'glabの認証情報で接続'}
            </Button>
            <Typography color="text.secondary" variant="caption">glabに保存された接続先から選び、接続を開始します。</Typography>
            <Divider />
            <Typography sx={{ fontWeight: 600 }} variant="body2">アクセストークンで接続</Typography>
            <TextField
              fullWidth
              helperText="GitLab.com または社内GitLabの HTTPS URL"
              label="GitLab URL"
              onChange={(event) => setUrl(event.target.value)}
              value={url}
            />
            <TextField
              fullWidth
              autoComplete="off"
              helperText="閲覧は read_api、コメントや承認には api スコープが必要です。"
              label="Personal Access Token"
              onChange={(event) => { setToken(event.target.value); setPatUnsafe(Boolean(event.target.value)) }}
              type="password"
              value={token}
            />
            <Typography color="text.secondary" variant="caption">認証情報はWindows資格情報ストアに保存されます。</Typography>
            <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button disabled={status === 'checking'} onClick={() => void restore()} startIcon={<RefreshRoundedIcon />} variant="text">
                保存済み接続を確認
              </Button>
              <Button disabled={status === 'checking' || status === 'unsupported'} onClick={() => void handleSubmit()} startIcon={<LinkRoundedIcon />} variant="contained">
                {status === 'checking' ? '接続中…' : '接続する'}
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
        <DialogTitle id="glab-connections-title">glabに保存された接続先</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <Typography color="text.secondary" variant="body2">選択した接続先の保存済み認証で接続します。</Typography>
            {glabListLoading ? <Typography aria-live="polite" color="text.secondary" role="status" variant="body2">glabの設定を確認しています…</Typography> : null}
            {glabNoConnections ? <Alert severity="info">glabに保存済みの接続先がありません。glabでログインするか、下のPATフォームから接続してください。</Alert> : null}
            {glabListError ? <Alert severity="warning">{glabListError}</Alert> : null}
            {glabTargets.length > 0 ? <RadioGroup
              aria-label="glabでログイン済みのGitLab接続先"
              onChange={(event) => setSelectedGlabTarget(event.target.value)}
              value={selectedGlabTarget}
            >
              {glabTargets.map((target) => <FormControlLabel control={<Radio disabled={glabConnecting} />} key={target} label={<Typography sx={{ overflowWrap: 'anywhere' }} variant="body2">{target}</Typography>} value={target} />)}
            </RadioGroup> : null}
            {glabConnectAttempted && error ? <ConnectionError error={error.message} /> : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={glabConnecting} onClick={() => setGlabDialogOpen(false)} variant="text">キャンセル</Button>
          <Button
            disabled={!selectedGlabTarget || glabListLoading || glabConnecting || status === 'checking'}
            onClick={() => void handleGlabConnect()}
            variant="contained"
          >
            {glabConnecting ? '接続中…' : 'この接続先に接続'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

function ConnectionValue({ label, value }: { label: string; value: string }) {
  return (
    <Stack spacing={0.25} sx={{ minWidth: 140 }}>
      <Typography color="text.secondary" variant="caption">{label}</Typography>
      <Typography noWrap variant="body2">{value}</Typography>
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
