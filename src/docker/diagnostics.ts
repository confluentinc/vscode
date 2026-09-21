import { constants } from "fs";
import { homedir } from "os";
import { join } from "path";
import { accessSync, readFileSync } from "../utils/fsWrappers";

/** Result of probing whether the local Docker socket can be reached. */
export enum DockerSocketStatus {
  /** The socket exists and the current user can read and write it. */
  ACCESSIBLE = "ACCESSIBLE",
  /** No file exists at the socket path (Docker likely not installed or not running). */
  MISSING = "MISSING",
  /** The socket exists but the current user lacks permission (e.g. not in the `docker` group). */
  PERMISSION_DENIED = "PERMISSION_DENIED",
  /** The socket could not be classified (unexpected error while probing). */
  UNKNOWN = "UNKNOWN",
}

/**
 * Probe whether the current user can reach the Docker socket at `socketPath`.
 *
 * This distinguishes "Docker isn't installed/running" (a missing socket) from "the socket is there
 * but this user can't use it" (a permissions problem, common on Linux when the user isn't in the
 * `docker` group), so callers can surface the right remediation instead of a blanket
 * "install Docker" hint.
 */
export function checkDockerSocketAccess(socketPath: string): DockerSocketStatus {
  try {
    accessSync(socketPath, constants.R_OK | constants.W_OK);
    return DockerSocketStatus.ACCESSIBLE;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    switch (code) {
      case "ENOENT":
        return DockerSocketStatus.MISSING;
      case "EACCES":
      case "EPERM":
        return DockerSocketStatus.PERMISSION_DENIED;
      default:
        return DockerSocketStatus.UNKNOWN;
    }
  }
}

/** Result of inspecting the local Docker config file at `~/.docker/config.json`. */
export enum DockerConfigStatus {
  /** The file exists and parses to a JSON object. */
  VALID = "VALID",
  /** No file exists at the config path. */
  MISSING = "MISSING",
  /** The file exists but is empty or whitespace-only (needs at least `{}`). */
  EMPTY = "EMPTY",
  /** The file exists but could not be read (e.g. permissions) or does not parse to a JSON object. */
  INVALID = "INVALID",
}

/**
 * Inspect the local Docker config file at `~/.docker/config.json`.
 *
 * On a fresh Docker install (notably on Linux) this file is often absent or empty, which the Docker
 * CLI tolerates but our credential lookup cannot, so callers can point the user at the concrete fix
 * (create the file with at least `{}`) instead of failing silently.
 */
export function checkDockerConfigFile(): DockerConfigStatus {
  const configPath = join(homedir(), ".docker", "config.json");
  let contents: string;
  try {
    contents = readFileSync(configPath, "utf-8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? DockerConfigStatus.MISSING
      : DockerConfigStatus.INVALID;
  }
  if (contents.trim() === "") {
    return DockerConfigStatus.EMPTY;
  }
  try {
    const parsed: unknown = JSON.parse(contents);
    // a Docker config must be a JSON object; null and arrays are also `typeof "object"`.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return DockerConfigStatus.INVALID;
    }
  } catch {
    return DockerConfigStatus.INVALID;
  }
  return DockerConfigStatus.VALID;
}
