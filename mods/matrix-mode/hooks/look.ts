// The look the mod sets once per session: the Desktop colors and the backdrop scene.

import type { ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// The scene name the Backdrop hook answers to.
export const SCENE_NAME = 'matrix-mode'

// Green-black surfaces, a phosphor-green accent. Dark only: it's a terminal at night.
// Success leans lime so it reads apart from the accent.
const { theme, problems } = makeColors({
  label: 'Matrix mode',
  only: 'dark',
  roles: { accent: '#3ddc6e', danger: '#d4504a', success: '#a3c93a', warning: '#e3a52e', pro: '#8b7fd6' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#050a07',
        'surface-1': '#09100b',
        'surface-2': '#0d1610',
        'surface-3': '#121c15',
        'text-primary': '#e3f2e6',
        'text-secondary': '#b5cbb9',
        'text-muted': '#8ba692',
      },
    },
  },
})

// The one kind of color problem that stops Desktop painting the theme at all.
export const UNPAINTABLE = problems.find(line => line.startsWith("Desktop won't paint"))

export const LOOK: ThemeSetArgs = {
  colors: theme,
  backdrop: { scene: SCENE_NAME, glass: { blur: 18, tint: '#030805', opacity: 0.62 } },
  overrideColorScheme: 'dark',
}
