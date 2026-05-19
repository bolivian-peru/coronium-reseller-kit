/**
 * Local store of the reseller's end-customers.
 *
 * Coronium's modems have a freeform `metadata` JSON field — this is your
 * mapping layer. You don't need a separate `proxies` table; just store the
 * end-customer profile here and stamp `metadata.customer_id` on every modem
 * you buy on their behalf.
 *
 * Storage: SQLite via better-sqlite3 (single file, zero ops). Swap for
 * Vercel KV / Postgres / Upstash when you outgrow it.
 */
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'reseller.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS customer (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        email       TEXT,
        markup_pct  REAL,
        notes       TEXT,
        created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS webhook_event (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        event        TEXT NOT NULL,
        old_modem_id TEXT,
        new_modem_id TEXT,
        reason       TEXT,
        raw          TEXT NOT NULL,
        received_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_received_at ON webhook_event (received_at DESC);
`);

export interface Customer {
    id: string;
    name: string;
    email?: string | null;
    markup_pct?: number | null;
    notes?: string | null;
    created_at: number;
}

export const customers = {
    list(): Customer[] {
        return db.prepare('SELECT * FROM customer ORDER BY created_at DESC').all() as Customer[];
    },
    get(id: string): Customer | null {
        return (db.prepare('SELECT * FROM customer WHERE id = ?').get(id) as Customer) || null;
    },
    upsert(c: Omit<Customer, 'created_at'> & { created_at?: number }) {
        const created_at = c.created_at || Date.now();
        db.prepare(`
            INSERT INTO customer (id, name, email, markup_pct, notes, created_at)
            VALUES (@id, @name, @email, @markup_pct, @notes, @created_at)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name,
                email=excluded.email,
                markup_pct=excluded.markup_pct,
                notes=excluded.notes
        `).run({
            id: c.id,
            name: c.name,
            email: c.email ?? null,
            markup_pct: c.markup_pct ?? null,
            notes: c.notes ?? null,
            created_at,
        });
    },
    delete(id: string) {
        db.prepare('DELETE FROM customer WHERE id = ?').run(id);
    },
};

export const webhookEvents = {
    insert(raw: any) {
        db.prepare(`
            INSERT INTO webhook_event (event, old_modem_id, new_modem_id, reason, raw, received_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            raw?.event || 'unknown',
            raw?.old_modem_id || null,
            raw?.new_modem_id || null,
            raw?.reason || null,
            JSON.stringify(raw),
            Date.now()
        );
    },
    recent(limit = 50) {
        return db.prepare('SELECT * FROM webhook_event ORDER BY received_at DESC LIMIT ?').all(limit);
    },
};
