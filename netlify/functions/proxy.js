export async function handler(event) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Expose-Headers": "x-proxy-upstream-status, x-proxy-content-type, content-type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  const qs = event.queryStringParameters || {};
  const rawUrl = qs.url;
  if (!rawUrl) {
    return { statusCode: 400, headers: corsHeaders, body: "Missing url parameter" };
  }

  let target = rawUrl;
  if (rawUrl.includes("%")) {
    try {
      target = decodeURIComponent(rawUrl);
    } catch (err) {
      // keep raw if decode fails
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("proxy timeout")), 12000);

  try {
    const upstreamRes = await fetch(target, { signal: controller.signal });
    const contentType = upstreamRes.headers.get("content-type") || "";
    const bodyText = await upstreamRes.text();
    const trimmed = bodyText.trimStart();
    const isJson =
      contentType.toLowerCase().includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");

    const baseHeaders = {
      ...corsHeaders,
      ...(contentType ? { "Content-Type": contentType } : {}),
    };

    if (isJson) {
      return {
        statusCode: upstreamRes.status,
        headers: baseHeaders,
        body: bodyText,
      };
    }

    return {
      statusCode: upstreamRes.status,
      headers: {
        ...baseHeaders,
        "x-proxy-upstream-status": String(upstreamRes.status),
        "x-proxy-content-type": contentType || "unknown",
      },
      body: bodyText,
    };
  } catch (err) {
    const detail = err && err.message ? err.message : "unknown error";
    return {
      statusCode: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        where: "proxy",
        message: "Proxy upstream request failed",
        detail,
        url: target,
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}
