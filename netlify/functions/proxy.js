export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Allow-Methods": "GET,OPTIONS"
        },
        body: ""
      };
    }

    const target = event.queryStringParameters && event.queryStringParameters.url;
    if (!target) {
      return {
        statusCode: 400,
        body: "Missing url parameter"
      };
    }

    const res = await fetch(target);
    const text = await res.text();

    return {
      statusCode: 200,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: text
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: err.toString()
    };
  }
}
