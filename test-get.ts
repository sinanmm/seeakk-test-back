import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const client = new S3Client({
  endpoint: 'https://s3.wasabisys.com',
  region: 'us-east-1',
  credentials: {
    accessKeyId: '2I71AT7OHBH9LF4KDG28',
    secretAccessKey: 'MQM2UAH2GTYTJP30Qtz9DatKNzrhGdKkFzud8jtQ',
  }
});

client.send(new GetObjectCommand({
  Bucket: 'geniusgroup',
  Key: 'Seeak App Data/0f88a3d6-aa80-489f-a3a2-e1a52fec0754.jpeg'
})).then(data => {
  console.log('Success! Content length:', data.ContentLength);
}).catch(console.error);
