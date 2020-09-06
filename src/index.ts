import { S3, TranscribeService } from 'aws-sdk';
import { basename } from 'path';
import { createReadStream, existsSync, writeFile } from 'fs';
import { v4 as uuid } from 'uuid';
import { promisify } from 'util';
import axios from 'axios';

const S3_API_VERSION = '2006-03-01';
const TRANSCRIBE_API_VERSION = '2017-10-26';

const writeFileAsync = promisify(writeFile);

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function padString(str: string | number, length: number) {
  return (new Array(length + 1).join('0') + str).slice(-length);
}

function secondsToMinutes(str: string | number) {
  let total = Number(str);
  const hours = Math.floor(total / 3600);
  total = total - (hours * 3600);
  const minutes = Math.floor(total / 60);
  const seconds = (total - minutes * 60).toFixed(3);

  const hoursStr = padString(hours, 2);
  const minutesStr = padString(minutes, 2);
  const secondsStr = padString(seconds, 6);

  return `${hoursStr}:${minutesStr}:${secondsStr}`;
}

interface ITranscripts {
  transcript: string;
};

interface IAlternative {
  confidence: string | number;
  content: string;
}

interface IItem {
  start_time: number;
  end_time: number;
  alternatives: IAlternative[];
  type: 'pronunciation' | 'punctuation'
};

interface TranscriptionResponse {
  jobName: TranscribeService.TranscriptionJobName;
  accountId: string;
  results: {
    transcripts: ITranscripts[]
    items: IItem[]
  }
  status: TranscribeService.TranscriptionJobStatus;
}

export interface TranscribeParams {
  bucketName: string;
  inputFile: string;
  outputFile: string;
  deleteFile: boolean;
}

/**
 * Handler for transcribing media files.
 */
export class Transcriber {
  private s3: S3;
  private transcriber: TranscribeService;
  private region: string;
  private bucketCreated: boolean;

  /** Enable/disable logging. */
  public enableLog: boolean;

  /**
   * Create a new Transcoder object.
   * @param region AWS Region (default 'us-east-1').
   */
  constructor(region: string) {
    this.region = region;
    this.bucketCreated = false;
    this.enableLog = true;

    this.s3 = new S3({
      apiVersion: S3_API_VERSION,
      region
    });

    this.transcriber = new TranscribeService({
      apiVersion: TRANSCRIBE_API_VERSION,
      region
    });
  }

  /**
   * Transcribe a media file.
   * @param params Transcription parameters.
   * @returns Resolves when transcription is finished.
   */
  async transcribe(params: TranscribeParams): Promise<void> {
    const { bucketName, deleteFile, inputFile, outputFile } = params;

    const mediaFile = basename(inputFile);
    const jobName = `transcribe_${uuid()}_${mediaFile}`;
    const uri = `https://s3-${this.region}.amazonaws.com/${bucketName}/${mediaFile}`;

    // Create a new bucket if needed.
    const bucketExists = await this.bucketExists(bucketName);
    if (!bucketExists) {
      this.log(`> Creating bucket ${bucketName}...`)
      await this.createBucket(bucketName);
      this.log(`> Bucket created!`)
    }

    // Upload the input file to S3.
    this.log(`> Uploading ${inputFile}...`);
    await this.uploadFile(bucketName, inputFile, mediaFile);
    this.log(`> File uploaded!`);

    // Begin transcribing
    this.log(`> Starting transcribing job...`);
    const response = await this.startTranscription(jobName, uri);
    const transcriptionName = <string>response.TranscriptionJob?.TranscriptionJobName;
    this.log(`> Transcription started!`);
    this.log(`> Transcription Job: ${transcriptionName}`);
    await sleep(500);
    this.print(`> Transcribing`);

    let job = await this.getTranscriptionJob(jobName);
    while (job.TranscriptionJobStatus === 'IN_PROGRESS') {
      this.print('.');
      await sleep(30000);
      job = await this.getTranscriptionJob(jobName);
    }

    // TODO: Handle 'FAILED' status with job.FailureReason

    // Convert to SRT
    this.log(`\n> Transcribing finished!\n> Converting to SRT`);
    const transcript = <TranscribeService.Transcript>job.Transcript;
    const url = <string>transcript.TranscriptFileUri;

    const { data: subtitles } = await axios(url);
    const srt = this.convertJsonToSrt(subtitles as TranscriptionResponse);
    this.log(`> Conversion finished!`);

    this.log(`> Writing to ${outputFile}`);
    await writeFileAsync(outputFile, srt);

    if (deleteFile) {
      this.log(`> Deleting ${mediaFile} from Amazon S3`);
      await this.deleteFile(bucketName, mediaFile);
    }
    this.log(`> Done!`);
  }

  /**
   * Check if a bucket already exists or not.
   * @param bucketName S3 Bucket.
   * @returns Promise that indicates if the bucket already exists or not.
   */
  async bucketExists(bucketName: string): Promise<boolean> {
    const bucketsList = await this.s3.listBuckets().promise();
    const buckets = bucketsList.Buckets
      ? bucketsList.Buckets?.map(({ Name }) => Name)
      : [];

    return buckets.includes(bucketName);
  }

