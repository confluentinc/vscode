// toplevel exports for the sidecarManager module

import { Logger } from "../logging";
import { SidecarHandle } from "./sidecarHandle";
import { SidecarManager } from "./sidecarManager";

export { SidecarHandle } from "./sidecarHandle";

export { sidecarOutputChannel } from "./sidecarManager";

/*
  This is the sidecar manager module. It manages the sidecar process, starting it up, handshaking with it, and configuring
  OpenAPI and GraphQL clients with the sidecar's auth token.

  Expected usage from codepaths needing to make requests to the sidecar:

    const sidecar = await getSidecar();
    const client: TemplatesApi = sidecar.getTemplatesApi();
    // Now start to make requests to the sidecar using the TemplatesService client methods (or any other OpenAPI generated client).

  Or, for GraphQL;

    const sidecar = await getSidecar();
    const result = await sidecar.query<MyQueryResultType>(myQuery, myVariables);


  getSidecar() will return a SidecarHandle object which contains the auth token and process id needed to make requests to the sidecar. It
  will also contain the current connection id as attribute 
  
*/

const logger = new Logger("sidecar.index");
export async function getSidecar(): Promise<SidecarHandle> {
  // Defer to the manager to get a useful, configured handle and all configuration side-effects fired off
  // to a running sidecar process.

  const manager: SidecarManager = SidecarManager.getInstance();
  logger.info("Returning new handle from SidecarManager");
  return await manager.getHandle();
}
