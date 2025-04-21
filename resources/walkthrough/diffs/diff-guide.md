# Comparing Resources

The Confluent extension provides read-only document views for schema definitions and topic message
previews. You can compare them using VS Code's built-in diff editor:

## Comparing two documents

1. **Select the first document:** Right-click inside a document and select _"Select for Compare"_
   from the context menu. ![](./topic-message-diff-select.png)

2. **Compare with the second document:** Right-click inside another document and select _"Compare
   with Selected"_ from the context menu. ![](./topic-message-diff-compare.png)

3. VS Code will open a side-by-side diff view showing both documents with their differences
   highlighted. ![](./topic-messages-diff.png)

## Alternative methods

### From the editor tab

You can also access these commands by right-clicking on a document's **tab**:

![](./schemas-diff-tab-titles.png)

### From the sidebar

For schema versions, you can right-click items in the
[**Schemas** view](command:confluent-schemas.focus) in the sidebar:

![](./schemas-diff-sidebar.png)

## Tips

- The diff view is **read-only** but lets you easily spot differences between messages or schema
  versions
- Use the diff editor navigation arrows to jump between changes
- Schema comparisons are particularly useful when evolving schemas to ensure compatibility
