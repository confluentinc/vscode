import { logError } from "../../errors";
import { Logger } from "../../logging";
import { showErrorNotificationWithButtons } from "../../notifications";

const logger = new Logger("commands/utils/uploadToProvider");

export async function uploadFileToAzure({
  file,
  presignedUrl,
  contentType,
}: {
  file: File | Blob;
  onUploadProgress?: (percentageDec: number) => void;
  presignedUrl: string;
  contentType: string;
}): Promise<Response> {
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
    const sentryContext: Record<string, unknown> = {
      extra: {
        fileType: file instanceof File ? file.type : contentType,
        fileSize: file.size,
      },
    };
    void logError(error, "Failed to upload file to Azure", sentryContext);
    void showErrorNotificationWithButtons("Failed to upload file to Azure. See logs for details.");
    throw error;
  }
}

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
  // non-sensitive form data values for logging
  const formDataDebugValues = {
    bucket: uploadFormData.bucket,
    key: uploadFormData.key,
    acl: uploadFormData.acl,
    successActionStatus: uploadFormData.success_action_status,
  };

  logger.info("Starting S3 file upload", {
    fileSize: file.size,
    contentType,
    presignedUrlHost: new URL(presignedUrl).host,
    ...formDataDebugValues,
  });

  try {
    /** Using FormData with POST instead of PUT to support multiple content types.
     * This is required for future Python UDF support where we need to upload
     * multiple file formats in a single request. PUT requests are limited to
     * a single content type, while POST with FormData can handle multiple formats.
     */
    const formData = new FormData();
    // add all the form fields from the presigned URL
    Object.keys(uploadFormData).forEach((key) => {
      formData.append(key, uploadFormData[key]);
    });
    logger.debug(`Added ${Object.keys(uploadFormData).length} formData fields`);
    formData.append("file", file);

    const response = await fetch(presignedUrl, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`${response.status} ${response.statusText}`);
      Object.assign(error, { responseText: errorText });
      throw error;
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
        ...formDataDebugValues,
        ...{ responseBody: (error as any)?.responseText }, // include the full XML response
      },
    };
    void logError(error, "Failed to upload file to S3", sentryContext);
    void showErrorNotificationWithButtons("Failed to upload file to S3. See logs for details.");
    throw error;
  }
}
