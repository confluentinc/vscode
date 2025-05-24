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
 * the {@link configureResourceLoaderMethods} function.
 */
let getInstanceStub: SinonStub | undefined;

/**
 * The stub for the static `loaders()` method of the {@link ResourceLoader} class, set within
 * the {@link configureResourceLoaderMethods} function.
 */
let loadersStub: SinonStub | undefined;

/**
 * An array of stubbed instances of the {@link ResourceLoader} class, used to return the stubbed
 * loaders when the static `loaders()` method is called.
 */
let stubbedLoaders: SinonStubbedInstance<
  ResourceLoader | CCloudResourceLoader | LocalResourceLoader | DirectResourceLoader
>[] = [];

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
  if (!getInstanceStub) {
    getInstanceStub = sandbox.stub(ResourceLoader, "getInstance");
  }
  if (!loadersStub) {
    loadersStub = sandbox.stub(ResourceLoader, "loaders");
  }

  // once we have a getInstance stub, either specify the stubbed loader returned for the provided
  // connectionId or return the loader for the default case
  if (connectionId) {
    getInstanceStub.withArgs(connectionId).returns(loader);
  } else {
    getInstanceStub.returns(loader);
  }

  // no need to use .withArgs() for the loaders() stub since it returns all loaders
  if (!stubbedLoaders.includes(loader)) {
    stubbedLoaders.push(loader);
  }
  loadersStub.returns(stubbedLoaders);
}

/**
 * Resets the stubs for the static methods of the {@link ResourceLoader} class.
 *
 * This function restores the stubs for the static `getInstance()` and `loaders()` methods of the
 * {@link ResourceLoader} class, and clears
 * the array of stubbed loaders.
 * It should be called after each test to ensure that the stubs do not interfere with other tests.
 */
export function resetResourceLoaderStubs(): void {
  if (getInstanceStub) {
    getInstanceStub.restore();
    getInstanceStub = undefined;
  }
  if (loadersStub) {
    loadersStub.restore();
    loadersStub = undefined;
  }
  stubbedLoaders = [];
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
