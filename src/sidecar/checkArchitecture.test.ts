import * as assert from "assert";
import "mocha";

import { join } from "path";
import { checkSidecarOsAndArch, getSidecarPlatformArch, PlatformArch } from "./checkArchitecture";

const binariesDir = join(__dirname, "..", "..", "..", "tests", "unit", "sidecarExecutableHeaders");

const platformArchToBinaryName: Map<string, string> = new Map([
  ["linux-x64", join(binariesDir, "linux-amd64")],
  ["linux-arm64", join(binariesDir, "linux-arm64")],
  ["darwin-x64", join(binariesDir, "osx-amd64")],
  ["darwin-arm64", join(binariesDir, "osx-aarch64")],
  ["win32-x64", join(binariesDir, "windows-x64")],
]);

describe("getSidecarPlatformArch", () => {
  it("should return the correct platform and architecture for a Linux+amd sidecar", () => {
    const path = platformArchToBinaryName.get("linux-x64");
    const platformArch = getSidecarPlatformArch(path!);
    assert.deepStrictEqual(platformArch, new PlatformArch("linux", "x64"));
  });

  it("should return the correct platform and architecture for a Linux+arm sidecar", () => {
    const path = platformArchToBinaryName.get("linux-arm64");
    const platformArch = getSidecarPlatformArch(path!);
    assert.deepStrictEqual(platformArch, new PlatformArch("linux", "arm64"));
  });

  it("should return the correct platform and architecture for a OSX+amd sidecar", () => {
    const path = platformArchToBinaryName.get("darwin-x64");
    const platformArch = getSidecarPlatformArch(path!);
    assert.deepStrictEqual(platformArch, new PlatformArch("darwin", "x64"));
  });

  it("should return the correct platform and architecture for a OSX+aarch64 sidecar", () => {
    const path = platformArchToBinaryName.get("darwin-arm64");
    const platformArch = getSidecarPlatformArch(path!);
    assert.deepStrictEqual(platformArch, new PlatformArch("darwin", "arm64"));
  });

  it("should return the correct platform and architecture for a Windows+x64 sidecar", () => {
    const path = platformArchToBinaryName.get("win32-x64");
    const platformArch = getSidecarPlatformArch(path!);
    assert.deepStrictEqual(platformArch, new PlatformArch("win32", "x64"));
  });
});

describe("checkSidecarOsAndArch", () => {
  it("Should not throw exception against correct binary", () => {
    const thisPlatformArch = new PlatformArch(process.platform, process.arch);
    const properBinaryName = platformArchToBinaryName.get(
      `${thisPlatformArch.platform}-${thisPlatformArch.arch}`,
    );

    checkSidecarOsAndArch(properBinaryName!);
  });

  it("Should throw error with incorrect binary", () => {
    // pick wrong platform's binary
    const thisPlatformArch = new PlatformArch(process.platform, process.arch);
    let wrongPlatform: string;
    if (thisPlatformArch.platform === "linux") {
      wrongPlatform = "darwin";
    } else {
      wrongPlatform = "linux";
    }
    const wrongBinaryName = platformArchToBinaryName.get(
      `${wrongPlatform}-${thisPlatformArch.arch}`,
    );

    assert.throws(() => checkSidecarOsAndArch(wrongBinaryName!), Error);
  });
});
