const admin = require("firebase-admin");

const FIREBASE_STORAGE_SUFFIX = ".firebasestorage.app";
const APPSPOT_SUFFIX = ".appspot.com";
let resolvedBucketNamePromise = null;

function sanitizeBucketName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  return raw.replace(/^gs:\/\//i, "").split("/")[0];
}

function appendUnique(values, value) {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function getBucketCandidates() {
  const configuredBucket = sanitizeBucketName(process.env.FIREBASE_STORAGE_BUCKET);
  const projectId = String(process.env.FIREBASE_PROJECT_ID || "").trim();
  const candidates = [];

  appendUnique(candidates, configuredBucket);

  if (configuredBucket.endsWith(FIREBASE_STORAGE_SUFFIX)) {
    const prefix = configuredBucket.slice(0, -FIREBASE_STORAGE_SUFFIX.length);
    appendUnique(candidates, `${prefix}${APPSPOT_SUFFIX}`);
  } else if (configuredBucket.endsWith(APPSPOT_SUFFIX)) {
    const prefix = configuredBucket.slice(0, -APPSPOT_SUFFIX.length);
    appendUnique(candidates, `${prefix}${FIREBASE_STORAGE_SUFFIX}`);
  }

  if (projectId) {
    appendUnique(candidates, `${projectId}${APPSPOT_SUFFIX}`);
    appendUnique(candidates, `${projectId}${FIREBASE_STORAGE_SUFFIX}`);
  }

  return candidates;
}

function buildCredentialFromEnv() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : "";

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return admin.credential.cert({
    projectId,
    clientEmail,
    privateKey
  });
}

function initializeFirebase() {
  if (admin.apps.length > 0) {
    return admin;
  }

  const storageBucket = getBucketCandidates()[0];
  const credential = buildCredentialFromEnv();
  const options = {};
  if (storageBucket) {
    options.storageBucket = storageBucket;
  }
  if (credential) {
    options.credential = credential;
  }

  admin.initializeApp(options);
  return admin;
}

async function resolveBucketName() {
  const firebase = initializeFirebase();
  if (!firebase) {
    return null;
  }

  if (resolvedBucketNamePromise) {
    return resolvedBucketNamePromise;
  }

  const candidates = getBucketCandidates();
  if (!candidates.length) {
    return null;
  }

  resolvedBucketNamePromise = (async () => {
    const storage = firebase.storage();
    let lastError = null;

    for (const candidate of candidates) {
      try {
        const bucket = storage.bucket(candidate);
        await bucket.getMetadata();
        return candidate;
      } catch (err) {
        const statusCode = Number(err?.code);
        if (statusCode === 401 || statusCode === 403) {
          return candidate;
        }
        lastError = err;
      }
    }

    if (lastError) {
      throw lastError;
    }

    return null;
  })();

  try {
    return await resolvedBucketNamePromise;
  } catch (err) {
    resolvedBucketNamePromise = null;
    throw err;
  }
}

async function getStorageBucket() {
  const firebase = initializeFirebase();
  if (!firebase) {
    return null;
  }

  const bucketName = await resolveBucketName();
  if (!bucketName) {
    return null;
  }

  return firebase.storage().bucket(bucketName);
}

module.exports = {
  getStorageBucket
};
