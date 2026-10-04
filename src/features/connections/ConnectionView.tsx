import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import LinkRoundedIcon from '@mui/icons-material/LinkRounded'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Divider from '@mui/material/Divider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState } from 'react'

import type { ConnectGitLabInput } from '../../lib/gitlab'
import { useAutoUpdateSafety } from '../shared/AutoUpdateSafety'
import { useConnection } from './ConnectionProvider'

export function ConnectionView({ compact = false }: { compact?: boolean }) {
  const { connect, disconnect, error, restore, session, status } = useConnection()
  const { setUnsafe: setPatUnsafe } = useAutoUpdateSafety('pat-form')
  const [url, setUrl] = useState('https://gitlab.com')
  const [token, setToken] = useState('')
  const [validation, setValidation] = useState<string | null>(null)

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

  if (session) {
    return (
      <Card component="section" aria-labelledby="gitlab-connection-title" variant="outlined">
        <CardContent sx={{ p: compact ? 2 : { md: 3, xs: 2 } }}>
          <Stack spacing={1.75}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', minWidth: 0 }}>
                <CheckCircleOutlineRoundedIcon color="success" />
                <Box sx={{ minWidth: 0 }}>
                  <Typography component="h2" id="gitlab-connection-title" variant="h2">
                    GitLab接続済み
                  </Typography>
                  <Typography color="text.secondary" noWrap variant="body2">
                    {session.instanceUrl}
                  </Typography>
                </Box>
              </Stack>
              <Button disabled={status === 'checking'} onClick={() => void disconnect()} size="small" startIcon={<LogoutRoundedIcon />}>
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
        </CardContent>
      </Card>
    )
  }

  return (
    <Card component="section" aria-labelledby="gitlab-connection-title" variant="outlined">
      <CardContent sx={{ p: compact ? 2 : { md: 3, xs: 2 } }}>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
            <LinkRoundedIcon color="primary" sx={{ mt: 0.25 }} />
            <Box>
              <Typography component="h2" id="gitlab-connection-title" variant="h2">
                GitLabに接続
              </Typography>
              <Typography color="text.secondary" variant="body2">
                GitLab.comとSelf-Managedのどちらも、接続先URLとPersonal Access Tokenで接続できます。
              </Typography>
            </Box>
          </Stack>
          <Alert icon={<LockOutlinedIcon fontSize="small" />} severity="info" sx={{ fontSize: 'body2.fontSize' }}>
            トークンは接続時だけ入力し、Windows資格情報ストアへ保存します。フロントエンドには永続保存しません。
          </Alert>
          {status === 'unsupported' ? (
            <Alert severity="warning">ブラウザプレビューでは接続できません。デスクトップ版を起動してください。</Alert>
          ) : null}
          {validation ? <Alert onClose={() => setValidation(null)} severity="warning">{validation}</Alert> : null}
          {error ? <ConnectionError error={error.message} /> : null}
          <Stack spacing={1.5}>
            <TextField
              fullWidth
              helperText="例: https://gitlab.example.com または https://gitlab.com"
              label="GitLab URL"
              onChange={(event) => setUrl(event.target.value)}
              value={url}
            />
            <TextField
              fullWidth
              autoComplete="off"
              helperText="apiスコープを持つトークンを推奨します。入力値は接続完了後に破棄します。"
              label="Personal Access Token"
              onChange={(event) => { setToken(event.target.value); setPatUnsafe(Boolean(event.target.value)) }}
              type="password"
              value={token}
            />
            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
              <Button disabled={status === 'checking'} onClick={() => void restore()} startIcon={<RefreshRoundedIcon />} variant="text">
                保存済み接続を確認
              </Button>
              <Button disabled={status === 'checking' || status === 'unsupported'} onClick={() => void handleSubmit()} startIcon={<LinkRoundedIcon />} variant="contained">
                {status === 'checking' ? '接続中…' : '接続する'}
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
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
