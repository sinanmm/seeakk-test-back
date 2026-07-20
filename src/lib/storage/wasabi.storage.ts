import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
    const endpoint = process.env.WASABI_ENDPOINT;
    const region = process.env.WASABI_REGION || 'us-east-1';
    this.bucket = process.env.WASABI_BUCKET || '';
    const accessKeyId = process.env.WASABI_ACCESS_KEY || '';
    const secretAccessKey = process.env.WASABI_SECRET_KEY || '';
    this.rootPrefix = process.env.WASABI_ROOT_PREFIX || 'uploads/';
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

  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(command);
  }

  getPublicUrl(key: string): string {
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`;
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    // Encode the key so spaces and special characters are handled correctly
    return `${backendUrl}/api/upload/${encodeURIComponent(cleanKey)}`;
  }

  async getPresignedUrl(key: string): Promise<string> {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });
    // URL valid for 1 hour
    return await getSignedUrl(this.client, command, { expiresIn: 3600 });
  }

  async getFileStream(key: string): Promise<{ stream: any; contentType?: string; contentLength?: number }> {
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: cleanKey,
    });
    const response = await this.client.send(command);
    return {
      stream: response.Body,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }
}
