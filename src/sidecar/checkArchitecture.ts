// Determine the platform + archictecture of the sidecar binary and compare it to the current platform + architecture.

import fs from "fs";
import { env, Uri, window } from "vscode";
import { Logger } from "../logging";
import { titleCase } from "../utils";

const logger = new Logger("sidecar.diagnoseErrors");

export function checkSidecarOsAndArch(sidecarPath: string): void {
  // If our OS + Arch != sidecar OS + Arch, then throw an error with a helpful message.
  const ourBuild = new PlatformArch(process.platform, process.arch);
  const sidecarBuild = getSidecarPlatformArch(sidecarPath);
  logger.debug("platform+arch check complete", { ourBuild, sidecarBuild });

  if (!ourBuild.equals(sidecarBuild)) {
    const errorMsg = `This Confluent extension is built for a different platform (${sidecarBuild.platform}-${sidecarBuild.arch}), whereas your VS Code is on ${ourBuild.platform}-${ourBuild.arch}.`;
    const button = "Open Marketplace";
    window.showErrorMessage(errorMsg, button).then((action) => {
      if (action === button) {
        env.openExternal(Uri.parse("vscode:extension/confluentinc.vscode-confluent"));
      }
    });
    throw new Error(errorMsg);
  }
}

export class PlatformArch {
  platform: string;
  arch: string;

  constructor(platform: string, arch: string) {
    this.platform = platform;
    this.arch = arch;
  }

  equals(other: PlatformArch) {
    return this.platform === other.platform && this.arch === other.arch;
  }

  toString() {
    let os = this.platform;
    if (os === "darwin") {
      os = "OS X (Darwin)";
    } else {
      // titlecase either windows or linux
      os = titleCase(os);
    }

    let arch = this.arch;
    // Be more descriptive for ARM on macOS
    if (this.platform === "darwin" && arch === "arm64") {
      arch += " (Apple Silicon)";
    }

    return `${os} on ${arch}`;
  }
}

export function getSidecarPlatformArch(path: string): PlatformArch {
  // read the first 4 bytes to get the magic number and determine (win/linux/mac)
  const platformMagicNumber = readBuffer(path, 4).toString("hex");
  const sidecarPlatform = getSidecarBuildPlatform(platformMagicNumber);

  logger.debug(`sidecar platform: ${sidecarPlatform} from magic number ${platformMagicNumber}`);

  let sidecarArch: string = "";
  switch (sidecarPlatform) {
    case "linux":
      sidecarArch = getSidecarLinuxArch(path);
      break;
    case "darwin":
      sidecarArch = getSidecarMacOSArch(path);
      break;
    case "win32":
      // We only support AMD64 for now.
      sidecarArch = "x64";
      break;
    default:
      sidecarArch = "Unknown";
  }
  logger.debug(`sidecar arch: ${sidecarArch}`);

  return new PlatformArch(sidecarPlatform, sidecarArch);
}

function getSidecarBuildPlatform(magicNumber: string): string {
  // For Windows, we check the first 2 bytes, hence 4 hex chars
  if (magicNumber.substring(0, 4) === PLATFORM_MAGIC_NUMBERS.windows) {
    // See https://nodejs.org/api/process.html#processplatform
    // It's always "win32" for Windows, regardless of the architecture.
    return "win32";
  }

  switch (magicNumber) {
    case PLATFORM_MAGIC_NUMBERS.linux:
      return "linux";
    case PLATFORM_MAGIC_NUMBERS.mach_o:
      return "darwin";
    default:
      return "unknown";
  }
}

function getSidecarLinuxArch(path: string): string {
  const buffer = readBuffer(path, 19);
  const e_machine = buffer.readUInt8(18);
  logger.debug(`e_machine: ${e_machine}`);
  switch (e_machine) {
    case 0x3e:
      return "x64";
    case 0xb7:
      return "arm64";
    default:
      return "unknown";
  }
}

function getSidecarMacOSArch(path: string): string {
  const buffer = readBuffer(path, 5);
  const archByte = buffer.readUInt8(4);
  logger.debug(`archByte: ${archByte}`);
  switch (archByte) {
    case 0x07:
      return "x64";
    case 0x0c:
      return "arm64";
    default:
      return "unknown";
  }
}

function readBuffer(path: string, length: number): Buffer {
  if (length <= 0) {
    throw new Error(`Number of bytes to read must be greater than 0. Got ${length}`);
  }
  const fileDescriptor = fs.openSync(path, "r");
  const buffer = Buffer.alloc(length);
  fs.readSync(fileDescriptor, buffer, 0, length, 0);
  fs.closeSync(fileDescriptor);

  return buffer;
}

const PLATFORM_MAGIC_NUMBERS = {
  windows: "4d5a", // PE
  linux: "7f454c46", // ELF
  mach_o: "cffaedfe", // Mach-O
};
