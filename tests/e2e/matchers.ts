import type { ExpectMatcherState, Locator, MatcherReturnType } from "@playwright/test";
import { expect } from "@playwright/test";

/** Options accepted by {@linkcode toBeExpanded}, mirroring built-in locator assertions. */
interface ToBeExpandedOptions {
  timeout?: number;
}

/**
 * Assert that a tree item or view header is expanded, i.e. carries `aria-expanded="true"`.
 *
 * Delegates to the auto-retrying `toHaveAttribute` assertion, so it preserves web-first
 * auto-waiting and works with `.not`.
 */
async function toBeExpanded(
  this: ExpectMatcherState,
  locator: Locator,
  options?: ToBeExpandedOptions,
): Promise<MatcherReturnType> {
  const assertionName = "toBeExpanded";
  let pass: boolean;
  let matcherResult: { actual?: unknown } | undefined;
  try {
    // delegate through `.not` when negated so auto-waiting polls in the expected direction
    const assertion = this.isNot ? expect(locator).not : expect(locator);
    await assertion.toHaveAttribute("aria-expanded", "true", options);
    pass = true;
  } catch (error: unknown) {
    matcherResult = (error as { matcherResult?: { actual?: unknown } }).matcherResult;
    pass = false;
  }
  // `.not` was already applied above; flip back so the returned `pass` reflects the base assertion.
  if (this.isNot) {
    pass = !pass;
  }

  const message = () => {
    const hint = this.utils.matcherHint(assertionName, undefined, "", { isNot: this.isNot });
    return (
      `${hint}\n\n` +
      `Expected: ${this.isNot ? "not " : ""}aria-expanded="true"\n` +
      `Received: aria-expanded=${this.utils.printReceived(matcherResult?.actual)}`
    );
  };

  return { message, pass, name: assertionName, expected: "true", actual: matcherResult?.actual };
}

expect.extend({ toBeExpanded });

declare global {
  namespace PlaywrightTest {
    interface Matchers<R, T = unknown> {
      /** Assert the locator carries `aria-expanded="true"` (i.e. the tree item/view is expanded). */
      toBeExpanded(options?: ToBeExpandedOptions): R;
    }
  }
}
