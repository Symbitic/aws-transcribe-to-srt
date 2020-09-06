# aws-transcribe-to-srt

A simple command-line tool to upload media files to [Amazon S3], transcribe them
with [Amazon Transcribe], and then converting the output to an SRT file.

Optionally, it can create new buckets as needed, and delete uploaded files when
completed.

## Usage

Make sure you have IAM [credentials] setup. aws-transcribe-to-srt requires full
access to the S3 and Transcribe services.

    Usage: aws-transcribe-to-srt [options] <file>

    Options:
      -V, --version        output the version number
      -r, --region <code>  The AWS region containing the S3 buckets (default: "us-east-1")
      -o, --output         Output SRT filename
      -b, --bucket <name>  The S3 bucket to create or use
      -h, --help           display help for command

## License

Available under the [MIT](LICENSE.md) license.

[Amazon S3]: https://aws.amazon.com/s3/
[Amazon Transcribe]: https://aws.amazon.com/transcribe/
[credentials]: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/getting-your-credentials.html
