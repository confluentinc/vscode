import { logError } from "../../errors";
import { showErrorNotificationWithButtons } from "../../notifications";

export const uploadFileToAzure = async ({
  file,
  presignedUrl,
}: {
  file: File;
  onUploadProgress?: (percentageDec: number) => void;
  presignedUrl: string;
}): Promise<void> => {
  try {
    const response = await fetch(presignedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
        "x-ms-blob-type": "BlockBlob",
      },
      body: file,
    });
    const data = await response.json();
    return data;
  } catch (error) {
    let sentryContext: Record<string, unknown> = {
      extra: { fileType: file.type },
    };
    logError(error, "CCloud status", sentryContext);
    showErrorNotificationWithButtons("Failed to upload file to Azure. See logs for details.");
  }
};
