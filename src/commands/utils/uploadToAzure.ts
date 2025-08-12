import { logError } from "../../errors";
import { Logger } from "../../logging";
import { showErrorNotificationWithButtons } from "../../notifications";

const logger = new Logger("commands/utils/uploadToAzure");

export const uploadFileToAzure = async ({
  file,
  presignedUrl,
  contentType,
}: {
  file: File | Blob;
  onUploadProgress?: (percentageDec: number) => void;
  presignedUrl: string;
  contentType: string;
}): Promise<Response> => {
  logger.info("Starting Azure file upload", {
    fileSize: file.size,
    contentType,
    presignedUrlHost: new URL(presignedUrl).host,
  });

  try {
    const response = await fetch(presignedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "x-ms-blob-type": "BlockBlob",
      },
      body: file,
    });

    if (!response.ok) {
      const responseText = await response.text();
      logger.error("Azure upload failed", {
        status: response.status,
        statusText: response.statusText,
        responseBody: responseText,
        headers: Object.fromEntries(response.headers.entries()),
      });
      throw new Error(`Azure upload failed: ${response.status} ${response.statusText}`);
    }

    logger.info("Azure upload successful", {
      status: response.status,
      statusText: response.statusText,
      contentLength: response.headers.get("content-length"),
      etag: response.headers.get("etag"),
    });

    return response;
  } catch (error) {
    logger.error("Azure upload error", error);
    let sentryContext: Record<string, unknown> = {
      extra: {
        fileType: file instanceof File ? file.type : contentType,
        fileSize: file.size,
      },
    };
    logError(error, "Failed to upload file to Azure", sentryContext);
    showErrorNotificationWithButtons("Failed to upload file to Azure. See logs for details.");
    throw error;
  }
};
