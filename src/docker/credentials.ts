import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import { SecretStorage } from "vscode";
import { AuthConfig } from "../clients/docker";
import { Logger } from "../logging";
import { SecretStorageKeys } from "../storage/constants";
import { getSecretStorage } from "../storage/utils";
import { readFileSync } from "../utils/fsWrappers";

const logger = new Logger("docker.credentials");

/**
 * Look up the name of the `credsStore` from the local Docker config, if it's set.
 * @see https://docs.docker.com/reference/cli/docker/login/#credential-stores
 */
export function getDockerCredsStore(): string | undefined {
  let credsStore: string | undefined;
  try {
    const dockerConfigPath = join(homedir(), ".docker", "config.json");
    const dockerConfig = JSON.parse(readFileSync(dockerConfigPath, "utf-8"));
    credsStore = dockerConfig.credsStore;
  } catch (error) {
    logger.debug("failed to read Docker config:", error);
    return;
  }
  if (credsStore === undefined) {
    logger.debug("no Docker creds store configured in config.json");
    return;
  }
  if (!isValidCredsStoreName(credsStore)) {
    logger.debug("invalid Docker creds store name:", credsStore);
    return;
  }
  return credsStore;
}

/**
 * Validate that the credential store name is safe for command execution.
 * Only allow alphanumeric characters, hyphens, and underscores.
 */
export function isValidCredsStoreName(credsStore: string): boolean {
  // only allow only alphanumeric characters, hyphens, and underscores, like:
  // - desktop
  // - osxkeychain
  // - wincred
  // ...etc
  // and require at least one character, but no more than 100 characters (not hard limit, but seems reasonable)
  return /^[a-zA-Z0-9_-]+$/.test(credsStore) && credsStore.length > 0 && credsStore.length < 100;
}

/**
 * Get the Docker credentials for the current user, provided a `credsStore` is set.
 * This function will cache the credentials in SecretStorage for future use.
 * @returns A base64-encoded string of the Docker credentials, or `undefined` if the credentials
 * could not be retrieved.
 * @see https://docs.docker.com/reference/cli/docker/login/#credential-stores
 */
export async function getDockerCredentials(): Promise<string | undefined> {
  const secretStorage: SecretStorage = getSecretStorage();
  const cachedDockerCreds: string | undefined = await secretStorage.get(
    SecretStorageKeys.DOCKER_CREDS_SECRET_KEY,
  );
  if (cachedDockerCreds) {
    return cachedDockerCreds;
  }

  const credsStore: string | undefined = getDockerCredsStore();
  if (!credsStore) {
    return;
  }

  let credsString: string | undefined;
  try {
    // unfortunately, there isn't a way to get the credentials directly from the store, so we have
    // to try calling the `docker-credential-<store> get` command and parse the output
    const command: string = credsStore.startsWith("docker-credential-")
      ? credsStore
      : `docker-credential-${credsStore}`;
    credsString = execSync(`${command} get`, {
      input: "https://index.docker.io/v1/",
      encoding: "utf-8",
      timeout: 10000,
    });
  } catch (error) {
    logger.debug("failed to load Docker credentials:", error);
    return;
  }

  const credentialHeaders: AuthConfig | undefined = validateDockerCredentials(
    JSON.parse(credsString),
  );
  if (!credentialHeaders) {
    logger.debug("invalid Docker credentials, not storing");
    return;
  }
  const encodedCreds: string = Buffer.from(JSON.stringify(credentialHeaders)).toString("base64");
  await secretStorage.store(SecretStorageKeys.DOCKER_CREDS_SECRET_KEY, encodedCreds);
  return encodedCreds;
}

/**
 * Validate the Docker credentials object and convert it to a {@link AuthConfig} object.
 * @param creds The JSON-parsed credentials object to validate.
 * @returns A {@link AuthConfig} object if valid, or `undefined` if invalid.
 * @see https://docs.docker.com/reference/cli/docker/login/#credential-helper-protocol
 */
export function validateDockerCredentials(creds: any): AuthConfig | undefined {
  if (!creds) {
    return;
  }
  if (typeof creds.Username === "string" && typeof creds.Secret === "string") {
    return {
      username: creds.Username,
      password: creds.Secret,
      // we should only support creds.ServerURL if the image(s) are not being pulled from Docker Hub
      serveraddress: "https://index.docker.io/v1/",
    };
  }
}
