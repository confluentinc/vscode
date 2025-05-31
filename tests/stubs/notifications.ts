import { SinonSandbox } from "sinon";
import * as notifications from "../../src/notifications";

/**
 * Stub for the `showErrorNotificationWithButtons` function.
 */
export function getShowErrorNotificationWithButtonsStub(sandbox: SinonSandbox) {
  return sandbox.stub(notifications, "showErrorNotificationWithButtons");
}
