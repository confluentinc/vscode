import {
  tryToCreateConnection,
  tryToDeleteConnection,
  tryToGetConnection,
  tryToUpdateConnection,
} from ".";
import { ContainerListRequest, ContainerSummary, Port } from "../../clients/docker";
import { Connection, ConnectionSpec } from "../../clients/sidecar";
import { LOCAL_CONNECTION_ID, LOCAL_CONNECTION_SPEC } from "../../constants";
import {
  getLocalKafkaImageName,
  getLocalKafkaImageTag,
  getLocalSchemaRegistryImageName,
  getLocalSchemaRegistryImageTag,
  isDockerAvailable,
} from "../../docker/configs";
import { MANAGED_CONTAINER_LABEL } from "../../docker/constants";
import { getContainersForImage } from "../../docker/containers";
import { Logger } from "../../logging";
const logger = new Logger("sidecar.connections.local");

/** Create the local {@link Connection} and return it. */
export async function createLocalConnection(): Promise<Connection> {
  return await tryToCreateConnection(LOCAL_CONNECTION_SPEC);
}

/** Get the local {@link Connection} (if it exists). */
export async function getLocalConnection(): Promise<Connection | null> {
  return await tryToGetConnection(LOCAL_CONNECTION_ID);
}

/**
 * Discover any supported locally-running resources and update the local connection with the
 * relevant resource configs (for now, just Schema Registry containers, but in the future will
 * include Kafka and other resources).
 */
export async function updateLocalConnection(schemaRegistryUri?: string): Promise<void> {
  let spec: ConnectionSpec = LOCAL_CONNECTION_SPEC;

  // TODO(shoup): look up Kafka containers here once direct connections are used

  schemaRegistryUri = schemaRegistryUri ?? (await discoverSchemaRegistry());
  if (schemaRegistryUri) {
    spec = {
      ...LOCAL_CONNECTION_SPEC,
      schema_registry: {
        ...LOCAL_CONNECTION_SPEC.schema_registry,
        uri: schemaRegistryUri,
        // disable SSL for local connections
        ssl: { enabled: false },
      },
    };
  }

  const currentLocalConnection: Connection | null = await getLocalConnection();
  // inform sidecar if the spec has changed (whether this is a new spec or if we're changing configs)
  if (!currentLocalConnection) {
    await tryToCreateConnection(spec);
  } else if (JSON.stringify(spec) !== JSON.stringify(currentLocalConnection?.spec)) {
    await tryToUpdateConnection(spec);
  }
}

/** Delete the existing local {@link Connection} (if it exists). */
export async function deleteLocalConnection(): Promise<void> {
  await tryToDeleteConnection(LOCAL_CONNECTION_ID);
}

/**
 * Helper function to list containers based on image repo and tag.
 * @param imageRepo The image repo to filter by.
 * @param imageTag The image tag to filter by.
 * @param onlyExtensionManaged Whether or not to filter containers with the
 *   {@link MANAGED_CONTAINER_LABEL} label. (default: `false`)
 */
export async function getLocalResourceContainers(
  imageRepo: string,
  imageTag: string,
  onlyExtensionManaged: boolean = false,
): Promise<ContainerSummary[]> {
  const repoTag = `${imageRepo}:${imageTag}`;
  const filters: Record<string, any> = {
    ancestor: [repoTag],
    status: ["running"],
  };
  if (onlyExtensionManaged) {
    filters.label = [MANAGED_CONTAINER_LABEL];
  }
  const containerListRequest: ContainerListRequest = {
    all: true,
    filters: JSON.stringify(filters),
  };
  return await getContainersForImage(containerListRequest);
}

/**
 * Get running Kafka containers based on the image name and tag in user/workspace settings.
 * @param onlyExtensionManaged Whether or not to filter containers with the
 * {@link MANAGED_CONTAINER_LABEL} label. (default: `false`)
 */
export async function getLocalKafkaContainers(
  onlyExtensionManaged: boolean = false,
): Promise<ContainerSummary[]> {
  const imageRepo: string = getLocalKafkaImageName();
  const imageTag: string = getLocalKafkaImageTag();
  return await getLocalResourceContainers(imageRepo, imageTag, onlyExtensionManaged);
}

/**
 * Get running Schema Registry containers based on the image name and tag in user/workspace settings.
 * @param onlyExtensionManaged Whether or not to filter containers with the
 *  {@link MANAGED_CONTAINER_LABEL} label. (default: `false`)
 */
export async function getLocalSchemaRegistryContainers(
  onlyExtensionManaged: boolean = false,
): Promise<ContainerSummary[]> {
  const imageRepo: string = getLocalSchemaRegistryImageName();
  const imageTag: string = getLocalSchemaRegistryImageTag();
  return await getLocalResourceContainers(imageRepo, imageTag, onlyExtensionManaged);
}

/** Discover any running Schema Registry containers and return the URI to include the REST proxy port. */
async function discoverSchemaRegistry(): Promise<string | undefined> {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    return;
  }

  const containers: ContainerSummary[] = await getLocalSchemaRegistryContainers(true);
  if (containers.length === 0) {
    return;
  }
  // we only care about the first container
  const container: ContainerSummary = containers.filter((c) => !!c.Ports)[0];
  const ports: Port[] = container.Ports?.filter((p) => !!p.PublicPort) || [];
  if (!ports || ports.length === 0) {
    logger.debug("No ports found on Schema Registry container", { container });
    return;
  }
  const schemaRegistryPort: Port | undefined = ports.find((p) => !!p.PublicPort);
  if (!schemaRegistryPort) {
    logger.debug("No PublicPort found on Schema Registry container", { container });
    return;
  }
  const restProxyPort = schemaRegistryPort.PublicPort;
  if (!restProxyPort) {
    logger.debug("No REST proxy port found on Schema Registry container", { container });
    return;
  }
  logger.debug("Discovered Schema Registry REST proxy port", { schemaRegistryPort });
  return `http://localhost:${restProxyPort}`;
}
