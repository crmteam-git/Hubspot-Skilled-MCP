// Thin HubSpot REST client with retry/backoff on rate limits.
const BASE_URL = process.env.HUBSPOT_BASE_URL || "https://api.hubapi.com";
const MAX_RETRIES = Number(process.env.HUBSPOT_MAX_RETRIES || 3);

export class HubSpotError extends Error {
  constructor(status, body, method, path) {
    const msg =
      (body && (body.message || body.error)) ||
      (typeof body === "string" ? body : JSON.stringify(body));
    const details = Array.isArray(body?.errors) && body.errors.length
      ? ` | details: ${JSON.stringify(body.errors).slice(0, 1500)}`
      : "";
    super(`HubSpot ${method} ${path} failed (${status}): ${msg}${details}`);
    this.status = status;
    this.body = body;
  }
}

function getToken() {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token || token.startsWith("your-")) {
    throw new Error(
      "HUBSPOT_ACCESS_TOKEN is not set. Add your Private App token to the .env file."
    );
  }
  return token;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function hubspot(method, path, { query, body } = {}) {
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else url.searchParams.set(k, String(v));
    }
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter ? retryAfter * 1000 : 500 * 2 ** attempt);
      continue;
    }

    if (res.status === 204) return { success: true };
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = text;
    }
    if (!res.ok) throw new HubSpotError(res.status, data, method, url.pathname);
    return data;
  }
}

/** Follow HubSpot `paging.next.after` cursors until done or `max` items collected. */
export async function paginate(path, { query = {}, max = 1000, key = "results" } = {}) {
  const out = [];
  let after;
  do {
    const page = await hubspot("GET", path, { query: { ...query, after } });
    out.push(...(page[key] || []));
    after = page.paging?.next?.after;
  } while (after && out.length < max);
  return out.slice(0, max);
}

export const isReadOnly = () =>
  String(process.env.HUBSPOT_READ_ONLY || "false").toLowerCase() === "true";

export function assertWritable() {
  if (isReadOnly()) {
    throw new Error(
      "Server is in read-only mode (HUBSPOT_READ_ONLY=true). Set it to false in .env to allow changes."
    );
  }
}
