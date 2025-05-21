import * as assert from "assert";
import "mocha";
import { getSidecarLogfilePath } from "../sidecar/logging";
import { WriteableTmpDir } from "../utils/file";
import { constructSidecarEnv } from "./sidecarManager";

describe("constructSidecarEnv tests", () => {
  before(async () => {
    // Ensure the tmpdir is established
    await WriteableTmpDir.getInstance().determine();
  });

  it("Will set QUARKUS_HTTP_HOST if env indicates WSL", () => {
    const env = { WSL_DISTRO_NAME: "Ubuntu" };
    const result = constructSidecarEnv(env);
    assert.strictEqual(result.QUARKUS_HTTP_HOST, "0.0.0.0");
  });

  it("Will not set QUARKUS_HTTP_HOST if env does not indicate WSL", () => {
    const env = {};
    const result = constructSidecarEnv(env);
    assert.strictEqual(result.QUARKUS_HTTP_HOST, undefined);
  });

  it("Sets logging env vars as expected", () => {
    const env = {};
    const result = constructSidecarEnv(env);
    assert.strictEqual(result.QUARKUS_LOG_FILE_ENABLE, "true");
    assert.strictEqual(result.QUARKUS_LOG_FILE_ROTATION_ROTATE_ON_BOOT, "false");
    assert.strictEqual(result.QUARKUS_LOG_FILE_PATH, getSidecarLogfilePath());
  });

  it("Other preset env vars are set as expected", () => {
    const env = { FOO: "bar" };
    const result = constructSidecarEnv(env);
    assert.strictEqual("bar", result.FOO);
  });
});
