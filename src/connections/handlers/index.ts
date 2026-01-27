/**
 * Connection handlers module.
 *
 * Provides the abstract base class and concrete implementations for
 * handling different connection types (CCloud, Local, Direct).
 */

export {
  ConnectionHandler,
  type ConnectionStatusChangeEvent,
  type ConnectionTestResult,
} from "./connectionHandler";

export { DirectConnectionHandler } from "./directConnectionHandler";

export { LocalConnectionHandler } from "./localConnectionHandler";

export { CCloudConnectionHandler } from "./ccloudConnectionHandler";
