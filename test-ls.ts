import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const client = new S3Client({
  endpoint: 'https://s3.wasabisys.com',
  region: 'us-east-1',
  credentials: {
    accessKeyId: '2I71AT7OHBH9LF4KDG28',
    secretAccessKey: 'MQM2UAH2GTYTJP30Qtz9DatKNzrhGdKkFzud8jtQ',
  }
});

async function listBucket(bucket: string) {
  try {
    const data = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 5 }));
    console.log(`Bucket ${bucket}:`, data.Contents?.map(c => c.Key));
  } catch (err: any) {
    console.error(`Error in ${bucket}:`, err.message);
  }
}

listBucket('geniusgroup');
listBucket('seeakk-files');
