import path from 'node:path';
import type { Server as HttpServer } from 'node:http';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import {
    attachReplayUpgrade,
    createApiHandler,
    defaultCapturesDbPath,
} from '@acp-devtools/core';

function discoveryPlugin(): PluginOption {
    const capturesDbPath = defaultCapturesDbPath();
    const apiHandler = createApiHandler({ capturesDbPath });
    return {
        name: 'acp-discovery',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                const handled = apiHandler(req, res);
                if (!handled) next();
            });
            if (server.httpServer) {
                // Vite's `httpServer` type is a union with Http2SecureServer
                // (the preview branch). In dev it's always plain http.Server,
                // and our handler only needs the `on('upgrade', ...)` API.
                attachReplayUpgrade(server.httpServer as HttpServer, { capturesDbPath });
            }
        },
    };
}

// `VITE_PLAYGROUND=1` produces the static GitHub Pages build:
// skip the dev-only discovery plugin (no backend in playground) and
// apply the repo-name base path so assets resolve under
// `<user>.github.io/acp-devtools/`. `VITE_BASE` overrides the path
// if the playground ever lands on a custom domain.
const PLAYGROUND = process.env.VITE_PLAYGROUND === '1';
const PLAYGROUND_BASE = process.env.VITE_BASE ?? '/acp-devtools/';

export default defineConfig({
    base: PLAYGROUND ? PLAYGROUND_BASE : '/',
    plugins: PLAYGROUND ? [react()] : [react(), discoveryPlugin()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    server: {
        port: 5173,
        strictPort: false,
        host: '127.0.0.1',
        open: false,
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
    },
});
