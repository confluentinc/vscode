import * as assert from "assert";
import * as vscode from "vscode";
import { getAndActivateExtension, getTestExtensionContext } from "../tests/unit/testUtils";
import { ConfluentCloudAuthProvider } from "./authn/ccloudProvider";
import {
  clearExtensionContext,
  getExtensionContext,
  setExtensionContext,
} from "./context/extension";
import { ExtensionContextNotSetError } from "./errors";
import { getRefreshableViewProviders } from "./extension";
import { StorageManager } from "./storage";
import { ResourceManager } from "./storage/resourceManager";
import { ResourceViewProvider } from "./viewProviders/resources";
import { SchemasViewProvider } from "./viewProviders/schemas";
import { TopicViewProvider } from "./viewProviders/topics";

describe("Base Extension Test", () => {
  it("should activate the extension", async () => {
    await getAndActivateExtension();
  });
});

describe("ExtensionContext", () => {
  // we don't have any good way of actually deactivating an extension instance, so we have to reset
  // the extension context (and any singleton instances) for this test suite
  let origExtensionContext: vscode.ExtensionContext | undefined;

  before(() => {
    origExtensionContext = getExtensionContext();
    clearExtensionContext();
  });

  after(() => {
    if (origExtensionContext) {
      setExtensionContext(origExtensionContext);
    }
  });

  it("should not allow ExtensionContext-dependent singletons to be created before extension activation", async () => {
    const extensionContextSingletons = [
      {
        callable: () => ResourceViewProvider.getInstance(),
        source: "ResourceViewProvider",
        clear: () => (ResourceViewProvider["instance"] = null),
      },
      {
        callable: () => TopicViewProvider.getInstance(),
        source: "TopicViewProvider",
        clear: () => (TopicViewProvider["instance"] = null),
      },
      {
        callable: () => SchemasViewProvider.getInstance(),
        source: "SchemasViewProvider",
        clear: () => (SchemasViewProvider["instance"] = null),
      },
      {
        callable: () => ConfluentCloudAuthProvider.getInstance(),
        source: "ConfluentCloudAuthProvider",
        clear: () => (ConfluentCloudAuthProvider["instance"] = null),
      },
      {
        callable: () => StorageManager.getInstance(),
        source: "StorageManager",
        clear: () => (StorageManager["instance"] = null),
      },
      {
        callable: () => ResourceManager.getInstance(),
        source: "ResourceManager",
        clear: () => (ResourceManager["instance"] = null),
      },
    ];

    extensionContextSingletons.forEach(({ callable, source, clear }) => {
      clear();
      assertThrowsExtensionContextNotSetError(callable, source);
    });

    // activate the extension and setExtensionContext()
    await getTestExtensionContext();

    extensionContextSingletons.forEach(({ callable, source }) => {
      assertDoesNotThrowExtensionContextNotSetError(callable, source);
    });
  });

  /** Assert {@link ExtensionContextNotSetError} was thrown from a specific source. */
  function assertThrowsExtensionContextNotSetError(callable: () => void, source: string) {
    assert.throws(callable, ExtensionContextNotSetError, `${source}: ExtensionContext not set yet`);
  }

  /** Assert {@link ExtensionContextNotSetError} was not thrown from a specific source. */
  function assertDoesNotThrowExtensionContextNotSetError(callable: () => void, source: string) {
    assert.doesNotThrow(
      callable,
      ExtensionContextNotSetError,
      `${source}: ExtensionContext not set yet`,
    );
  }
});

