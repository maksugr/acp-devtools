import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { listActive } from '@acp-devtools/core';

function discoveryPlugin(): PluginOption {
    return {
        name: 'acp-discovery',
        configureServer(server) {
            server.middlewares.use('/api/active', (req, res) => {
                if (req.method !== 'GET') {
                    res.statusCode = 405;
                    res.end();
                    return;
                }
                try {
                    const captures = listActive();
                    res.setHeader('content-type', 'application/json');
                    res.setHeader('cache-control', 'no-store');
                    res.end(JSON.stringify({ captures }));
                } catch (err) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: String(err) }));
                }
            });
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
