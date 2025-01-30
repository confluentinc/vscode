/** Given a label and a substring, return a range of indices to highlight the label. */
export function createHighlightRanges(label: string, substring: string): [number, number][] {
  if (!label || !substring) {
    return [];
  }
  const searchIndex = label.toLowerCase().indexOf(substring.toLowerCase());
  if (searchIndex >= 0) {
    return [[searchIndex, searchIndex + substring.length]];
  }
  return [];
}
