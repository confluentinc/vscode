import { SinonSandbox, SinonStubbedInstance } from "sinon";

import * as sidecar from "../../src/sidecar";

/**
 * Wire up getSidecar() to return a stubbed instance of SidecarHandle, the one returned here for the
 * caller to further configure as needed.
 **/
export function getSidecarStub(sandbox: SinonSandbox): SinonStubbedInstance<sidecar.SidecarHandle> {
  const sidecarStub = sandbox.createStubInstance(sidecar.SidecarHandle);
  sandbox.stub(sidecar, "getSidecar").resolves(sidecarStub);

  return sidecarStub;
}
