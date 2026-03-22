import { vi } from "vitest";

export interface MockQueryResult<T = unknown> {
  data: T;
  error: unknown;
}

const toPromise = <T>(result: MockQueryResult<T>) => Promise.resolve(result);

export const createQueryBuilder = <T>(result: MockQueryResult<T>) => {
  const promise = toPromise(result);
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => promise),
    single: vi.fn(() => promise),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };

  return builder;
};

export const createFromMock = (results: Record<string, MockQueryResult<unknown>>) =>
  vi.fn((table: string) => {
    const result = results[table];
    if (!result) {
      throw new Error(`No mocked query configured for table ${table}.`);
    }

    return createQueryBuilder(result);
  });
