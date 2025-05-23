import { SinonSandbox, SinonStub, SinonStubbedInstance } from "sinon";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../../src/constants";
import {
  CCloudResourceLoader,
  DirectResourceLoader,
  LocalResourceLoader,
  ResourceLoader,
} from "../../src/loaders";
import { ConnectionId } from "../../src/models/resource";
import { TEST_DIRECT_CONNECTION_ID } from "../unit/testResources/connection";

/**
 * The stub for the static `getInstance()` method of the {@link ResourceLoader} class, set within
 * the {@link configureGetInstanceStub} function.
 */
export let getInstanceStub: SinonStub | undefined;

/**
 * Configures the stub for the static `getInstance()` method of the {@link ResourceLoader} class.
 * If the stub already exists, it reuses it and updates the return value.
 *
 * This function is used to stub the `getInstance()` method for a specific connection ID and
 * returns the stubbed instance of the {@link ResourceLoader} class.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @param loader The stubbed instance of the {@link ResourceLoader} class to return.
 * @param connectionId Optional connection ID for which to register the stub.
 */
function configureGetInstanceStub(
  sandbox: SinonSandbox,
  loader: SinonStubbedInstance<
    ResourceLoader | CCloudResourceLoader | LocalResourceLoader | DirectResourceLoader
  >,
  connectionId?: ConnectionId,
): void {
  if (!getInstanceStub) {
    getInstanceStub = sandbox.stub(ResourceLoader, "getInstance");
  }
  // once we have a stub, we just specify the stubbed loader returned for the connectionId
  if (connectionId) {
    getInstanceStub.withArgs(connectionId).returns(loader);
  } else {
    getInstanceStub.returns(loader);
  }
}

/**
 * Creates a stubbed instance of the abstract {@link ResourceLoader} class.
 *
 * NOTE: This function stubs the static `getInstance()` method as well as the abstract methods of
 * the {@link ResourceLoader} class.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @returns A {@link SinonStubbedInstance} of the {@link ResourceLoader} class.
 */
export function getStubbedResourceLoader(
  sandbox: SinonSandbox,
): SinonStubbedInstance<ResourceLoader> {
  const stubbedLoader: SinonStubbedInstance<ResourceLoader> =
    sandbox.createStubInstance(ResourceLoader);
  // add stubs for abstract methods
  stubbedLoader.getEnvironments = sandbox.stub();
  stubbedLoader.getKafkaClustersForEnvironmentId = sandbox.stub();
  stubbedLoader.getSchemaRegistries = sandbox.stub();
  stubbedLoader.getSchemaRegistryForEnvironmentId = sandbox.stub();
  stubbedLoader.getTopicSubjectGroups = sandbox.stub();
  // stub the static method to return the stubbed instance
  configureGetInstanceStub(sandbox, stubbedLoader);
  return stubbedLoader;
}

/**
 * Creates a stubbed instance of the {@link CCloudResourceLoader} class.
 *
 * This function stubs the static `getInstance()` methods of both {@link CCloudResourceLoader}
 * and {@link ResourceLoader} (when called with {@linkcode CCLOUD_CONNECTION_ID}) to return
 * the created stub.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @returns A {@link SinonStubbedInstance} of the {@link CCloudResourceLoader} class.
 */
export function getStubbedCCloudResourceLoader(
  sandbox: SinonSandbox,
): SinonStubbedInstance<CCloudResourceLoader> {
  const stubbedLoader: SinonStubbedInstance<CCloudResourceLoader> =
    sandbox.createStubInstance(CCloudResourceLoader);
  // stub the static methods to return the stubbed instance
  sandbox.stub(CCloudResourceLoader, "getInstance").returns(stubbedLoader);
  configureGetInstanceStub(sandbox, stubbedLoader, CCLOUD_CONNECTION_ID);
  return stubbedLoader;
}

/**
 * Creates a stubbed instance of the {@link LocalResourceLoader} class.
 *
 * This function stubs the static `getInstance()` methods of both {@link LocalResourceLoader}
 * and {@link ResourceLoader} (when called with {@linkcode LOCAL_CONNECTION_ID}) to return
 * the created stub.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @returns A {@link SinonStubbedInstance} of the {@link LocalResourceLoader} class.
 */
export function getStubbedLocalResourceLoader(
  sandbox: SinonSandbox,
): SinonStubbedInstance<LocalResourceLoader> {
  const stubbedLoader: SinonStubbedInstance<LocalResourceLoader> =
    sandbox.createStubInstance(LocalResourceLoader);
  // stub the static methods to return the stubbed instance
  sandbox.stub(LocalResourceLoader, "getInstance").returns(stubbedLoader);
  configureGetInstanceStub(sandbox, stubbedLoader, LOCAL_CONNECTION_ID);
  return stubbedLoader;
}

/**
 * Creates a stubbed instance of the {@link DirectResourceLoader} class.
 *
 * Unlike the CCloud/local loader stub functions, this function does not stub the static
 * `getInstance()` method of the {@link DirectResourceLoader} class, since it is not a singleton.
 * Instead, it only stubs the {@link ResourceLoader} class's static `getInstance()` method to return
 * the created stub based on the provided connection ID or the default {@linkcode TEST_DIRECT_CONNECTION_ID}.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @param connectionId Optional connection ID for which to register the stub. If not provided,
 * the stub will be registered for the {@linkcode TEST_DIRECT_CONNECTION_ID}.
 * @returns A {@link SinonStubbedInstance} of the {@link DirectResourceLoader} class.
 */
export function getStubbedDirectResourceLoader(
  sandbox: SinonSandbox,
  connectionId?: ConnectionId,
): SinonStubbedInstance<DirectResourceLoader> {
  const stubbedLoader: SinonStubbedInstance<DirectResourceLoader> =
    sandbox.createStubInstance(DirectResourceLoader);
  // don't stub DirectResourceLoader.getInstance() since it is not a singleton
  configureGetInstanceStub(sandbox, stubbedLoader, connectionId ?? TEST_DIRECT_CONNECTION_ID);
  return stubbedLoader;
}
