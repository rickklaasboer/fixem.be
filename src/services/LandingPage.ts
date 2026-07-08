import {readFileSync} from 'node:fs';
import {singleton} from 'tsyringe';

/**
 * Serves the static landing page, read once at boot.
 */
@singleton()
export default class LandingPage {
    private cached: string | null = null;

    /**
     * The landing page HTML.
     */
    public html(): string {
        if (this.cached === null) {
            const path = new URL('../../public/index.html', import.meta.url);
            this.cached = readFileSync(path, 'utf8');
        }
        return this.cached;
    }
}
