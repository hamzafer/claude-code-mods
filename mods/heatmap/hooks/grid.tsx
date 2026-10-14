// The grid itself: draws the weeks and moves a day cursor with the arrow keys.
import type { ClientModule } from 'claude-code'

import { LABEL_COLUMNS, dayLabel, duration, level, thousands } from './heat'

/** One day: active minutes, sessions, top project. */
export type Cell = [number, number, string | null]

export type GridProps = {
  weeks: number
  start: string // the Monday of the first week
  cells: Cell[] // from start to today
  months: string // the month row, already laid out
  labels: string[] // one per day in order, for the detail line
  isLight: boolean // the person's theme is a light one
}

type GridText = Parameters<ClientModule<GridProps, Local>>[1]['elements']['Text']
type Local = { cursor: number; live: { props: GridProps } }

// Two sizes and a ramp of Claude orange: a level never depends on telling colors apart alone.
export const GLYPHS = ['·', '▪', '▪', '■', '■']
const RAMPS = {
  dark: ['#5c3426', '#8f4a33', '#c4613f', '#f08a63'],
  light: ['#f5c9b6', '#ec9c79', '#d97757', '#a8492b'],
}
const ROW_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', '']

const Grid: ClientModule<GridProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const last = props.cells.length - 1

  if (surface.state === undefined) {
    surface.onKey(e => {
      const now = surface.state
      if (!now) return
      const key = e.key.toLowerCase()
      if (key === 'p') return surface.post({ scope: 'toggle' })
      if (key === 'q') return surface.post({ close: true })
      const step = key === 'up' ? -1 : key === 'down' ? 1 : key === 'left' ? -7 : key === 'right' ? 7 : 0
      if (step === 0) return
      const end = now.live.props.cells.length - 1
      const cursor = Math.max(0, Math.min(end, now.cursor + step))
      if (cursor !== now.cursor) surface.setState({ ...now, cursor })
    })
    surface.setState({ cursor: last, live: { props } }) // starts on today
  }

  const local = surface.state ?? { cursor: last, live: { props } }
  local.live.props = props // the keys read the latest props
  const cursor = Math.max(0, Math.min(last, local.cursor))
  const at = props.cells[cursor]

  return (
    <Box flexDirection="column">
      <Text dimColor>{' '.repeat(LABEL_COLUMNS) + props.months}</Text>
      {ROW_LABELS.map((label, row) => (
        <Text>
          <Text dimColor>{label.padEnd(LABEL_COLUMNS)}</Text>
          {Array.from({ length: props.weeks }, (_, w) => {
            const i = w * 7 + row
            const cell = props.cells[i]
            if (!cell) return <Text>{'  '}</Text>
            const lv = level(cell[0], cell[1])
            return (
              <Text>
                {square(Text, lv, i === cursor, props.isLight)}
                {' '}
              </Text>
            )
          })}
        </Text>
      ))}
      <Text>
        <Text dimColor>{`${' '.repeat(LABEL_COLUMNS)}less `}</Text>
        {GLYPHS.map((_, lv) => (
          <Text>
            {square(Text, lv, false, props.isLight)}{' '}
          </Text>
        ))}
        <Text dimColor>more</Text>
      </Text>
      <Text> </Text>
      <Text wrap="truncate-end">{at ? detail(props.labels[cursor] ?? '', at) : ''}</Text>
      <Text dimColor wrap="truncate-end">click the grid, then ←↑↓→ move · p scope · q close · Esc</Text>
    </Box>
  )
}

export default Grid

function square(Text: GridText, level: number, isCursor: boolean, isLight: boolean) {
  const color = level === 0 ? 'subtle' : RAMPS[isLight ? 'light' : 'dark'][level - 1]!
  return (
    <Text color={color} inverse={isCursor}>
      {GLYPHS[level]}
    </Text>
  )
}

function detail(day: string, [min, s, top]: Cell) {
  if (s === 0 && min === 0) return `${dayLabel(day)} · no activity`
  const parts = [dayLabel(day), duration(min), `${thousands(s)} session${s === 1 ? '' : 's'}`]
  if (top) parts.push(`top: ${top}`)
  return parts.join(' · ')
}
