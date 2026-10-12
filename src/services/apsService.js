import "server-only";

const APS_BASE_URL = "https://developer.api.autodesk.com";
const DEFAULT_SCOPES = [
  "data:read",
  "data:write",
  "data:create",
  "bucket:read",
  "bucket:create",
];

function getCredentials() {
  const clientId = process.env.APS_CLIENT_ID?.trim();
  const clientSecret = process.env.APS_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error("APS_CLIENT_ID or APS_CLIENT_SECRET is missing from .env.local.");
  }

  return { clientId, clientSecret };
}

async function readResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function apsFetch(path, { token, headers, ...options } = {}) {
  const response = await fetch(`${APS_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    cache: "no-store",
  });

  const data = await readResponse(response);

  if (!response.ok) {
    const error = new Error(
      data?.developerMessage ||
        data?.error_description ||
        data?.error ||
        data?.message ||
        `Autodesk APS request failed with HTTP ${response.status}.`
    );
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

export async function getApsAccessToken(scopes = DEFAULT_SCOPES) {
  const { clientId, clientSecret } = getCredentials();
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const data = await apsFetch("/authentication/v2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: scopes.join(" "),
    }),
  });

  if (!data.access_token) throw new Error("Autodesk APS did not return an access token.");

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type || "Bearer",
  };
}

function normalizeBucketKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function getDefaultBucketKey() {
  const { clientId } = getCredentials();
  return normalizeBucketKey(process.env.APS_BUCKET_KEY || `ventra_${clientId}`);
}

export async function ensureApsBucket(bucketKey = getDefaultBucketKey()) {
  const key = normalizeBucketKey(bucketKey);
  if (!key) throw new Error("A valid APS bucket key is required.");

  const { accessToken } = await getApsAccessToken();

  try {
    const bucket = await apsFetch(`/oss/v2/buckets/${encodeURIComponent(key)}/details`, {
      token: accessToken,
    });
    return { bucketKey: key, bucket, created: false };
  } catch (error) {
    if (error.status !== 404) throw error;
  }

  const bucket = await apsFetch("/oss/v2/buckets", {
    token: accessToken,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ads-region": process.env.APS_REGION || "EMEA",
    },
    body: JSON.stringify({
      bucketKey: key,
      policyKey: process.env.APS_BUCKET_POLICY || "transient",
      access: "full",
    }),
  });

  return { bucketKey: key, bucket, created: true };
}

export function encodeApsUrn(objectId) {
  return Buffer.from(String(objectId), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function uploadToAps({ file, bucketKey, sourceObjectKey }) {
  if (!(file instanceof File)) throw new Error("A valid file is required.");

  const { bucketKey: ensuredBucket } = await ensureApsBucket(bucketKey);
  const { accessToken } = await getApsAccessToken();
  const objectKey = sourceObjectKey || file.name.replace(/[\\/]/g, "_");
  const objectPath = `/oss/v2/buckets/${encodeURIComponent(ensuredBucket)}/objects/${encodeURIComponent(objectKey)}`;

  const signed = await apsFetch(`${objectPath}/signeds3upload?minutesExpiration=10`, {
    token: accessToken,
  });

  const uploadUrl = signed?.urls?.[0];
  if (!uploadUrl || !signed.uploadKey) {
    throw new Error("Autodesk APS did not return a signed upload URL.");
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: file.type ? { "Content-Type": file.type } : undefined,
    body: file,
  });

  if (!uploadResponse.ok) {
    throw new Error(`APS signed upload failed with HTTP ${uploadResponse.status}.`);
  }

  const completed = await apsFetch(`${objectPath}/signeds3upload`, {
    token: accessToken,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ossbucketKey: ensuredBucket,
      ossSourceFileObjectKey: objectKey,
      access: "full",
      uploadKey: signed.uploadKey,
    }),
  });

  return {
    bucketKey: ensuredBucket,
    objectKey,
    objectId: completed.objectId,
    urn: encodeApsUrn(completed.objectId),
    size: completed.size,
    contentType: completed.contentType,
  };
}

export async function translateApsModel({ urn, rootFilename = "" }) {
  if (!urn) throw new Error("APS model URN is required.");
  const { accessToken } = await getApsAccessToken();

  const input = { urn };
  if (rootFilename) {
    input.compressedUrn = true;
    input.rootFilename = rootFilename;
  }

  try {
    return await apsFetch("/modelderivative/v2/designdata/job", {
      token: accessToken,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        output: {
          destination: { region: process.env.APS_REGION || "EMEA" },
          formats: [{ type: "svf2", views: ["2d", "3d"] }],
        },
      }),
    });
  } catch (error) {
    // APS returns HTTP 409 when an identical translation job already exists
    // or is currently running. That is not a failure for Ventra: the caller
    // should continue polling the manifest for the same URN.
    if (Number(error?.status) === 409) {
      return {
        result: "already-exists",
        status: "inprogress",
        urn,
        reusedExistingJob: true,
        details: error?.details || null,
      };
    }

    throw error;
  }
}

export async function getApsManifest(urn) {
  if (!urn) throw new Error("APS model URN is required.");
  const { accessToken } = await getApsAccessToken(["data:read"]);
  return apsFetch(`/modelderivative/v2/designdata/${encodeURIComponent(urn)}/manifest`, {
    token: accessToken,
  });
}

export async function getApsViewerToken(resource) {
  if(!resource)throw new Error("A verified model is required for a viewer token.");
  return getApsAccessToken([`data:read:${resource}`]);
}
