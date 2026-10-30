// Netlify Edge Function — same-origin API proxy for the test environment.
//
// Why this exists: the frontend calls a RELATIVE /api/* (same-origin), and this
// function forwards each call to the real backend. Crucially, it rewrites the
// response Set-Cookie headers to STRIP the `Domain=.lexamplify.com` attribute.
// Without that, a browser on lexamplify-app.netlify.app refuses to store the auth
// cookie (domain mismatch) and login never persists. Stripping Domain makes the
// cookie host-only for THIS netlify domain, so it is stored and sent back on the
// next same-origin /api call — which this function forwards (Cookie header and all)
// to the backend. No backend change, no SameSite change, no CORS (same-origin).
//
// This only affects the Netlify test env. Production (Firebase, *.lexamplify.com)
// talks to api.lexamplify.com directly and never goes through here.

const BACKEND = "https://api.lexamplify.com";

export default async (request) => {
  const url = new URL(request.url);
  const target = BACKEND + url.pathname + url.search;

  // Forward the request as-is, minus hop-by-hop/host headers that must be re-set
  // by fetch for the backend origin.
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("x-forwarded-host");

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const resp = await fetch(target, {
    method,
    headers,
    // Buffer the body so we don't need request streaming (fine for a test env).
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });

  // Rebuild response headers, rewriting every Set-Cookie to drop its Domain so the
  // cookie becomes host-only for lexamplify-app.netlify.app.
  const outHeaders = new Headers(resp.headers);
  const setCookies =
    typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [];
  if (setCookies.length) {
    outHeaders.delete("set-cookie");
    for (const cookie of setCookies) {
      outHeaders.append("set-cookie", cookie.replace(/;\s*Domain=[^;]*/gi, ""));
    }
  }

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: outHeaders,
  });
};

export const config = { path: "/api/*" };
