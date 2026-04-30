import { createTheme } from '@mantine/core'

import components from './overrides'

export const theme = createTheme({
    components,
    cursorType: 'pointer',
    fontFamily:
        'Inter, Vazirmatn, Apple Color Emoji, Noto Sans SC, Twemoji Country Flags, sans-serif',
    fontFamilyMonospace: 'Fira Mono, monospace',
    breakpoints: {
        xs: '25em',
        sm: '30em',
        md: '48em',
        lg: '64em',
        xl: '80em',
        '2xl': '96em',
        '3xl': '120em',
        '4xl': '160em'
    },
    scale: 1,
    fontSmoothing: true,
    focusRing: 'never',
    white: '#fcfcfd',
    black: '#171420',
    colors: {
        dark: [
            '#fcfcfd',
            '#efedf7',
            '#bbb7ce',
            '#8d879e',
            '#625b75',
            '#433d57',
            '#332d45',
            '#282337',
            '#171420',
            '#100e18'
        ],
        violet: [
            '#f2eeff',
            '#e0d7ff',
            '#c2b0ff',
            '#9f82ff',
            '#7047eb',
            '#603bd6',
            '#4f31b5',
            '#412895',
            '#332174',
            '#251852'
        ],
        cyan: [
            '#e3fbff',
            '#c2f5ff',
            '#87e9f9',
            '#4fd9ef',
            '#22cfe5',
            '#12abc2',
            '#0d899c',
            '#0e6d7d',
            '#115766',
            '#0d3c47'
        ],

        blue: [
            '#ddf4ff',
            '#b6e3ff',
            '#80ccff',
            '#54aeff',
            '#218bff',
            '#0969da',
            '#0550ae',
            '#033d8b',
            '#0a3069',
            '#002155'
        ],
        green: [
            '#dafbe1',
            '#aceebb',
            '#6fdd8b',
            '#4ac26b',
            '#2da44e',
            '#1a7f37',
            '#116329',
            '#044f1e',
            '#003d16',
            '#002d11'
        ],
        yellow: [
            '#fff8c5',
            '#fae17d',
            '#eac54f',
            '#d4a72c',
            '#bf8700',
            '#9a6700',
            '#7d4e00',
            '#633c01',
            '#4d2d00',
            '#3b2300'
        ],
        orange: [
            '#fff1e5',
            '#ffd8b5',
            '#ffb77c',
            '#fb8f44',
            '#e16f24',
            '#bc4c00',
            '#953800',
            '#762c00',
            '#5c2200',
            '#471700'
        ]
    },
    primaryShade: 4,
    primaryColor: 'violet',
    autoContrast: true,
    luminanceThreshold: 0.3,
    defaultGradient: {
        from: 'violet.4',
        to: 'cyan.4',
        deg: 135
    },
    headings: {
        fontFamily: 'Inter, Vazirmatn, Apple Color Emoji, Noto Sans SC, sans-serif',
        fontWeight: '600'
    },
    defaultRadius: 'md'
})
