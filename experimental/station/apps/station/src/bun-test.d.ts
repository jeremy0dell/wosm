declare module "bun:test" {
  type AsyncExpectation = {
    toEqual(expected: unknown): void | Promise<void>;
  };

  type Expectation = {
    not: {
      toEqual(expected: unknown): void;
    };
    resolves: AsyncExpectation;
    toEqual(expected: unknown): void;
    toHaveProperty(property: string): void;
    toThrow(expected?: RegExp): void;
  };

  export function describe(name: string, callback: () => void): void;
  export function expect(actual: unknown): Expectation;
  export function it(name: string, callback: () => void | Promise<void>): void;
}
