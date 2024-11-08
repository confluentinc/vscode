## Summary of Changes

<!-- Include a high-level overview of your implementation, including any alternatives you considered and items you'll address in follow-up PRs -->

-

## Any additional details or context that should be provided?

<!-- Behavior before/after, more technical details/screenshots, follow-on work that should be expected, links to discussions or issues, etc -->

-

## Pull request checklist

Please check if your PR fulfills the following (if applicable):

##### Tests

- [ ] Added new
- [ ] Updated existing
- [ ] Deleted existing

##### Other

- [ ] All new disposables (event listeners, views, channels, etc.) collected as  for eventual cleanup?
<!-- prettier-ignore -->
- [ ] Does anything in this PR need to be mentioned in the user-facing [CHANGELOG](https://github.com/confluentinc/vscode/blob/main/CHANGELOG.md) or [README](https://github.com/confluentinc/vscode/blob/main/public/README.md)?
- [ ] Have you validated this change locally by [packaging](https://github.com/confluentinc/vscode/blob/main/README.md#packaging-steps) and installing the extension `.vsix` file?
  ```shell
  gulp clicktest
  ```
