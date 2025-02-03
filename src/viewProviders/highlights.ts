import { TreeItem, TreeItemLabel } from "vscode";

/** Returns a range of indices to provide the `highlights` for a `TreeViewLabel` given a label. */
export function createHighlightRanges(label: string, substring: string): [number, number][] {
  if (!label || !substring) {
    return [];
  }

  const matches: [number, number][] = [];
  // case-insensitive search
  const lowerLabel = label.toLowerCase();
  const lowerSubstring = substring.toLowerCase();
  let searchIndex = 0;
  // find all occurrences of substring in label, not just the first
  while ((searchIndex = lowerLabel.indexOf(lowerSubstring, searchIndex)) >= 0) {
    matches.push([searchIndex, searchIndex + substring.length]);
    // move search position past current match before looking for next match
    searchIndex += substring.length;
  }
  return matches;
}

/** Applies highlight(s) via {@link TreeItemLabel} for an item based on a search string. */
export function highlightLabel(treeItem: TreeItem, searchStr: string): TreeItem {
  let label: string | TreeItemLabel = treeItem.label!;
  if (label && typeof label !== "string") {
    // label was a TreeItemLabel (may have been previously highlighted)
    label = label.label;
  }

  // if the item's label matched, apply highlight(s) to it
  const labelHighlights: [number, number][] = createHighlightRanges(label, searchStr);
  if (labelHighlights.length > 0) {
    treeItem.label = {
      label: label,
      highlights: labelHighlights,
    };
  } else if (String(treeItem.description)?.toLowerCase().includes(searchStr.toLowerCase())) {
    // the description matched; just add an asterisk to the label and highlight that instead
    // since the description property can't be highlighted directly
    treeItem.label = {
      label: `${label}*`,
      highlights: [[label.length, label.length + 1]],
    };
  }

  return treeItem;
}
