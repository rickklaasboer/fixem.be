import {describe, expect, test} from 'bun:test';
import {container} from '@/container';
import CoreServiceProvider from '@/providers/CoreServiceProvider';
import ApiServiceProvider from '@/providers/ApiServiceProvider';
import ProxyServiceProvider from '@/providers/ProxyServiceProvider';
import MetricsServiceProvider from '@/providers/MetricsServiceProvider';
import Logger from '@/services/Logger';
import HttpClient from '@/services/HttpClient';
import AppConfig from '@/config/AppConfig';
import ApiConfig from '@/config/ApiConfig';
import ProxyConfig from '@/config/ProxyConfig';
import UsageConfig from '@/config/UsageConfig';
import MetricsStore from '@/services/metrics/MetricsStore';
import UsageTracker from '@/services/metrics/UsageTracker';

describe('service providers', () => {
    test('CoreServiceProvider registers leaves + app config', () => {
        const c = container.createChildContainer();
        new CoreServiceProvider(c, {PORT: '8080'}).register();
        expect(c.resolve(Logger)).toBeInstanceOf(Logger);
        expect(c.resolve(HttpClient)).toBeInstanceOf(HttpClient);
        expect(c.resolve(AppConfig).port).toBe(8080);
    });

    test('ApiServiceProvider registers ApiConfig from env', () => {
        const c = container.createChildContainer();
        new ApiServiceProvider(c, {API_KEYS: 'k1,k2'}).register();
        expect(c.resolve(ApiConfig).keys).toEqual(['k1', 'k2']);
    });

    test('ProxyServiceProvider registers ProxyConfig; boot() is side-effect only', () => {
        const c = container.createChildContainer();
        const p = new ProxyServiceProvider(c, {PROXY_SECRET: 's'});
        p.register();
        expect(c.resolve(ProxyConfig).secret).toBe('s');
        expect(() => p.boot()).not.toThrow();
    });

    test('MetricsServiceProvider registers store + tracker (in-memory db)', () => {
        const c = container.createChildContainer();
        new CoreServiceProvider(c, {}).register(); // Logger for the store
        const p = new MetricsServiceProvider(c, {USAGE_DB_PATH: ':memory:'});
        p.register();
        expect(c.resolve(UsageConfig).dbPath).toBe(':memory:');
        expect(() => p.boot()).not.toThrow();
        expect(c.resolve(MetricsStore)).toBeInstanceOf(MetricsStore);
        expect(c.resolve(UsageTracker)).toBeInstanceOf(UsageTracker);
    });
});
