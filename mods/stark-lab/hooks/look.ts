// The look the mod sets once per session: the Desktop colors and the backdrop scene.

import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// The scene name the Backdrop hook answers to.
export const SCENE_NAME = 'stark-lab'

// Blue-black surfaces and a hologram-cyan accent; gold stays in the scene's core.
// Dark only: it's a workshop at night.
const { theme, problems } = makeColors({
  label: 'Stark lab',
  only: 'dark',
  roles: { accent: '#5fd4f4', danger: '#d0483e', success: '#4fae7f', warning: '#e8a93a', pro: '#8b7fd6' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#070a10',
        'surface-1': '#0c1118',
        'surface-2': '#111821',
        'surface-3': '#161e29',
        'text-primary': '#e6eef4',
        'text-secondary': '#bccad6',
        'text-muted': '#91a2b2',
      },
    },
  },
})

// The one kind of color problem that stops Desktop painting the theme at all.
export const UNPAINTABLE = problems.find(line => line.startsWith("Desktop won't paint"))

export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 18, tint: '#070a10', opacity: 0.62 } },
  overrideColorScheme: 'dark',
}
