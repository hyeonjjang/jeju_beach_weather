// Simple CORS proxy using Node core modules only
const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = 4000;

function setCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || "*";

  if (req.method === "OPTIONS") {
    setCors(res, origin);
    res.writeHead(204);
    return res.end();
  }

  const currentUrl = new URL(req.url, `http://localhost:${PORT}`);
  if (currentUrl.pathname !== "/proxy") {
    setCors(res, origin);
    res.writeHead(404);
    return res.end("Not found");
  }

  const target = currentUrl.searchParams.get("url");
  if (!target) {
    setCors(res, origin);
    res.writeHead(400);
    return res.end("Missing url parameter");
  }

  let targetUrl;
  try {
    targetUrl = new URL(decodeURIComponent(target));
  } catch (err) {
    setCors(res, origin);
    res.writeHead(400);
    return res.end("Invalid url parameter");
  }

  const client = targetUrl.protocol === "https:" ? https : http;
  const options = {
    method: "GET",
    headers: {
      // forward minimal headers
      "User-Agent": req.headers["user-agent"] || "simple-proxy",
      Accept: req.headers["accept"] || "*/*",
    },
  };

  const proxyReq = client.request(targetUrl, options, (proxyRes) => {
    let body = "";
    proxyRes.setEncoding("utf8");
    proxyRes.on("data", (chunk) => {
      body += chunk;
    });
    proxyRes.on("end", () => {
      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        console.error("Proxy target error:", proxyRes.statusCode, body.slice(0, 300));
      }
      setCors(res, origin);
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers["content-type"] ? { "Content-Type": proxyRes.headers["content-type"] } : undefined);
      res.end(body);
    });
  });

  proxyReq.on("error", (err) => {
    console.error("Proxy error:", err.message);
    setCors(res, origin);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Proxy error");
  });

  proxyReq.end();
});

server.listen(PORT, () => {
  console.log(`Proxy server listening on http://localhost:${PORT}`);
});
