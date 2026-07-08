import type PlatformAdapter from '@/domain/PlatformAdapter';

export default class AdapterRegistry {
    constructor(private readonly adapters: PlatformAdapter[]) {}

    find(url: URL): PlatformAdapter | undefined {
        return this.adapters.find((a) => a.match(url));
    }

    list(): PlatformAdapter[] {
        return [...this.adapters];
    }
}
