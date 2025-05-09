import { MarkdownString } from "vscode";
import { ContainerInspectResponse } from "../../clients/docker";

/**
 * Create a string representation of a {@link ContainerInspectResponse} object, limiting the
 * output to only the relevant Kafka/SR container information:
 * - Container name
 * - Image name (repo:tag)
 * - Environment variables that start with `KAFKA_`
 * - Status (running, exited, etc.)
 */
export function summarizeLocalDockerContainer(container: ContainerInspectResponse): string {
  const containerName = container.Name?.replace("/", "") ?? "";
  const summary = new MarkdownString().appendMarkdown(`- "${containerName}"`);

  const image: string | undefined = container.Config?.Image;
  if (image) {
    summary.appendMarkdown(`\n**Image:** ${container.Config?.Image}`);
  }

  const env: string[] = container.Config?.Env ?? [];
  if (env.length) {
    summary.appendMarkdown(`\n**Environment Variables:**`);
    env.forEach((envVar) => {
      if (envVar.startsWith("KAFKA_")) {
        const [key, value] = envVar.split("=");
        if (value !== "") {
          summary.appendMarkdown(`\n  - **${key}:** ${value}`);
        }
      }
    });
  }

  summary.appendMarkdown(`\n**Status:** ${container.State?.Status}`);

  return summary.value;
}
