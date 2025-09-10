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
    logError(error, "Failed to upload file to Azure", sentryContext);
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
    /** Using POST instead of PUT to support multiple content types.
     * This is required for future Python UDF support where we need to upload
     * multiple file formats in a single request. PUT requests are limited to
     * a single content type, while POST with FormData can handle multiple formats.
     * NOTE: Using manual multipart construction to avoid FormData stream issues in debug mode.
     */

    // Use manual multipart construction to avoid FormData stream issues in debug mode
    // Read file data to avoid stream consumption issues
    const fileArrayBuffer = await file.arrayBuffer();
    // Create multipart/form-data manually to avoid FormData stream issues
    const boundary = `----formdata-boundary-upload-artifact-file-${Date.now()}`;
    const encoder = new TextEncoder();
    let bodyText = "";
    // Add all the form fields
    for (const [key, value] of Object.entries(uploadFormData)) {
      bodyText += `--${boundary}\r\n`;
      bodyText += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
      bodyText += `${value}\r\n`;
    }
    logger.debug(`Added ${Object.keys(uploadFormData).length} form fields`);
    // Add the file
    bodyText += `--${boundary}\r\n`;
    bodyText += `Content-Disposition: form-data; name="file"\r\n`;
    bodyText += `Content-Type: ${contentType}\r\n\r\n`;
    // Convert body to bytes and append file data
    const bodyPrefix = encoder.encode(bodyText);
    const bodySuffix = encoder.encode(`\r\n--${boundary}--\r\n`);
    const requestBody = new Uint8Array(
      bodyPrefix.length + fileArrayBuffer.byteLength + bodySuffix.length,
    );
    requestBody.set(bodyPrefix, 0);
    requestBody.set(new Uint8Array(fileArrayBuffer), bodyPrefix.length);
    requestBody.set(bodySuffix, bodyPrefix.length + fileArrayBuffer.byteLength);

    const response = await fetch(presignedUrl, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body: requestBody,
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
    logError(error, "Failed to upload file to S3", sentryContext);
    void showErrorNotificationWithButtons("Failed to upload file to S3. See logs for details.");
    throw error;
  }
}
