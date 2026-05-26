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

export default defineConfig({
    plugins: [react(), discoveryPlugin()],
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
