import { program } from 'commander';
import { Transcriber } from './index';
import { resolve } from 'path';
import * as AWS from 'aws-sdk';

const { name, version } = require('../package.json');

interface IMainArgs {
  /** AWS S3 Bucket. */
  bucket: string;
  /** AWS region. */
  region: string;
  /** SRT filename. */
  output: string;
  /** Delete the uploaded file? */
  delete: boolean;
};

async function main(file: string, args: IMainArgs) {
  AWS.config.update({ region: args.region });

  const inputFile = resolve(file);
  const outputFile = args.output || inputFile.replace(/\.mp4$/, '.srt');
  const bucketName = args.bucket.endsWith('/')
    ? args.bucket.slice(0, -1)
    : args.bucket;
  const deleteFile = args.delete;

  const params = {
    bucketName,
    deleteFile,
    inputFile,
    outputFile
  };

  const transcriber = new Transcriber(args.region);
  await transcriber.transcribe(params);
}

program
  .name(name)
  .version(version)
  .arguments('<file>')
  .option('-r, --region <code>', 'The AWS region containing the S3 buckets', 'us-east-1')
  .option('-o, --output', 'Output SRT filename')
  .option('-d, --delete', 'Delete the uploaded file when done', false)
  .requiredOption('-b, --bucket <name>', 'The S3 bucket to create or use')
  .action(main);

program.parseAsync(process.argv).catch(err => {
  console.error('Error:');
  console.error(err);
});
