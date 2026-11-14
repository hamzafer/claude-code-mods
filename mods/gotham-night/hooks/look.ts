// The look the mod sets once per session: the Desktop colors and the backdrop scene.

import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// The scene name the Backdrop hook answers to.
export const SCENE_NAME = 'gotham-night'

// Night-black surfaces, a signal-yellow accent. Dark only: it's a night city.
const { theme, problems } = makeColors({
  label: 'Gotham night',
  only: 'dark',
  roles: { accent: '#f2c230', danger: '#c8473a', success: '#5f9a5a', warning: '#e09a1c', pro: '#7f6bc0' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0a0c10',
        'surface-1': '#101318',
        'surface-2': '#161a20',
        'surface-3': '#1c2028',
        'text-primary': '#ebe8e0',
        'text-secondary': '#c2beb3',
        'text-muted': '#9a968c',
      },
    },
  },
})

// The one kind of color problem that stops Desktop painting the theme at all.
export const UNPAINTABLE = problems.find(line => line.startsWith("Desktop won't paint"))

export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 18, tint: '#0a0c10', opacity: 0.62 } },
  overrideColorScheme: 'dark',
}
