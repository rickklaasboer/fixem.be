import {expect, test} from 'bun:test';
import {injectable} from 'tsyringe';
import {app, container} from '@/container';

@injectable()
class Dep {
    public value = 42;
}

@injectable()
class Consumer {
    constructor(public dep: Dep) {}
}

test('container resolves constructor-injected class deps', () => {
    const c = container.createChildContainer();
    expect(c.resolve(Consumer).dep.value).toBe(42);
});

test('app() resolves a class', () => {
    expect(app(Dep).value).toBe(42);
});
