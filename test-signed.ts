import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const client = new S3Client({
  endpoint: 'https://s3.wasabisys.com',
  region: 'us-east-1',
  credentials: {
    accessKeyId: '2I71AT7OHBH9LF4KDG28',
    secretAccessKey: 'MQM2UAH2GTYTJP30Qtz9DatKNzrhGdKkFzud8jtQ',
  }
});

const command = new GetObjectCommand({
  Bucket: 'geniusgroup',
  Key: 'Seeak App Data/0f88a3d6-aa80-489f-a3a2-e1a52fec0754.jpeg'
});

getSignedUrl(client, command, { expiresIn: 3600 }).then(console.log).catch(console.error);
