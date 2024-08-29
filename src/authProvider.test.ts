import * as assert from "assert";
import * as vscode from "vscode";
import { getExtensionContext } from "../tests/unit/testUtils";
import { ConfluentCloudAuthProvider, getAuthProvider } from "./authProvider";
import { getUriHandler, UriEventHandler } from "./uriHandler";

const AUTH_CALLBACK_URI = vscode.Uri.parse("vscode://confluentinc.vscode-confluent/authCallback");

describe("ConfluentCloudAuthProvider", () => {
  let authProvider: ConfluentCloudAuthProvider;
  let uriHandler: UriEventHandler;

  before(async () => {
    await getExtensionContext();
    authProvider = getAuthProvider();
    uriHandler = getUriHandler();
  });

  it("should reject the waitForUriHandling promise when the URI query contains 'success=false'", async () => {
    const promise = authProvider.waitForUriHandling();

    const uri = AUTH_CALLBACK_URI.with({ query: "success=false" });
    uriHandler.handleUri(uri);

    await promise.catch((err) => {
      assert.equal(err.message, "Authentication failed, see browser for details");
    });
  });

  it("should resolve the waitForUriHandling promise when the URI query contains 'success=true'", async () => {
    const promise = authProvider.waitForUriHandling();

    const uri = AUTH_CALLBACK_URI.with({ query: "success=true" });
    uriHandler.handleUri(uri);

    await promise.then((result) => {
      assert.equal(result, undefined);
    });
  });
});