  /**
   * Creates a new bucket.
   * @param bucketName S3 Bucket.
   * @returns Promise that resolves when the bucket has been created.
   */
  async createBucket(bucketName: string) {
    const bucketParams = {
      Bucket: bucketName
    };
    await this.s3.createBucket(bucketParams).promise();

    this.bucketCreated = true;
  }

  /**
   * Upload a file.
   * @param bucketName Bucket to upload to.
   * @param fileName File to upload.
   * @param objectName Bucket object to create.
   * @returns Promise that resolves when the file is uploaded.
   */
  async uploadFile(bucketName: string, fileName: string, objectName: string) {
    let error: Error | boolean = false;

    if (!existsSync(fileName)) {
      throw new Error(`${fileName} does not exist`);
    }

    const stream = createReadStream(fileName);

    stream.on('error', (err) => {
      error = err;
    });

    const uploadParams = {
      Body: stream,
      Bucket: bucketName,
      Key: objectName
    };

    // TODO: Check to see if already uploaded.

    await this.s3.upload(uploadParams).promise();

    if (error) {
      throw error;
    }
  }

  /**
   * Delete an uploaded file.
   * @param bucketName Bucket the object belongs to.
   * @param objectName Bucket object to delete.
   * @returns Promise that resolves when the file has been deleted.
   */
  async deleteFile(bucketName: string, objectName: string) {
    const bucketParams = {
      Bucket: bucketName,
      Key: objectName
    };
    await this.s3.deleteObject(bucketParams).promise();
  }

  /**
   *
   * @param jobName Unique name of the transcription job.
   * @param uri Path to the media file.
   * @returns Response from Amazon.
   */
  async startTranscription(jobName: string, uri: string) {
    const jobParams = {
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      MediaFormat: 'mp4',
      Media: {
        MediaFileUri: uri
      }
    };

    return this.transcriber.startTranscriptionJob(jobParams).promise();
  }

  /**
   * Get information about a transcription job.
   * @param jobName Unique name of the transcription job.
   * @returns Current results for this job.
   */
  async getTranscriptionJob(jobName: string) {
    const params = {
      TranscriptionJobName: jobName
    };
    const response = await this.transcriber.getTranscriptionJob(params).promise();

    return <TranscribeService.TranscriptionJob>response.TranscriptionJob;
  }

  /**
   * Convert Amazon Transcribe output to an SRT file.
   * @param json AWS Transcribe JSON object.
   * @returns SRT file contents.
   */
  convertJsonToSrt(json: TranscriptionResponse) {
    let convertedOutput = '';
    let subtitleIndex = 1;
    let current_start = json.results.items[0].start_time;
    let formatted_start;
    let formatted_end;
    let nextline = '';

    json.results.items.forEach((item: IItem, index: number) => {
      if (item.type == 'punctuation') {
        nextline = nextline.slice(0, -1); // Remove the space before punctuation
        nextline += item.alternatives[0].content;
        formatted_start = secondsToMinutes(current_start);
        formatted_end = secondsToMinutes(json.results.items[index - 1].end_time);
        convertedOutput += `${subtitleIndex++}\n`;
        convertedOutput += formatted_start + ' --> ' + formatted_end + '\n';
        convertedOutput += nextline + '\n\n';
        nextline = '';
        let nextItem = json.results.items[index + 1];
        if (nextItem) {
          current_start = json.results.items[index + 1].start_time;
        }
      } else if (item.end_time - current_start > 5) {
        formatted_start = secondsToMinutes(current_start);
        formatted_end = secondsToMinutes(json.results.items[index - 1].end_time);
        convertedOutput += `${subtitleIndex++}\n`;
        convertedOutput += formatted_start + ' --> ' + formatted_end + '\n';
        convertedOutput += nextline + '\n\n';
        nextline = item.alternatives[0].content + ' ';
        current_start = item.start_time;
      } else {
        nextline += item.alternatives[0].content + ' ';
      }
    });

    formatted_start = secondsToMinutes(current_start);
    if (json.results.items[json.results.items.length - 1].type !== 'punctuation') {
      formatted_end = secondsToMinutes(json.results.items[json.results.items.length - 1].end_time);
    } else {
      formatted_end = secondsToMinutes(json.results.items[json.results.items.length - 2].end_time);
    }

    if (nextline) {
      convertedOutput += `${subtitleIndex++}\n`
      convertedOutput += formatted_start + ' --> ' + formatted_end + '\n';
      convertedOutput += nextline; // Add any leftover words to the end
    }

    return convertedOutput;
  }

  private log(msg: string) {
    this.print(msg + '\n');
  }

  private print(msg: string) {
    if (!this.enableLog) {
      return;
    }
    process.stdout.write(msg);
  }
}