describe("Refreshable views tests", () => {
  /**
   * The view controller `kind` values for the refreshable view controllers and should have had
   * refresh commands registered for them / returned by getRefreshableViewProviders().
   *
   * When a new one is added, its `kind` attribute value should be added to this list.
   */
  const expectedKinds = ["resources", "topics", "schemas", "statements"];

  before(async () => {
    await getTestExtensionContext();
  });

  it("getRefreshableViewProviders returns the expected unique view providers / kinds", () => {
    const seenKinds = new Set<string>();
    const seenViewProviderConstructorNames = new Set<string>();

    const refreshableViewProviders = getRefreshableViewProviders();

    assert.strictEqual(
      refreshableViewProviders.length,
      expectedKinds.length,
      `Expected ${expectedKinds.length} refreshable view providers, but found ${refreshableViewProviders.length}`,
    );

    for (const instance of refreshableViewProviders) {
      assert.ok(
        !seenKinds.has(instance.kind),
        `Duplicate kind "${instance.kind}" found in refreshable view providers`,
      );
      seenKinds.add(instance.kind);

      assert.ok(
        !seenViewProviderConstructorNames.has(instance.constructor.name),
        `Duplicate view provider constructor "${instance.constructor.name}" found`,
      );
      seenViewProviderConstructorNames.add(instance.constructor.name);
    }
  });

  it("_activateExtension should have registered refresh commands for expected view providers", async () => {
    const allRegisteredCommands = await vscode.commands.getCommands();

    for (const kind of expectedKinds) {
      const refreshCommand = allRegisteredCommands.find(
        (cmd) => cmd === `confluent.${kind}.refresh`,
      );
      assert.ok(
        refreshCommand,
        `Command confluent.${kind}.refresh not registered; did activate() run correctly?`,
      );

      // ensure the refresh command works w/o raising error / was able to return
      // boolean true result.
      const result = await vscode.commands.executeCommand(refreshCommand);
      assert.ok(result, `Command ${refreshCommand} failed to execute cleanly`);
    }
  });
});

describe("Extension manifest tests", () => {
  let context: vscode.ExtensionContext;

  before(async () => {
    context = await getTestExtensionContext();
  });

  it("should show the correct version format", async () => {
    const version = context.extension.packageJSON.version;
    // if this fails, it's including additional characters that don't match the semver format
    // e.g. "v0.1.0" instead of "0.1.0"
    if (!process.env.CI) {
      // allow the hex string suffixes for local development
      assert.ok(
        /^\d+\.\d+\.\d+(-\d+)?(\+[0-9a-f]+)?$/.test(version),
        `Version "${version}" is not in the correct format (major.minor.patch[-micro][+suffix])`,
      );
    } else {
      assert.ok(
        /^\d+\.\d+\.\d+(-\d+)?$/.test(version),
        `Version "${version}" is not in the correct format (major.minor.patch[-micro])`,
      );
    }
  });

  // not checking any command functionality, just that the commands are registered during activation
  // and that we don't have any commands in package.json that aren't registered/used
  it("should register all commands defined in package.json's contributes.commands", async () => {
    // everything available in VSCode after the extension is activated (including built-in commands)
    const allRegisteredCommands = await vscode.commands.getCommands();
    const registeredCommands = allRegisteredCommands.filter((cmd) => cmd.startsWith("confluent."));

    // just the commands in package.json `contributes.commands` that we're expecting to be registered
    const manifestCommandIds = context.extension.packageJSON.contributes.commands.map(
      (cmd: any) => cmd.command,
    );

    // check for commands that are registered but not in package.json
    const extraCommands = registeredCommands.filter(
      (cmd: any) => !manifestCommandIds.includes(cmd),
    );
    assert.strictEqual(
      extraCommands.length,
      0,
      `Commands missing from package.json: ${JSON.stringify(extraCommands, null, 2)}`,
    );

    // check for commands in package.json that aren't registered during activate()
    const missingCommands = manifestCommandIds.filter(
      (cmd: any) => !registeredCommands.includes(cmd),
    );
    assert.strictEqual(
      missingCommands.length,
      0,
      `Commands that need to be registered during activate(): ${JSON.stringify(missingCommands, null, 2)}`,
    );
  });
});

describe("ExtensionContext subscription tests", () => {
  let context: vscode.ExtensionContext;

  before(async () => {
    context = await getTestExtensionContext();
  });

  it("should have at least one subscription", async () => {
    assert.ok(
      context.subscriptions.length > 0,
      "No subscriptions found; did activate() run correctly?",
    );
  });
});
