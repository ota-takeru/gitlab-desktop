import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Paper
      component="section"
      variant="outlined"
      sx={{
        alignItems: 'center',
        display: 'flex',
        justifyContent: 'center',
        minHeight: 280,
        p: { xs: 4, md: 7 },
        textAlign: 'center',
      }}
    >
      <Stack spacing={2} sx={{ alignItems: 'center', maxWidth: 480 }}>
        <Box
          sx={{
            alignItems: 'center',
            bgcolor: 'action.hover',
            borderRadius: '50%',
            color: 'text.secondary',
            display: 'flex',
            height: 56,
            justifyContent: 'center',
            width: 56,
          }}
        >
          <InboxOutlinedIcon />
        </Box>
        <Typography component="h2" variant="h2">
          {title}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {description}
        </Typography>
        {action}
      </Stack>
    </Paper>
  )
}
