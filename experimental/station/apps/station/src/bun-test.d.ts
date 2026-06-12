declare module "bun:test" {
  type AsyncExpectation = {
    toEqual(expected: unknown): void | Promise<void>;
  };

  type Expectation = {
    not: {
      toBe(expected: unknown): void;
      toEqual(expected: unknown): void;
      toContain(expected: unknown): void;
    };
    resolves: AsyncExpectation;
    toBe(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toContain(expected: unknown): void;
    toEqual(expected: unknown): void;
    toHaveLength(expected: number): void;
    toHaveProperty(property: string): void;
    toMatchObject(expected: unknown): void;
    toMatch(expected: RegExp | string): void;
    toThrow(expected?: RegExp): void;
  };

  export function afterEach(callback: () => void | Promise<void>): void;
  export function beforeEach(callback: () => void | Promise<void>): void;
  export function describe(name: string, callback: () => void): void;
  export function expect(actual: unknown): Expectation;
  export function it(
    name: string,
    callback: () => void | Promise<void>,
    timeoutMs?: number,
  ): void;
}
