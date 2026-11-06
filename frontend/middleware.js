// Vercel Edge Middleware — same-origin API proxy (ported from the Netlify
// edge-function api-proxy.js, whose matcher was path "/api/*").
//
// The frontend is built with an EMPTY VITE_API_BASE_URL, so it calls RELATIVE
// /api/* (same-origin). This middleware intercepts every /api/* request (at any
// depth), forwards it to the real backend, and rewrites each response
// Set-Cookie to STRIP its `Domain=.lexamplify.com` attribute — otherwise a
// browser on the *.vercel.app domain refuses to store the auth cookie (domain
// mismatch) and login never persists. Stripping Domain makes the cookie
// host-only for THIS Vercel domain, so it is stored and sent back on the next
// same-origin /api call, which this middleware forwards (Cookie header and all)
// to the backend. No backend change, no CORS (same-origin from the browser).
//
// (Using middleware rather than an api/[...path] function because a catch-all
// api function only matched single-segment paths here, 404-ing /api/auth/*.)

export const config = { matcher: '/api/:path*' };

const BACKEND = 'https://api.lexamplify.com';

export default async function middleware(request) {
  const url = new URL(request.url);
  const target = BACKEND + url.pathname + url.search;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('x-forwarded-host');

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  const resp = await fetch(target, {
    method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: 'manual',
  });

  const outHeaders = new Headers(resp.headers);
  const setCookies =
    typeof resp.headers.getSetCookie === 'function' ? resp.headers.getSetCookie() : [];
  if (setCookies.length) {
    outHeaders.delete('set-cookie');
    for (const cookie of setCookies) {
      outHeaders.append('set-cookie', cookie.replace(/;\s*Domain=[^;]*/gi, ''));
    }
  }

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: outHeaders,
  });
}
