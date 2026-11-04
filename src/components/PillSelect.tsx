import Select, { type SelectProps } from '@mui/material/Select'

const pillSelectSx = { bgcolor: 'transparent', typography: 'body2', '& .MuiSelect-icon': { fontSize: 18 } } as const

/** A pull-down that sits on a pane's own surface beside switches and chips, such as a list's order. */
export function PillSelect<Value>(props: SelectProps<Value>) {
  return <Select<Value> sx={pillSelectSx} {...props} />
}
