const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;

export async function POST() {
  try {
    if (!HEYGEN_API_KEY) {
      console.error("API key is missing from .env");
      return new Response("API key is missing", {
        status: 500,
      });
    }
    
    const baseApiUrl = process.env.NEXT_PUBLIC_BASE_API_URL || "https://api.heygen.com";
    const url = `${baseApiUrl}/v1/streaming.create_token`;
    
    console.log("[Token API] Requesting token from:", url);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": HEYGEN_API_KEY,
      },
    });

    console.log("[Token API] Response status:", res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[Token API] Error response:", errorText);
      return new Response(`HeyGen API error: ${errorText}`, {
        status: res.status,
      });
    }

    const data = await res.json();
    console.log("[Token API] Token received successfully");

    return new Response(data.data.token, {
      status: 200,
    });
  } catch (error) {
    console.error("[Token API] Error retrieving access token:", error);

    return new Response("Failed to retrieve access token", {
      status: 500,
    });
  }
}
