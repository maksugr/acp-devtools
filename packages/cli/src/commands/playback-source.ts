import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
    type CapturedMessage,
    Session,
    openDatabase,
    parseExport,
} from '@acp-devtools/core';

export interface PlaybackSourceOptions {
    /** Path to a JSON export (from `acp-devtools export`). Mutually exclusive with `session`. */
    script?: string;
    /** Session id inside `db`. Falsy = latest. */
    session?: string;
    /** Captures database path. Ignored when `script` is set. */
    db: string;
}

export interface LoadedPlaybackScript {
    messages: CapturedMessage[];
    /** Human-readable origin label, used in stderr status lines and DB metadata. */
    source: string;
}

/**
 * Resolve a mock command's input — either a JSON file (a teammate's export)
 * or a session row out of captures.db (the default, since the user almost
 * always wants something they captured themselves). Throws with a
 * user-readable message on bad input; caller writes that to stderr and exits.
 */
export function loadPlaybackScript(opts: PlaybackSourceOptions): LoadedPlaybackScript {
    if (opts.script && opts.session !== undefined) {
        throw new Error('--script and --session are mutually exclusive');
    }
    if (opts.script) {
        let text: string;
        try {
            text = readFileSync(opts.script, 'utf8');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`cannot read ${opts.script}: ${msg}`);
        }
        const exp = parseExport(text);
        return { messages: exp.messages, source: basename(opts.script) };
    }
    // DB path. --session optional; default = latest row.
    const db = openDatabase(opts.db);
    try {
        let session: Session;
        if (opts.session !== undefined) {
            const id = Number(opts.session);
            if (!Number.isInteger(id) || id <= 0) {
                throw new Error(`invalid --session "${opts.session}"`);
            }
            session = Session.load(db, id);
        } else {
            try {
                session = Session.latest(db);
            } catch {
                throw new Error(
                    `${opts.db} has no sessions yet — capture one with \`acp-devtools proxy\` first, or pass --script`,
                );
            }
        }
        return {
            messages: [...session.messages()],
            source: `session #${session.info.id} from ${basename(opts.db)}`,
        };
    } finally {
        db.close();
    }
}
