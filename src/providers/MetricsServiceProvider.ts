import {Database} from 'bun:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import ServiceProvider from '@/providers/ServiceProvider';
import MetricsStore from '@/services/metrics/MetricsStore';
import UsageTracker from '@/services/metrics/UsageTracker';
import UsageConfig from '@/config/UsageConfig';
import Logger from '@/services/Logger';
import Clock from '@/services/Clock';

/**
 * Opens the usage SQLite DB (fail-open: a bad path degrades to a null-db no-op
 * store), registers MetricsStore + UsageTracker, and — in boot() — starts the
 * periodic flush and flushes on shutdown. Must register after CoreServiceProvider
 * so Logger is available in boot().
 */
export default class MetricsServiceProvider extends ServiceProvider {
    register(): void {
        this.app.registerInstance(UsageConfig, UsageConfig.fromEnv(this.env));
    }

    boot(): void {
        const config = this.app.resolve(UsageConfig);
        const logger = this.app.resolve(Logger);

        let db: Database | null = null;
        try {
            // ":memory:" (tests) and bare filenames have no dir to create.
            if (config.dbPath !== ':memory:' && config.dbPath.includes('/')) {
                mkdirSync(dirname(config.dbPath), {recursive: true});
            }
            db = new Database(config.dbPath, {create: true});
        } catch (err) {
            logger.warn(
                {err: String(err), path: config.dbPath},
                'usage db open failed — metrics disabled',
            );
            db = null;
        }

        const store = new MetricsStore(db, logger);
        this.app.registerInstance(MetricsStore, store);
        const tracker = new UsageTracker(
            store,
            this.app.resolve(Clock),
            logger,
        );
        this.app.registerInstance(UsageTracker, tracker);

        const timer = setInterval(() => tracker.flush(), config.flushIntervalMs);
        // Don't let the flush loop keep the process alive on shutdown.
        (timer as {unref?: () => void}).unref?.();

        const shutdown = () => {
            tracker.flush();
            store.close();
            process.exit(0);
        };
        process.once('SIGTERM', shutdown);
        process.once('SIGINT', shutdown);
    }
}
