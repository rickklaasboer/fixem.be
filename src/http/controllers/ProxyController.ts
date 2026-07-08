import {injectable} from 'tsyringe';
import type {Context} from 'hono';
import ProxyStreamer from '@/services/proxy/ProxyStreamer';

/**
 * Thin wrapper around `ProxyStreamer` for the `/v/:token` route.
 */
@injectable()
export default class ProxyController {
    constructor(private streamer: ProxyStreamer) {}

    /**
     * `GET /v/:token` — stream the signed, allowlisted media proxy target.
     */
    public stream(c: Context): Promise<Response> {
        return this.streamer.stream(c);
    }
}
