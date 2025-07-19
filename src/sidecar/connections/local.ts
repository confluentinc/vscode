import {
  tryToCreateConnection,
  tryToDeleteConnection,
  tryToGetConnection,
  tryToUpdateConnection,
} from ".";
import {
  ContainerListRequest,
  ContainerStateStatusEnum,
  ContainerSummary,
  Port,
} from "../../clients/docker";
import { Connection, ConnectionSpec } from "../../clients/sidecar";
import { LOCAL_CONNECTION_ID, LOCAL_CONNECTION_SPEC } from "../../constants";
import { isDockerAvailable } from "../../docker/configs";
import { MANAGED_CONTAINER_LABEL } from "../../docker/constants";
import { getContainersForImage } from "../../docker/containers";
import {
  LOCAL_KAFKA_IMAGE,
  LOCAL_KAFKA_IMAGE_TAG,
  LOCAL_SCHEMA_REGISTRY_IMAGE,
  LOCAL_SCHEMA_REGISTRY_IMAGE_TAG,
} from "../../extensionSettings/constants";
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
 * Options for {@link getLocalResourceContainers} to filter the containers returned.
 * @param onlyExtensionManaged Whether or not to filter containers with the
 *   {@link MANAGED_CONTAINER_LABEL} label. (default: `false`)
 * @param statuses Only include containers with the given {@link ContainerStateStatusEnum statuses}.
 */
export interface LocalResourceContainersOptions {
  /** Only include containers managed by the extension by filtering labels for {@link MANAGED_CONTAINER_LABEL}. */
  onlyExtensionManaged?: boolean;
  /**
   * Only include containers with the given {@link ContainerStateStatusEnum statuses}.
   * Setting this to an empty array will mean no filtering by container `status` will happen.
   */
  statuses?: ContainerStateStatusEnum[];
}

/**
 * Helper function to list containers based on image repo and tag.
 * @param imageRepo The image repo to filter by.
 * @param imageTag The image tag to filter by.
 * @param options {@link LocalResourceContainersOptions Options} to filter the containers returned.
 */
export async function getLocalResourceContainers(
  imageRepo: string,
  imageTag: string,
  options: LocalResourceContainersOptions = { onlyExtensionManaged: false },
): Promise<ContainerSummary[]> {
  const repoTag = `${imageRepo}:${imageTag}`;
  const filters: Record<string, any> = {
    ancestor: [repoTag],
  };
  if (options.onlyExtensionManaged === true) {
    filters.label = [MANAGED_CONTAINER_LABEL];
  }
  if (Array.isArray(options.statuses) && options.statuses.length > 0) {
    filters.status = options.statuses;
  }
  const containerListRequest: ContainerListRequest = {
    all: true,
    filters: JSON.stringify(filters),
  };
  return await getContainersForImage(containerListRequest);
}

/**
 * Get Kafka containers based on the image name and tag in user/workspace settings.
 * @param options {@link LocalResourceContainersOptions Options} to filter the containers returned.
 */
export async function getLocalKafkaContainers(
  options: LocalResourceContainersOptions = { onlyExtensionManaged: false },
): Promise<ContainerSummary[]> {
  const imageRepo: string = LOCAL_KAFKA_IMAGE.value;
  const imageTag: string = LOCAL_KAFKA_IMAGE_TAG.value;
  return await getLocalResourceContainers(imageRepo, imageTag, options);
}

/**
 * Get Schema Registry containers based on the image name and tag in user/workspace settings.
 * @param options {@link LocalResourceContainersOptions Options} to filter the containers returned.
 */
export async function getLocalSchemaRegistryContainers(
  options: LocalResourceContainersOptions = { onlyExtensionManaged: false },
): Promise<ContainerSummary[]> {
  const imageRepo: string = LOCAL_SCHEMA_REGISTRY_IMAGE.value;
  const imageTag: string = LOCAL_SCHEMA_REGISTRY_IMAGE_TAG.value;
  return await getLocalResourceContainers(imageRepo, imageTag, options);
}

/** Discover any running Schema Registry containers and return the URI to include the REST proxy port. */
async function discoverSchemaRegistry(): Promise<string | undefined> {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    return;
  }

  const containers: ContainerSummary[] = await getLocalSchemaRegistryContainers({
    onlyExtensionManaged: true,
    statuses: [ContainerStateStatusEnum.Running],
  });
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
