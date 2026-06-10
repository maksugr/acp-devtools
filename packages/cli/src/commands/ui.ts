import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import {
    attachReplayUpgrade,
    createApiHandler,
    defaultCapturesDbPath,
} from '@acp-devtools/core';

interface UiCommandOptions {
    port: string;
    host: string;
    open: boolean;
    capturesDb?: string;
}

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.txt': 'text/plain; charset=utf-8',
};

function uiDistDir(): string {
    // The CLI is bundled into a single `dist/index.js` by tsup, so the
    // embedded UI lives at `dist/ui/` — i.e. a sibling of the bundle.
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, 'ui');
}

function contentTypeFor(path: string): string {
    return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function serveStatic(req: IncomingMessage, res: ServerResponse, rootDir: string): void {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.statusCode = 405;
        res.end();
        return;
    }
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    // Map "/" → index.html, otherwise try the literal file.
    const relative = urlPath === '/' || urlPath === '' ? '/index.html' : urlPath;
    const candidate = normalize(join(rootDir, relative));
    // Defence against `../` escapes — every resolved path must stay under root.
    if (!candidate.startsWith(rootDir + sep) && candidate !== rootDir) {
        res.statusCode = 403;
        res.end();
        return;
    }
    let filePath = candidate;
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        // SPA fallback: any unknown route serves index.html so the React app
        // can render an empty state instead of a 404.
        filePath = join(rootDir, 'index.html');
        if (!existsSync(filePath)) {
            res.statusCode = 404;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end('UI bundle not found. Build with `npm run build:full`.\n');
            return;
        }
    }
    const stat = statSync(filePath);
    res.statusCode = 200;
    res.setHeader('content-type', contentTypeFor(filePath));
    res.setHeader('content-length', stat.size);
    res.setHeader('cache-control', 'no-cache');
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    createReadStream(filePath).pipe(res);
}

function openBrowser(url: string): void {
    const win = process.platform === 'win32';
    const cmd = win ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = win ? ['/c', 'start', '""', url] : [url];
    try {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.on('error', () => {
            // platform tool missing — leave the URL printed to stderr
        });
        child.unref();
    } catch {
        // ignore
    }
}

export function registerUiCommand(program: Command): void {
    program
        .command('ui')
        .description('Serve the acp-devtools UI from an embedded static bundle')
        .option('--port <port>', 'HTTP port to bind', '3737')
        .option('--host <host>', 'HTTP bind address', '127.0.0.1')
        .option('--no-open', "don't auto-open the browser")
        .option(
            '--captures-db <file>',
            'path to the captures SQLite database (default: ~/.acp-devtools/captures.db)',
        )
        .action(async (opts: UiCommandOptions) => {
            const port = Number(opts.port);
            if (!Number.isInteger(port) || port < 0 || port > 65535) {
                process.stderr.write(`acp-devtools: invalid --port "${opts.port}"\n`);
                process.exit(2);
            }
            const rootDir = uiDistDir();
            if (!existsSync(join(rootDir, 'index.html'))) {
                process.stderr.write(
                    `acp-devtools: UI bundle missing at ${rootDir}\n` +
                        `  Run \`npm run build:full\` in the monorepo, or reinstall the published package.\n`,
                );
                process.exit(1);
            }
            const capturesDbPath = opts.capturesDb ?? defaultCapturesDbPath();
            // Loopback hosts always pass the Host check; this adds an explicit
            // non-loopback bind (a wildcard bind disables the check).
            const allowedHosts = [opts.host];
            const apiHandler = createApiHandler({
                capturesDbPath,
                binaryPath: process.argv[1] ?? null,
                allowedHosts,
            });

            const server = createServer((req, res) => {
                if (apiHandler(req, res)) return;
                serveStatic(req, res, rootDir);
            });

            attachReplayUpgrade(server, { capturesDbPath, allowedHosts });

            await new Promise<void>((resolveListen, rejectListen) => {
                server.once('error', rejectListen);
                server.listen(port, opts.host, () => {
                    server.off('error', rejectListen);
                    resolveListen();
                });
            }).catch((err) => {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`acp-devtools: HTTP bind failed: ${message}\n`);
                process.exit(1);
            });

            const address = server.address();
            const boundPort = typeof address === 'object' && address ? address.port : port;
            const url = `http://${opts.host}:${boundPort}/`;
            process.stderr.write(`acp-devtools: UI listening on ${url}\n`);
            process.stderr.write(`acp-devtools: captures database = ${capturesDbPath}\n`);
            if (opts.open) {
                openBrowser(url);
            } else {
                process.stderr.write('acp-devtools: --no-open: skipping browser\n');
            }
            process.stderr.write('acp-devtools: press Ctrl+C to stop\n');

            await new Promise<void>((stopResolve) => {
                const shutdown = () => {
                    server.close(() => stopResolve());
                };
                process.once('SIGINT', shutdown);
                process.once('SIGTERM', shutdown);
            });
        });
}
