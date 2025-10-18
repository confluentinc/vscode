import type { AuthenticationSession } from "vscode";
import { AUTH_SCOPES } from "../../../src/constants";
import { TEST_CCLOUD_CONNECTION, TEST_CCLOUD_USER } from "./connection";

export const TEST_CCLOUD_AUTH_SESSION: AuthenticationSession = {
  id: TEST_CCLOUD_CONNECTION.id,
  accessToken: TEST_CCLOUD_CONNECTION.id,
  account: {
    id: TEST_CCLOUD_USER.id!,
    label: TEST_CCLOUD_USER.username!,
  },
  scopes: AUTH_SCOPES,
};
