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
 * Configures the stubs for the static methods of the {@link ResourceLoader} class:
 * - `getInstance()`: Stubs the static method to return the provided loader instance.
 * - `loaders()`: Stubs the static method to return an array of stubbed loaders.
 * If the stubs already exists, it reuses them and updates their return values.
 *
 * @param sandbox The {@link SinonSandbox} to use for creating stubs.
 * @param loader The stubbed instance of the {@link ResourceLoader} class to return.
 * @param connectionId Optional connection ID for which to register the stub.
 */
function configureResourceLoaderMethods(
  sandbox: SinonSandbox,
  loader: SinonStubbedInstance<
    ResourceLoader | CCloudResourceLoader | LocalResourceLoader | DirectResourceLoader
  >,
  connectionId?: ConnectionId,
): void {
  // check if `ResourceLoader.getInstance()` has already been stubbed
  let getInstanceStub: SinonStub | undefined = ResourceLoader.getInstance as SinonStub;
  if (!(getInstanceStub && getInstanceStub.restore !== undefined)) {
    // Create a new stub for `getInstance()`
    getInstanceStub = sandbox.stub(ResourceLoader, "getInstance");
  }
  // once we have a getInstance stub, either specify the stubbed loader returned for the provided
  // connectionId or return the loader for the default case
  if (connectionId) {
    getInstanceStub.withArgs(connectionId).returns(loader);
  } else {
    getInstanceStub.returns(loader);
  }

  // same check for `ResourceLoader.loaders()`
  let loadersStub: SinonStub | undefined = ResourceLoader.loaders as SinonStub;
  if (!(loadersStub && loadersStub.restore !== undefined)) {
    // create a new stub for `loaders()`
    loadersStub = sandbox.stub(ResourceLoader, "loaders").returns([]);
  }
  // check the return value of the loadersStub and update it if necessary
  let stubbedLoaders: Array<
    SinonStubbedInstance<
      ResourceLoader | CCloudResourceLoader | LocalResourceLoader | DirectResourceLoader
    >
  > = loadersStub();
  // make sure the call count is reset to 0 in case any tests want to assert on it
  loadersStub.resetHistory();
  if (!stubbedLoaders.includes(loader)) {
    stubbedLoaders.push(loader);
  }
  loadersStub.returns(stubbedLoaders);
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
  configureResourceLoaderMethods(sandbox, stubbedLoader);
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
  // Add stub for the new getFlinkArtifacts method
  stubbedLoader.getFlinkArtifacts = sandbox.stub();
  // stub the static methods to return the stubbed instance
  sandbox.stub(CCloudResourceLoader, "getInstance").returns(stubbedLoader);
  configureResourceLoaderMethods(sandbox, stubbedLoader, CCLOUD_CONNECTION_ID);
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
  configureResourceLoaderMethods(sandbox, stubbedLoader, LOCAL_CONNECTION_ID);
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
  configureResourceLoaderMethods(sandbox, stubbedLoader, connectionId ?? TEST_DIRECT_CONNECTION_ID);
  return stubbedLoader;
}
