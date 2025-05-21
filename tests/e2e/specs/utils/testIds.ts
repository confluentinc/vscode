/**
 * Centralized test IDs used across the test suite.
 * These IDs should match the data-testid attributes in the webview components.
 */
export const FlinkStatementTestIds = {
  // Status and state related
  statementStatus: "statement-status",
  statementDetailInfo: "statement-detail-info",
  statementDetailError: "statement-detail-error",

  // Action buttons
  stopStatementButton: "stop-statement-button",

  // Results related
  resultsStats: "results-stats",
} as const;

// Type to ensure we only use valid test IDs
export type TestId = (typeof FlinkStatementTestIds)[keyof typeof FlinkStatementTestIds];
