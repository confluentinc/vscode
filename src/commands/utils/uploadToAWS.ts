import { logError } from "../../errors";
import { Logger } from "../../logging";
import { showErrorNotificationWithButtons } from "../../notifications";

const logger = new Logger("commands/utils/uploadToAWS");

export async function uploadFileToAWS({
  file,
  presignedUrl,
  contentType,
  uploadFormData,
}: {
  file: File | Blob;
  presignedUrl: string;
  contentType: string;
  uploadFormData: { [key: string]: string };
}): Promise<Response> {
  logger.info("Starting AWS file upload", {
    fileSize: file.size,
    contentType,
    presignedUrlHost: new URL(presignedUrl).host,
    formDataKeys: Object.keys(uploadFormData),
  });

  try {
    const formData = new FormData();
    // Add all the form fields from the presigned URL
    Object.keys(uploadFormData).forEach((key) => {
      formData.append(key, uploadFormData[key]);
    });
    logger.debug("Added form fields", {
      formDataKeys: Object.keys(uploadFormData),
    });
    formData.append("file", file);

    logger.info("Starting AWS file upload", {
      fileSize: file.size,
      contentType,
      presignedUrlHost: new URL(presignedUrl).host,
    });

    const response = await fetch(presignedUrl, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const responseText = await response.text();
      logger.error("AWS upload failed", {
        status: response.status,
        statusText: response.statusText,
        responseBody: responseText,
        headers: Object.fromEntries(response.headers.entries()),
      });
      const errorMessage = responseText.trim()
        ? `AWS upload failed: ${response.status} ${response.statusText} - ${responseText}`
        : `AWS upload failed: ${response.status} ${response.statusText}`;
      throw new Error(errorMessage);
    }

    logger.info("AWS upload successful", {
      status: response.status,
      statusText: response.statusText,
      contentLength: response.headers.get("content-length"),
      etag: response.headers.get("etag"),
    });

    return response;
  } catch (error) {
    logger.error("AWS upload error", error);
    const sentryContext: Record<string, unknown> = {
      extra: {
        fileType: file instanceof File ? file.type : contentType,
        fileSize: file.size,
        formDataKeys: Object.keys(uploadFormData),
      },
    };
    logError(error, "Failed to upload file to AWS", sentryContext);
    void showErrorNotificationWithButtons("Failed to upload file to AWS. See logs for details.");
    throw error;
  }
}
