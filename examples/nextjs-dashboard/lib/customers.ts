/**
 * Local store of the reseller's end-customers.
 *
 * Coronium's modems have a freeform `metadata` JSON field — this is your
 * mapping layer. You don't need a separate `proxies` table; just store the
 * end-customer profile here and stamp `metadata.customer_id` on every modem
 * you buy on their behalf.
 *
 * Storage: SQLite on a persistent writable disk. Do not deploy this unchanged
 * to an ephemeral serverless filesystem.
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
    CREATE TABLE IF NOT EXISTS proxy_assignment (
        modem_id    TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        metadata    TEXT NOT NULL,
        updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_received_at ON webhook_event (received_at DESC);
`);
const eventColumns = new Set((db.pragma('table_info(webhook_event)') as Array<{ name: string }>).map(c => c.name));
if (!eventColumns.has('event_id')) db.exec('ALTER TABLE webhook_event ADD COLUMN event_id TEXT');
if (!eventColumns.has('state')) db.exec("ALTER TABLE webhook_event ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'");
if (!eventColumns.has('error')) db.exec('ALTER TABLE webhook_event ADD COLUMN error TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_event_id ON webhook_event(event_id)');

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
        const assigned = db.prepare('SELECT 1 FROM proxy_assignment WHERE customer_id = ? LIMIT 1').get(id);
        if (assigned) throw new Error('Customer has assigned proxies; reassign them before deleting the customer.');
        db.prepare('DELETE FROM customer WHERE id = ?').run(id);
    },
};

export const webhookEvents = {
    insert(raw: any) {
        return db.prepare(`
            INSERT OR IGNORE INTO webhook_event (event_id, event, old_modem_id, new_modem_id, reason, raw, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            raw.event_id,
            raw?.event || 'unknown',
            raw?.data?.old_modem_id || null,
            raw?.data?.new_modem_id || null,
            raw?.data?.reason || null,
            JSON.stringify(raw),
            Date.now()
        ).changes > 0;
    },
    recent(limit = 50) {
        return db.prepare('SELECT id, event_id, event, old_modem_id, new_modem_id, reason, received_at, state, error FROM webhook_event ORDER BY received_at DESC LIMIT ?').all(limit);
    },
    pending(limit = 25) {
        return db.prepare("SELECT event_id, event, raw FROM webhook_event WHERE state = 'pending' AND event_id IS NOT NULL ORDER BY received_at ASC LIMIT ?").all(limit) as Array<{ event_id: string; event: string; raw: string }>;
    },
    mark(eventId: string, state: 'processed' | 'pending' | 'review', error: string | null = null) {
        db.prepare('UPDATE webhook_event SET state = ?, error = ? WHERE event_id = ?').run(state, error, eventId);
    },
};

export const assignments = {
    get(modemId: string) {
        return db.prepare('SELECT customer_id, metadata FROM proxy_assignment WHERE modem_id = ?').get(modemId) as
            { customer_id: string; metadata: string } | undefined;
    },
    upsert(modemId: string, customerId: string, metadata: string) {
        db.prepare(`INSERT INTO proxy_assignment (modem_id, customer_id, metadata, updated_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(modem_id) DO UPDATE SET
            customer_id = excluded.customer_id, metadata = excluded.metadata, updated_at = excluded.updated_at`)
            .run(modemId, customerId, metadata, Date.now());
    },
    replace(oldId: string, newId: string, customerId: string, metadata: string) {
        db.transaction(() => {
            this.upsert(newId, customerId, metadata);
            db.prepare('DELETE FROM proxy_assignment WHERE modem_id = ?').run(oldId);
        })();
    },
};
