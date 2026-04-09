import type {
  CancellationToken,
  McpServerDefinitionProvider,
  McpStdioServerDefinition as McpStdioServerDefinitionType,
} from "vscode";
import { EventEmitter, McpStdioServerDefinition } from "vscode";
import { Logger } from "../logging";
import { DisposableCollection } from "../utils/disposables";

const logger = new Logger("mcp.baseMcpServerProvider");

/**
 * Env var key used to stash the connection ID inside the {@link McpStdioServerDefinition} so that
 * {@linkcode BaseMcpServerProvider.resolveMcpServerDefinition} can match by ID rather than label.
 * The MCP server ignores unrecognized env vars, so this is safe to include.
 */
const CONNECTION_ID_ENV_KEY = "__CONFLUENT_CONNECTION_ID";

/** A label + env var map pair that the base class converts into an {@link McpStdioServerDefinition}. */
export interface McpConnectionEnvMap {
  /** Stable identifier used to match definitions during resolve (e.g., a connection ID). */
  id: string;
  /** Human-readable label shown in the VS Code tool picker. */
  label: string;
  env: Record<string, string>;
}

/**
 * Abstract base for connection-type-specific MCP server providers. Subclasses supply connection
 * data via {@linkcode loadConnectionEnvMaps}; this class handles building
 * {@link McpStdioServerDefinition} instances, version tracking, and the change-event plumbing.
 */
export abstract class BaseMcpServerProvider
  extends DisposableCollection
  implements McpServerDefinitionProvider<McpStdioServerDefinitionType>
{
  protected readonly changeEmitter = new EventEmitter<void>();
  readonly onDidChangeMcpServerDefinitions = this.changeEmitter.event;

  constructor() {
    super();
    this.disposables.push(this.changeEmitter);
  }

  /**
   * Return one {@link McpStdioServerDefinition} per connection that has usable credentials.
   * Called eagerly by VS Code - must not prompt for user interaction.
   */
  async provideMcpServerDefinitions(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: CancellationToken,
  ): Promise<McpStdioServerDefinitionType[]> {
    const envMaps = await this.loadConnectionEnvMaps();
    const version = getMcpServerVersion();
    const definitions: McpStdioServerDefinitionType[] = [];

    for (const { id, label, env } of envMaps) {
      if (Object.keys(env).length === 0) continue;
      definitions.push(buildServerDefinition(id, label, env, version));
      logger.info(`MCP server definition created: "${label}" (${id})`);
    }

    logger.info(`Providing ${definitions.length} MCP server definition(s)`);
    return definitions;
  }

  /**
   * Called just before VS Code starts a server. Re-reads connection data in case it changed since
   * {@linkcode provideMcpServerDefinitions} was last called.
   */
  async resolveMcpServerDefinition(
    server: McpStdioServerDefinitionType,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: CancellationToken,
  ): Promise<McpStdioServerDefinitionType | undefined> {
    const envMaps = await this.loadConnectionEnvMaps();
    const version = getMcpServerVersion();

    const serverId = server.env[CONNECTION_ID_ENV_KEY];
    for (const { id, label, env } of envMaps) {
      if (id === serverId && Object.keys(env).length > 0) {
        logger.info(`Resolved MCP server definition for "${label}" (${id})`);
        return buildServerDefinition(id, label, env, version);
      }
    }

    logger.warn(`Could not resolve MCP server definition for "${server.label}"`);
    return undefined;
  }

  /**
   * Load the connection-specific label + env var mappings. Each entry produces one
   * {@link McpStdioServerDefinition}. Empty env maps are filtered out by the base class.
   */
  protected abstract loadConnectionEnvMaps(): Promise<McpConnectionEnvMap[]>;
}

/**
 * Resolve the absolute filesystem path to the bundled MCP server entry point.
 *
 * We use `require.resolve` instead of building a path from `extensionUri` or `extensionPath`
 * because this project's launch.json sets `extensionDevelopmentPath` to `${workspaceFolder}/out`,
 * which means `extensionPath` points to the compiled output directory rather than the project root
 * where `node_modules` lives. `require.resolve` walks up the directory tree to find `node_modules`
 * using Node's standard module resolution, so it works from both the `out/` bundle (dev) and a
 * packaged extension (production).
 *
 * Note: `import.meta.resolve` would be the preferred ESM approach, but the esbuild bundler strips
 * `import.meta.resolve` in the bundled output, making it `undefined` at runtime.
 */
function getMcpServerEntryPath(): string {
  return require.resolve("@confluentinc/mcp-confluent/dist/index.js");
}

/** Read the bundled MCP server version from its package.json. */
function getMcpServerVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@confluentinc/mcp-confluent/package.json").version;
  } catch {
    return "unknown";
  }
}

/**
 * Build a single {@link McpStdioServerDefinition} from a label, env map, and version.
 *
 * Uses `"node"` (system Node.js) instead of `process.execPath` (Electron's Node) because the MCP
 * server depends on `@confluentinc/kafka-javascript`, which has native addons compiled against the
 * system Node ABI. Electron ships a different Node version with an incompatible
 * `NODE_MODULE_VERSION`, so loading those native modules from `process.execPath` fails with
 * `ERR_DLOPEN_FAILED`.
 */
function buildServerDefinition(
  id: string,
  label: string,
  env: Record<string, string>,
  version: string,
): McpStdioServerDefinitionType {
  const serverScript = getMcpServerEntryPath();
  return new McpStdioServerDefinition(
    label,
    "node",
    [serverScript],
    { ...env, [CONNECTION_ID_ENV_KEY]: id },
    version,
  );
}
