// import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator'
// import { visualizer } from 'rollup-plugin-visualizer'
// import deadFile from 'vite-plugin-deadfile'
import { createReadStream, existsSync } from 'node:fs'
import removeConsole from 'vite-plugin-remove-console'
import webfontDownload from 'vite-plugin-webfont-dl'
import { defineConfig, type Plugin } from 'vite'
import { ViteEjsPlugin } from 'vite-plugin-ejs'
import react from '@vitejs/plugin-react'
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
    ],
    optimizeDeps: {
        include: ['html-parse-stringify']
    },
    build: {
        target: 'esnext',
        outDir: '../backend/dev_frontend',
        rollupOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: 'icons',
                            test: /node_modules[\\/](react-icons|@tabler[\\/]icons-react)[\\/]/
                        },
                        {
                            name: 'date',
                            test: /node_modules[\\/]dayjs[\\/]/
                        },
                        {
                            name: 'react',
                            test: /node_modules[\\/](react|zustand|react-dom|react-router|react-error-boundary)[\\/]/
                        },
                        {
                            name: 'mantine',
                            test: /node_modules[\\/]@mantine[\\/](core|hooks|nprogress|notifications|modals)[\\/]/
                        },
                        {
                            name: 'i18n',
                            test: /node_modules[\\/](i18next-browser-languagedetector|@remnawave[\\/](backend-contract|subscription-page-types))[\\/]/
                        }
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
    resolve: { tsconfigPaths: true }
})
