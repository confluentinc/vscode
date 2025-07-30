export function filterSensitiveKeys<T>(obj: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(obj)
      .filter(
        ([key]) => !key.toLowerCase().includes("key") && !key.toLowerCase().includes("secret"),
      )
      .map(([key, value]) => [key, value]),
  );
}
