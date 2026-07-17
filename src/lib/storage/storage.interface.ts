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
}
