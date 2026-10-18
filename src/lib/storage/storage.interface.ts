export interface StorageInterface {
  /**
   * Upload a file and return its public URL and storage key.
   */
  upload(file: Express.Multer.File): Promise<{ url: string; key: string }>;

  /**
   * Delete a file by its storage key.
   */
  delete(key: string): Promise<void>;

  /**
   * Get the public URL for a given storage key.
   */
  getPublicUrl(key: string): string;

  /**
   * Upload a call recording securely with custom key and content type.
   */
  uploadRecording?(
    fileBuffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<{ key: string }>;

  /**
   * Get a presigned URL for secure access.
   */
  getPresignedUrl?(key: string, expiresInSeconds?: number): Promise<string>;

  /**
   * Inspect object metadata in storage.
   */
  getObjectMetadata?(
    key: string,
  ): Promise<{ exists: boolean; size?: number; contentType?: string; etag?: string }>;

  /**
   * Get a readable stream for a file, optionally for an HTTP byte range.
   */
  getFileStream?(
    key: string,
    range?: string,
  ): Promise<{
    stream: any;
    contentType?: string;
    contentLength?: number;
    contentRange?: string;
    acceptRanges?: string;
    statusCode?: number;
  }>;
}
