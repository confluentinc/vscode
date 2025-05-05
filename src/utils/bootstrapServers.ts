/**
 * Removes any leading protocol prefix from the bootstrap server(s) string.
 *
 * Example: "PLAIN://localhost:9092,localhost:9093" becomes "localhost:9092,localhost:9093"
 */
export function removeProtocolPrefix(bootstrapServers: string): string {
  return bootstrapServers
    .split(",")
    .map((server) => server.replace(/^[^:]+:\/\//, ""))
    .join(",");
}
