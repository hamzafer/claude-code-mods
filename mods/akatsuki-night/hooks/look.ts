// The look the mod sets once per session: the Desktop colors and the backdrop scene.

import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// The scene name the Backdrop hook answers to.
export const SCENE_NAME = 'akatsuki-night'

// Near-black surfaces warmed toward red-brown, a crimson accent. Dark only: it's a blood-moon night.
const { theme, problems } = makeColors({
  label: 'Akatsuki night',
  only: 'dark',
  roles: { accent: '#c8262c', danger: '#e2583e', success: '#6b9a5c', warning: '#e0a13a', pro: '#8d6ab5' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#0d0909',
        'surface-1': '#130d0d',
        'surface-2': '#191212',
        'surface-3': '#1f1616',
        'text-primary': '#efe5e1',
        'text-secondary': '#c8bab4',
        'text-muted': '#a0908a',
      },
    },
  },
})

// The one kind of color problem that stops Desktop painting the theme at all.
export const UNPAINTABLE = problems.find(line => line.startsWith("Desktop won't paint"))

export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 18, tint: '#0d0909', opacity: 0.62 } },
  overrideColorScheme: 'dark',
}
