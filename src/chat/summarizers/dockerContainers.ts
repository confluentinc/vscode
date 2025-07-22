import { MarkdownString } from "vscode";
import { ContainerInspectResponse } from "../../clients/docker";
import { LOCAL_KAFKA_IMAGE, LOCAL_SCHEMA_REGISTRY_IMAGE } from "../../extensionSettings/constants";

function appendPortMappings(summary: MarkdownString, container: ContainerInspectResponse): void {
  const ports = container.NetworkSettings?.Ports ?? {};
  const portMappings = Object.entries(ports).map(([containerPort, hostBindings]) => {
    const hostPort = hostBindings?.[0]?.HostPort;
    return { containerPort, hostPort: hostPort ?? containerPort };
  });

  if (portMappings.length) {
    summary.appendMarkdown("\n\n### Ports");
    portMappings.forEach(({ containerPort, hostPort }) => {
      summary.appendMarkdown(`\n- ${containerPort} → ${hostPort}`);
    });
  }
}

function appendEnvironmentVars(summary: MarkdownString, container: ContainerInspectResponse): void {
  const env: string[] = container.Config?.Env ?? [];
  const relevantEnvVars = env.filter(
    (envVar) =>
      (envVar.startsWith("KAFKA_") || envVar.startsWith("SCHEMA_REGISTRY_")) &&
      envVar.includes("="),
  );

  if (relevantEnvVars.length) {
    summary.appendMarkdown("\n\n### Environment Variables");
    relevantEnvVars.forEach((envVar) => {
      const [key, value] = envVar.split("=");
      if (value) {
        summary.appendMarkdown(`\n- ${key}: ${value}`);
      }
    });
  }
}

/**
 * Create a string representation of a {@link ContainerInspectResponse} object, limiting the
 * output to only the relevant Kafka/SR container information:
 * - Container name
 * - Port mappings
 * - Image name (repo:tag)
 * - Environment variables that start with `KAFKA_`
 * - Status (running, exited, etc.)
 */
export function summarizeLocalDockerContainer(container: ContainerInspectResponse): string {
  const containerName = container.Name?.replace("/", "") ?? "";
  const summary = new MarkdownString().appendMarkdown(`## "${containerName}"`);

  const kafkaImageRepo: string = LOCAL_KAFKA_IMAGE.value;
  const schemaRegistryImageRepo: string = LOCAL_SCHEMA_REGISTRY_IMAGE.value;

  const image: string | undefined = container.Config?.Image;

  if (!image) {
    summary.appendMarkdown(`\n\n### Error\nNo image configuration found`);
    return summary.value;
  }

  if (!image.includes(kafkaImageRepo) && !image.includes(schemaRegistryImageRepo)) {
    summary.appendMarkdown(`\n\n### Error\nUnrecognized container type`);
    return summary.value;
  }

  summary.appendMarkdown(`\n\n### Image\n${image}`);
  summary.appendMarkdown(`\n\n### Status\n${container.State?.Status ?? "unknown"}`);

  appendPortMappings(summary, container);
  appendEnvironmentVars(summary, container);

  return summary.value;
}
