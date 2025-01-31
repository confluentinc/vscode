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
