const SUPPORTED_PATHS = new Set(["/operator.apk", "/apk", "/install.apk"]);

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: {
      "allow": "GET, HEAD",
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function redirectResponse(location) {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!SUPPORTED_PATHS.has(url.pathname)) {
      return jsonError(404, "Not found");
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed();
    }

    if (!env.ANDROPERATOR_APK_METADATA_URL) {
      return jsonError(500, "Missing ANDROPERATOR_APK_METADATA_URL");
    }

    let metadataUrl;
    try {
      metadataUrl = new URL(env.ANDROPERATOR_APK_METADATA_URL);
    } catch {
      return jsonError(500, "ANDROPERATOR_APK_METADATA_URL is invalid");
    }

    let metadataResponse;
    try {
      metadataResponse = await fetch(metadataUrl.toString(), {
        cf: {
          cacheTtl: 60,
          cacheEverything: true,
        },
      });
    } catch {
      return jsonError(502, "Failed to fetch APK metadata");
    }

    if (!metadataResponse.ok) {
      return jsonError(502, "APK metadata endpoint returned an error");
    }

    let metadata;
    try {
      metadata = await metadataResponse.json();
    } catch {
      return jsonError(502, "APK metadata response was not valid JSON");
    }

    if (!metadata.apk_url) {
      return jsonError(502, "APK metadata did not include apk_url");
    }

    let apkUrl;
    try {
      apkUrl = new URL(metadata.apk_url);
    } catch {
      return jsonError(502, "APK metadata contained an invalid apk_url");
    }

    if (apkUrl.protocol !== "https:") {
      return jsonError(502, "APK metadata must use an https URL");
    }

    if (apkUrl.hostname !== metadataUrl.hostname) {
      return jsonError(502, "APK metadata hostname is not allowed");
    }

    return redirectResponse(apkUrl.toString());
  },
};
