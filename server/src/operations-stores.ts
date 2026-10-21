// Console stores register synchronous privacy hooks before maintenance starts.
type Counts = { rows: number; tables: Record<string, number> };
type Store = {
  category: 'live';
  maintain(at: number): void;
  scrub(): void;
  delete(): Counts;
  storage(): Counts;
  export(content: boolean, limits: { maxRows: number; maxBytes: number }): { rows: number; tables: Record<string, unknown[]> };
};
const stores = new Map<string, Store>();
export function registerOperationsStore(name: string, store: Store) { stores.set(name, store); }
export function operationsStores() { return [...stores.values()]; }
