import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

const client = new S3Client({
  endpoint: 'https://s3.wasabisys.com',
  region: 'us-east-1',
  credentials: {
    accessKeyId: '2I71AT7OHBH9LF4KDG28',
    secretAccessKey: 'MQM2UAH2GTYTJP30Qtz9DatKNzrhGdKkFzud8jtQ',
  }
});

client.send(new ListBucketsCommand({})).then(data => console.log(data.Buckets?.map(b => b.Name))).catch(console.error);
