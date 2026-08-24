/**
 * @fileOverview A ~90-line test runner.
 *
 * Not a rejection of Jest or Vitest on principle — this project simply has no other
 * use for a test framework, and adding one (plus its transform pipeline, plus its
 * config, plus its interaction with the Next.js build) to run assertions on pure
 * functions would be more machinery than the thing being tested. `npm run
 * eval:test` runs under the same `tsx` invocation as everything else in `eval/`,
 * needs no network, and exits non-zero on failure, which is the entire contract.
 */

export interface TestCase {
  name: string;
  fn: () => void | Promise<void>;
}

const suites: Array<{ name: string; tests: TestCase[] }> = [];
let current: { name: string; tests: TestCase[] } | null = null;

export function describe(name: string, body: () => void): void {
  current = { name, tests: [] };
  suites.push(current);
  body();
  current = null;
}

export function it(name: string, fn: () => void | Promise<void>): void {
  if (!current) throw new Error(`it("${name}") called outside describe()`);
  current.tests.push({ name, fn });
}

export class AssertionError extends Error {}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertionError(message);
}

export function assertEqual<T>(actual: T, expected: T, message?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new AssertionError(`${message ?? 'values differ'}\n  expected: ${b}\n  actual:   ${a}`);
  }
}

/** Floating-point comparison with an explicit tolerance. */
export function assertClose(actual: number, expected: number, tolerance = 1e-6, message?: string): void {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new AssertionError(
      `${message ?? 'numbers differ'}\n  expected: ${expected} ±${tolerance}\n  actual:   ${actual}`
    );
  }
}

export async function assertThrows(
  fn: () => unknown | Promise<unknown>,
  predicate: (err: unknown) => boolean,
  message: string
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (predicate(err)) return;
    throw new AssertionError(`${message}\n  threw the wrong error: ${err}`);
  }
  throw new AssertionError(`${message}\n  did not throw`);
}

export async function runAll(): Promise<void> {
  let passed = 0;
  const failures: Array<{ suite: string; test: string; error: unknown }> = [];

  for (const suite of suites) {
    console.log(`\n${suite.name}`);
    for (const test of suite.tests) {
      try {
        await test.fn();
        passed += 1;
        console.log(`  ✓ ${test.name}`);
      } catch (error) {
        failures.push({ suite: suite.name, test: test.name, error });
        console.log(`  ✗ ${test.name}`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    console.log('');
    for (const f of failures) {
      console.log(`── ${f.suite} › ${f.test}`);
      console.log(`   ${f.error instanceof Error ? f.error.message : String(f.error)}`);
      if (f.error instanceof Error && !(f.error instanceof AssertionError) && f.error.stack) {
        console.log(f.error.stack.split('\n').slice(1, 4).join('\n'));
      }
      console.log('');
    }
    process.exit(1);
  }
}
