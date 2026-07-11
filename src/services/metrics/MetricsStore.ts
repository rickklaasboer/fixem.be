import type {Database} from 'bun:sqlite';
import Logger from '@/services/Logger';

export interface UsageRow {
    day: string;
    platform: string;
    outcome: string;
    cache: string;
    uaClass: string;
    count: number;
}
export interface ApiKeyRow {
    day: string;
    keyId: string;
    count: number;
}
export interface ProxyBytesRow {
    day: string;
    platform: string;
    bytes: number;
    requests: number;
}
export interface UsageBatch {
    usage: UsageRow[];
    apiKey: ApiKeyRow[];
    proxyBytes: ProxyBytesRow[];
}

/**
 * Durable aggregate-usage store over bun:sqlite. Every write is an accumulating
 * upsert; all writes in a flush run in one transaction. A null `db` (the DB
 * failed to open) puts the store in no-op mode — flush discards, queries return
 * empty — so a metrics outage never affects a request (fail-open, like Redis).
 */
export default class MetricsStore {
    constructor(
        private readonly db: Database | null,
        private readonly logger: Logger,
    ) {
        if (this.db) this.migrate();
    }

    private migrate(): void {
        const db = this.db!;
        db.exec('PRAGMA journal_mode = WAL;');
        db.exec(
            `CREATE TABLE IF NOT EXISTS usage_daily (
                day TEXT NOT NULL,
                platform TEXT NOT NULL,
                outcome TEXT NOT NULL,
                cache TEXT NOT NULL,
                ua_class TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (day, platform, outcome, cache, ua_class)
            );`,
        );
        db.exec(
            `CREATE TABLE IF NOT EXISTS usage_apikey_daily (
                day TEXT NOT NULL,
                key_id TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (day, key_id)
            );`,
        );
        db.exec(
            `CREATE TABLE IF NOT EXISTS proxy_bytes_daily (
                day TEXT NOT NULL,
                platform TEXT NOT NULL,
                bytes INTEGER NOT NULL DEFAULT 0,
                requests INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (day, platform)
            );`,
        );
    }

    public flush(batch: UsageBatch): void {
        if (!this.db) return;
        const db = this.db;
        const usageStmt = db.query(
            `INSERT INTO usage_daily (day, platform, outcome, cache, ua_class, count)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(day, platform, outcome, cache, ua_class)
             DO UPDATE SET count = count + excluded.count`,
        );
        const keyStmt = db.query(
            `INSERT INTO usage_apikey_daily (day, key_id, count)
             VALUES (?, ?, ?)
             ON CONFLICT(day, key_id)
             DO UPDATE SET count = count + excluded.count`,
        );
        const bytesStmt = db.query(
            `INSERT INTO proxy_bytes_daily (day, platform, bytes, requests)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(day, platform)
             DO UPDATE SET bytes = bytes + excluded.bytes,
                          requests = requests + excluded.requests`,
        );
        const tx = db.transaction(() => {
            for (const r of batch.usage)
                usageStmt.run(
                    r.day,
                    r.platform,
                    r.outcome,
                    r.cache,
                    r.uaClass,
                    r.count,
                );
            for (const r of batch.apiKey) keyStmt.run(r.day, r.keyId, r.count);
            for (const r of batch.proxyBytes)
                bytesStmt.run(r.day, r.platform, r.bytes, r.requests);
        });
        tx();
    }

    public usageBetween(from: string, to: string): UsageRow[] {
        if (!this.db) return [];
        return this.db
            .query(
                `SELECT day, platform, outcome, cache, ua_class AS uaClass, count
                 FROM usage_daily WHERE day >= ? AND day <= ?
                 ORDER BY day, platform, outcome, cache, ua_class`,
            )
            .all(from, to) as UsageRow[];
    }

    public apiKeysBetween(from: string, to: string): ApiKeyRow[] {
        if (!this.db) return [];
        return this.db
            .query(
                `SELECT day, key_id AS keyId, count
                 FROM usage_apikey_daily WHERE day >= ? AND day <= ?
                 ORDER BY day, key_id`,
            )
            .all(from, to) as ApiKeyRow[];
    }

    public proxyBytesBetween(from: string, to: string): ProxyBytesRow[] {
        if (!this.db) return [];
        return this.db
            .query(
                `SELECT day, platform, bytes, requests
                 FROM proxy_bytes_daily WHERE day >= ? AND day <= ?
                 ORDER BY day, platform`,
            )
            .all(from, to) as ProxyBytesRow[];
    }

    public close(): void {
        this.db?.close();
    }
}
