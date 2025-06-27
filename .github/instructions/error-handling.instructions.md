---
applyTo: "**/*.ts"
description: "Error handling patterns and user experience guidelines"
---

# Error Handling and User Experience

When handling errors in the Confluent extension for VS Code:

## Error Logging and Reporting

- Always use the `logError()` utility for consistent error logging that captures:
  - Stack traces for debugging
  - HTTP response details (when applicable)
  - Contextual information about what operation failed
- Implement `showErrorNotificationWithButtons()` for user-facing errors that include:
  - "Open Logs" button to help users find detailed error information
  - "File Issue" button to streamline bug reporting

## User-Facing Error Messages

- Write actionable error messages that clearly explain:
  - What happened in plain language
  - Why it happened (when possible)
  - What the user can do to resolve the issue
  - Where to find more information if needed

## Error Recovery

- Implement graceful degradation when services are unavailable
- Provide clear paths to reconnect or retry failed operations
- Cache previous successful responses when possible to handle intermittent failures
