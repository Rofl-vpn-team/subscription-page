// import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator'
// import { visualizer } from 'rollup-plugin-visualizer'
// import deadFile from 'vite-plugin-deadfile'
import { createReadStream, existsSync } from 'node:fs'
import removeConsole from 'vite-plugin-remove-console'
import webfontDownload from 'vite-plugin-webfont-dl'
import { defineConfig, type Plugin } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { ViteEjsPlugin } from 'vite-plugin-ejs'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react-swc'
import path from 'node:path'
import 'dotenv/config'

/**
 * In production, `.app-config-v2.json` is generated (often gitignored). Local dev only has
 * `public/assets/app-config.json`, so the fetch would miss static files and the SPA would
 * return `index.html` (invalid JSON). Map the v2 URL to the sample config in dev.
 */
function devAppConfigV2FromSample(): Plugin {
    return {
        name: 'dev-app-config-v2-from-sample',
        apply: 'serve',
        enforce: 'pre',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const pathname = (req.url ?? '').split('?')[0] ?? ''
                if (pathname !== '/assets/.app-config-v2.json') {
                    next()
                    return
                }
                const source = path.join(server.config.publicDir, 'assets', 'app-config.json')
                if (!existsSync(source)) {
                    next()
                    return
                }
                res.setHeader('Content-Type', 'application/json; charset=utf-8')
                createReadStream(source)
                    .on('error', next)
                    .pipe(res)
            })
        }
    }
}

export default defineConfig({
    plugins: [
        devAppConfigV2FromSample(),
        react(),
        tsconfigPaths(),
        removeConsole(),
        webfontDownload(undefined, {}),
        ViteEjsPlugin((viteConfig) => {
            if (process.env.NODE_ENV === 'production') {
                return {
                    root: viteConfig.root,
                    panelData: '<%- panelData %>',
                    metaDescription: '<%= metaDescription %>',
                    metaTitle: '<%= metaTitle %>'
                }
            }
            return {
                root: viteConfig.root,
                panelData: process.env.PANEL_DATA,
                metaDescription: process.env.META_DESCRIPTION,
                metaTitle: process.env.META_TITLE
            }
        })
        // obfuscatorPlugin({
        //     exclude: [/node_modules/, /app.tsx/],
        //     apply: 'build',
        //     debugger: false,
        //     options: {
        //         compact: true,
        //         controlFlowFlattening: false,
        //         deadCodeInjection: false,
        //         debugProtection: true,
        //         debugProtectionInterval: 0,
        //         domainLock: [],
        //         disableConsoleOutput: true,
        //         identifierNamesGenerator: 'hexadecimal',
        //         log: false,
        //         numbersToExpressions: false,
        //         renameGlobals: false,
        //         selfDefending: false,
        //         simplify: true,
        //         splitStrings: false,
        //         stringArray: true,
        //         stringArrayCallsTransform: false,
        //         stringArrayCallsTransformThreshold: 0.5,
        //         stringArrayEncoding: [],
        //         stringArrayIndexShift: true,
        //         stringArrayRotate: true,
        //         stringArrayShuffle: true,
        //         stringArrayWrappersCount: 1,
        //         stringArrayWrappersChainedCalls: true,
        //         stringArrayWrappersParametersMaxCount: 2,
        //         stringArrayWrappersType: 'variable',
        //         stringArrayThreshold: 0.75,
        //         unicodeEscapeSequence: false
        //         // ...  [See more options](https://github.com/javascript-obfuscator/javascript-obfuscator)
        //     }
        // })
        // visualizer()
    ],
    optimizeDeps: {
        include: ['html-parse-stringify']
    },

    build: {
        target: 'esNext',

        outDir: '../backend/dev_frontend',
        rollupOptions: {
            output: {
                manualChunks: {
                    icons: ['react-icons/pi', '@tabler/icons-react'],
                    date: ['dayjs'],
                    react: [
                        'react',
                        'zustand',
                        'react-dom',
                        'react-router-dom',
                        'react-error-boundary',
                        'react-dom/client'
                    ],
                    mantine: [
                        '@mantine/core',
                        '@mantine/hooks',
                        '@mantine/nprogress',
                        '@mantine/notifications',
                        '@mantine/modals'
                    ],
                    i18n: [
                        'i18next-browser-languagedetector',
                        '@remnawave/backend-contract',
                        '@remnawave/subscription-page-types'
                    ]
                }
            }
        }
    },
    server: {
        host: '0.0.0.0',
        port: 3334,
        cors: false,
        strictPort: true,
        allowedHosts: true
    },
    resolve: {
        alias: {
            '@entities': fileURLToPath(new URL('./src/entities', import.meta.url)),
            '@features': fileURLToPath(new URL('./src/features', import.meta.url)),
            '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
            '@widgets': fileURLToPath(new URL('./src/widgets', import.meta.url)),
            '@public': fileURLToPath(new URL('./public', import.meta.url)),
            '@shared': fileURLToPath(new URL('./src/shared', import.meta.url))
        }
    }
})
