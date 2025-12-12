export async function handler(event) {
  try {
    const target = event.queryStringParameters.url;
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
