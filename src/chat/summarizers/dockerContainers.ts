import { MarkdownString, workspace } from "vscode";
import { ContainerInspectResponse } from "../../clients/docker";
import { DEFAULT_KAFKA_IMAGE_REPO, DEFAULT_SCHEMA_REGISTRY_REPO } from "../../docker/constants";
import { LOCAL_KAFKA_IMAGE, LOCAL_SCHEMA_REGISTRY_IMAGE } from "../../preferences/constants";

function summarizeContainer(
  summary: MarkdownString,
  container: ContainerInspectResponse,
  image: string,
): string {
  summary.appendMarkdown(`\n- Image: ${image}`);

  const ports = container.NetworkSettings?.Ports ?? {};
  const portMappings = Object.entries(ports).map(([containerPort, hostBindings]) => {
    const hostPort = hostBindings?.[0]?.HostPort;
    return { containerPort, hostPort: hostPort ?? containerPort };
  });

  const env: string[] = container.Config?.Env ?? [];
  if (env.length || portMappings.length) {
    summary.appendMarkdown(`\n- Environment Variables:`);
    // Add port mappings as environment variables
    portMappings.forEach(({ containerPort, hostPort }) => {
      summary.appendMarkdown(`\n  - PORT_${containerPort.split("/")[0]}: ${hostPort}`);
    });
    env.forEach((envVar) => {
      if (envVar.startsWith("KAFKA_") || envVar.startsWith("SCHEMA_REGISTRY_")) {
        const [key, value] = envVar.split("=");
        if (value !== "") {
          summary.appendMarkdown(`\n  - ${key}: ${value}`);
        }
      }
    });
  }

  summary.appendMarkdown(`\n- Status: ${container.State?.Status}`);
  return summary.value;
}

export function summarizeLocalDockerContainer(container: ContainerInspectResponse): string {
  const containerName = container.Name?.replace("/", "") ?? "";
  const summary = new MarkdownString().appendMarkdown(`### "${containerName}"`);

  const config = workspace.getConfiguration();
  const kafkaImageRepo: string = config.get(LOCAL_KAFKA_IMAGE) ?? DEFAULT_KAFKA_IMAGE_REPO;
  const schemaRegistryImageRepo: string =
    config.get(LOCAL_SCHEMA_REGISTRY_IMAGE) ?? DEFAULT_SCHEMA_REGISTRY_REPO;

  const image: string | undefined = container.Config?.Image;

  if (!image) {
    summary.appendMarkdown(`\n- Error: No image configuration found`);
    return summary.value;
  }

  if (image.includes(kafkaImageRepo) || image.includes(schemaRegistryImageRepo)) {
    return summarizeContainer(summary, container, image);
  }

  summary.appendMarkdown(`\n- Error: Unrecognized container type`);
  return summary.value;
}
