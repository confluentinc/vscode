import { logError } from "../../errors";
import { Logger } from "../../logging";
import { showErrorNotificationWithButtons } from "../../notifications";

const logger = new Logger("commands/utils/uploadToAWS");

export async function uploadFileToS3({
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
  logger.info("Starting S3 file upload", {
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

    logger.info("Starting S3 file upload", {
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
      logger.error("S3 upload failed", {
        status: response.status,
        statusText: response.statusText,
        responseBody: responseText,
        headers: Object.fromEntries(response.headers.entries()),
      });
      const errorMessage = responseText.trim()
        ? `S3 upload failed: ${response.status} ${response.statusText} - ${responseText}`
        : `S3 upload failed: ${response.status} ${response.statusText}`;
      throw new Error(errorMessage);
    }

    logger.info("S3 upload successful", {
      status: response.status,
      statusText: response.statusText,
      contentLength: response.headers.get("content-length"),
      etag: response.headers.get("etag"),
    });

    return response;
  } catch (error) {
    logger.error("S3 upload error", error);
    const sentryContext: Record<string, unknown> = {
      extra: {
        fileType: file instanceof File ? file.type : contentType,
        fileSize: file.size,
        formDataKeys: Object.keys(uploadFormData),
      },
    };
    logError(error, "Failed to upload file to S3", sentryContext);
    void showErrorNotificationWithButtons("Failed to upload file to S3. See logs for details.");
    throw error;
  }
}
