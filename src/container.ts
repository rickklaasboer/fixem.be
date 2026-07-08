import 'reflect-metadata';
import {
    container,
    type DependencyContainer,
    type InjectionToken,
} from 'tsyringe';

/**
 * Resolve a class/token from the global container.
 * Mirrors wego-overseer's `app()` helper.
 */
export function app<T>(token: InjectionToken<T>): T {
    return container.resolve(token);
}

export {container};
export type {DependencyContainer};
