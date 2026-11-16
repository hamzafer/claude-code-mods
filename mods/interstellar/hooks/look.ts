// The look the mod sets once per session: the Desktop colors and the backdrop scene.

import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// The scene name the Backdrop hook answers to.
export const SCENE_NAME = 'interstellar'

// Deep-space black with a faint warm tint, and the amber gold of an accretion disc as the
// accent. Dark only: it's deep space.
const { theme, problems } = makeColors({
  label: 'Interstellar',
  only: 'dark',
  roles: { accent: '#e8a23c', danger: '#cc4a3c', success: '#62a070', warning: '#d9b040', pro: '#7f8fd0' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#09080a',
        'surface-1': '#0f0e0f',
        'surface-2': '#151314',
        'surface-3': '#1b1919',
        'text-primary': '#ede7dc',
        'text-secondary': '#c6beb1',
        'text-muted': '#9d968a',
      },
    },
  },
})

// The one kind of color problem that stops Desktop painting the theme at all.
export const UNPAINTABLE = problems.find(line => line.startsWith("Desktop won't paint"))

export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 18, tint: '#09080a', opacity: 0.6 } },
  overrideColorScheme: 'dark',
}
