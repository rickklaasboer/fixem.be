import type { PlatformAdapter } from "./types";

export class AdapterRegistry {
  constructor(private readonly adapters: PlatformAdapter[]) {}

  find(url: URL): PlatformAdapter | undefined {
    return this.adapters.find((a) => a.match(url));
  }

  list(): PlatformAdapter[] {
    return [...this.adapters];
  }
}
