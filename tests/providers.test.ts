import {describe, expect, test} from 'bun:test';
import {container} from '@/container';
import CoreServiceProvider from '@/providers/CoreServiceProvider';
import ApiServiceProvider from '@/providers/ApiServiceProvider';
import ProxyServiceProvider from '@/providers/ProxyServiceProvider';
import Logger from '@/services/Logger';
import HttpClient from '@/services/HttpClient';
import AppConfig from '@/config/AppConfig';
import ApiConfig from '@/config/ApiConfig';
import ProxyConfig from '@/config/ProxyConfig';

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
});
