// Test-only (RUNNER_KEY, owner order 5 Nov 2026): every Request a test builds from a URL carries the test runner key unless the test sets its own x-runner-key
// (an empty value means "no key"). The matching Worker secret is the RUNNER_KEY literal in the test environments. Nothing here is loaded by the Worker.
export const TEST_RUNNER_KEY = "test-runner-key-test-runner-key-test0000";
const Base = globalThis.Request;
class RunnerRequest extends Base {
  constructor(input: any, init?: any) {
    if (typeof input === "string" || input instanceof URL) {
      const h = new Headers(init?.headers);
      if (!h.has("x-runner-key")) h.set("x-runner-key", TEST_RUNNER_KEY);
      super(input, { ...(init ?? {}), headers: h });
    } else super(input, init);
  }
}
(globalThis as any).Request = RunnerRequest;
