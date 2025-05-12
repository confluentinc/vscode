import { downloadAndUnzipVSCode } from "@vscode/test-electron";

export default async (): Promise<void> => {
  await downloadAndUnzipVSCode("insiders");
  await downloadAndUnzipVSCode("stable");
};
