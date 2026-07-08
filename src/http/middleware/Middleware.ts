import type {MiddlewareHandler} from 'hono';

/**
 * Contract for a Hono middleware wrapped in a DI-injectable class.
 */
export default interface Middleware {
    handle: MiddlewareHandler;
}
