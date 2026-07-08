import {singleton} from 'tsyringe';

/**
 * Injectable wall clock. Exists so time-dependent logic (breaker cooldowns,
 * rate-limit windows, token expiry) stays testable with a fake clock.
 */
@singleton()
export default class Clock {
    /**
     * Current epoch time in milliseconds.
     */
    public now(): number {
        return Date.now();
    }
}
