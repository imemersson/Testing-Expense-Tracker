let cachedS3Client = null;

function getS3BucketName() {
  return String(process.env.AWS_S3_BUCKET || "").trim();
}

function getS3Region() {
  return String(process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "").trim();
}

function isS3Configured() {
  return Boolean(getS3BucketName() && getS3Region());
}

function buildCredentialsFromEnv() {
  const accessKeyId = String(process.env.AWS_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.AWS_SECRET_ACCESS_KEY || "").trim();
  const sessionToken = String(process.env.AWS_SESSION_TOKEN || "").trim();

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  const credentials = { accessKeyId, secretAccessKey };
  if (sessionToken) {
    credentials.sessionToken = sessionToken;
  }

  return credentials;
}

function loadAwsSdk() {
  try {
    // Lazy-require so the app can still run without S3 deps when not configured.
    const {
      S3Client,
      PutObjectCommand,
      DeleteObjectCommand,
      GetObjectCommand
    } = require("@aws-sdk/client-s3");
    const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

    return {
      S3Client,
      PutObjectCommand,
      DeleteObjectCommand,
      GetObjectCommand,
      getSignedUrl
    };
  } catch (err) {
    if (err?.code === "MODULE_NOT_FOUND") {
      const missing = new Error(
        "AWS SDK is not installed. Install @aws-sdk/client-s3 and @aws-sdk/s3-request-presigner."
      );
      missing.code = "AWS_SDK_NOT_INSTALLED";
      throw missing;
    }

    throw err;
  }
}

function getS3Client() {
  if (cachedS3Client) {
    return cachedS3Client;
  }

  if (!isS3Configured()) {
    return null;
  }

  const { S3Client } = loadAwsSdk();
  const region = getS3Region();
  const credentials = buildCredentialsFromEnv();
  const options = { region };
  if (credentials) {
    options.credentials = credentials;
  }

  cachedS3Client = new S3Client(options);
  return cachedS3Client;
}

async function putObject({ key, body, contentType, cacheControl }) {
  const bucket = getS3BucketName();
  const s3 = getS3Client();
  if (!bucket || !s3) {
    return null;
  }

  const { PutObjectCommand } = loadAwsSdk();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: cacheControl
    })
  );

  return { bucket, key };
}

async function deleteObject({ key }) {
  const bucket = getS3BucketName();
  const s3 = getS3Client();
  if (!bucket || !s3) {
    return null;
  }

  const { DeleteObjectCommand } = loadAwsSdk();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  return { bucket, key };
}

async function getSignedReadUrl({ key, expiresInSeconds = 15 * 60 }) {
  const bucket = getS3BucketName();
  const s3 = getS3Client();
  if (!bucket || !s3) {
    return null;
  }

  const { GetObjectCommand, getSignedUrl } = loadAwsSdk();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

module.exports = {
  deleteObject,
  getS3BucketName,
  getSignedReadUrl,
  isS3Configured,
  putObject
};

