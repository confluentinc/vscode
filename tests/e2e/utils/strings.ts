/** Generate a random hexadecimal string of the specified `length`. */
export function randomHexString(length: number): string {
  return Math.random()
    .toString(16)
    .substring(2, 2 + length);
}
