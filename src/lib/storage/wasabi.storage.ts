import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageInterface } from './storage.interface';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

export class WasabiStorage implements StorageInterface {
  private client: S3Client;
  private bucket: string;
  private rootPrefix: string;
  private publicUrlBase: string;

  constructor() {
    const endpoint = process.env.WASABI_ENDPOINT || 'https://s3.wasabisys.com';
    const region = process.env.WASABI_REGION || 'us-east-1';
    this.bucket = process.env.WASABI_BUCKET || '';
    const accessKeyId =
      process.env.WASABI_ACCESS_KEY || process.env.WASABI_ACCESS_KEY_ID || '';
    const secretAccessKey =
      process.env.WASABI_SECRET_KEY || process.env.WASABI_SECRET_ACCESS_KEY || '';
    this.rootPrefix = process.env.WASABI_ROOT_PREFIX || 'Seeak App Data/';
    this.publicUrlBase = process.env.WASABI_PUBLIC_URL || `${endpoint}/${this.bucket}/`;

    if (!endpoint || !this.bucket || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing Wasabi configuration in environment variables.');
    }

    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // required for Wasabi usually
    });
  }

  async upload(file: Express.Multer.File): Promise<{ url: string; key: string }> {
    const extension = path.extname(file.originalname);
    const filename = `${uuidv4()}${extension}`;
    const key = `${this.rootPrefix}${filename}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read', // assuming the bucket allows public-read
    });

    await this.client.send(command);

    return {
      url: this.getPublicUrl(key),
      key,
    };
  }

  /**
   * Uploads a call recording with a deterministic key and strict private permissions.
   * Does NOT use ACL: public-read.
   */
  async uploadRecording(
    fileBuffer: Buffer,
    key: string,
    mimeType: string,
  ): Promise<{ key: string }> {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await this.client.send(command);
    return { key: cleanKey };
  }

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  getPublicUrl(key: string): string {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    // Encode the key so spaces and special characters are handled correctly
    // Return relative path so the frontend can resolve it properly based on its environment
    return `/api/upload/${encodeURIComponent(cleanKey)}`;
  }

  async getPresignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    const ttl =
      expiresInSeconds ||
      Number(process.env.WASABI_SIGNED_URL_TTL_SECONDS) ||
      3600;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });
    return await getSignedUrl(this.client, command, { expiresIn: ttl });
  }

  async getObjectMetadata(
    key: string,
  ): Promise<{ exists: boolean; size?: number; contentType?: string; etag?: string }> {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: cleanKey,
      });
      const response = await this.client.send(command);
      return {
        exists: true,
        size: response.ContentLength,
        contentType: response.ContentType,
        etag: response.ETag,
      };
    } catch (err: any) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        return { exists: false };
      }
      throw err;
    }
  }

  async getFileStream(
    key: string,
    range?: string,
  ): Promise<{
    stream: any;
    contentType?: string;
    contentLength?: number;
    contentRange?: string;
    acceptRanges?: string;
    statusCode?: number;
  }> {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
      Range: range,
    });
    const response = await this.client.send(command);
    return {
      stream: response.Body,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      contentRange: response.ContentRange,
      acceptRanges: response.AcceptRanges || 'bytes',
      statusCode: range && response.ContentRange ? 206 : 200,
    };
  }

  /**
   * Deletes all call recording objects in Wasabi belonging to a specific workspace.
   * Scoped strictly to the workspace prefix: <WASABI_ROOT_PREFIX>recordings/<workspaceId>/
   * Plus any explicitly referenced recording keys for that workspace.
   * Never deletes across workspaces or the root bucket.
   */
  async deleteWorkspaceRecordings(
    workspaceId: string,
    additionalKeys: string[] = [],
  ): Promise<{ deletedCount: number; keys: string[] }> {
    const cleanWorkspace = (workspaceId || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
    if (!cleanWorkspace) {
      throw new Error("Invalid workspaceId for Wasabi recordings deletion: must be non-empty.");
    }

    const recordingsPrefix = (
      process.env.WASABI_RECORDINGS_PREFIX ||
      `${process.env.WASABI_ROOT_PREFIX || "Seeak App Data/"}recordings/`
    ).replace(/^\/+/, "");

    const targetPrefix = `${recordingsPrefix}${cleanWorkspace}/`;
    const keysToDeleteSet = new Set<string>();

    // 1. List all objects matching prefix
    let continuationToken: string | undefined = undefined;
    do {
      const listCommand: ListObjectsV2Command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: targetPrefix,
        ContinuationToken: continuationToken,
      });
      const listRes = await this.client.send(listCommand);

      if (listRes.Contents && listRes.Contents.length > 0) {
        for (const obj of listRes.Contents) {
          if (obj.Key && obj.Key.startsWith(targetPrefix)) {
            keysToDeleteSet.add(obj.Key);
          }
        }
      }
      continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
    } while (continuationToken);

    // 2. Add additionalKeys confirmed to belong strictly to this workspace
    for (const rawKey of additionalKeys) {
      if (!rawKey) continue;
      let cleanKey = rawKey;
      if (cleanKey.startsWith("/api/upload/")) {
        cleanKey = decodeURIComponent(cleanKey.replace("/api/upload/", ""));
      }
      cleanKey = cleanKey.startsWith("/") ? cleanKey.slice(1) : cleanKey;

      if (cleanKey.includes(`/${cleanWorkspace}/`) || cleanKey.startsWith(targetPrefix)) {
        keysToDeleteSet.add(cleanKey);
      }
    }

    const allKeys = Array.from(keysToDeleteSet);
    if (allKeys.length === 0) {
      return { deletedCount: 0, keys: [] };
    }

    // 3. Batch delete in chunks of 1000
    for (let i = 0; i < allKeys.length; i += 1000) {
      const chunk = allKeys.slice(i, i + 1000);
      const delCommand: DeleteObjectsCommand = new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      });
      const delRes = await this.client.send(delCommand);
      if (delRes.Errors && delRes.Errors.length > 0) {
        const errDetails = delRes.Errors.map((e) => `${e.Key}: ${e.Message || e.Code}`).join(", ");
        throw new Error(`Failed to delete Wasabi recording objects for workspace ${cleanWorkspace}: ${errDetails}`);
      }
    }

    return { deletedCount: allKeys.length, keys: allKeys };
  }
}
