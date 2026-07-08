import {expect, test} from 'bun:test';
import BaseAdapter from '@/adapters/BaseAdapter';
import type EmbedMetadata from '@/domain/EmbedMetadata';

class Probe extends BaseAdapter {
    public name = 'probe';
    public match() {
        return true;
    }
    public canonicalize(url: URL) {
        return url.href;
    }
    public async resolve(): Promise<EmbedMetadata> {
        return this.card();
    }
    public card(): EmbedMetadata {
        return this.linkCard({
            title: 'T',
            siteName: 'S',
            originalUrl: 'https://x.test/',
        });
    }
}

test('linkCard builds a link-kind embed', () => {
    expect(new Probe().card()).toEqual({
        kind: 'link',
        title: 'T',
        siteName: 'S',
        originalUrl: 'https://x.test/',
    });
});
