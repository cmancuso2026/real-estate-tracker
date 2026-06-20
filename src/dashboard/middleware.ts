import { NextRequest, NextResponse } from 'next/server';

/**
 * HTTP Basic Auth middleware — protects every page and API route.
 *
 * Set these env vars in Railway:
 *   AUTH_USER      — username (e.g. "cole")
 *   AUTH_PASSWORD  — password (choose something strong)
 *
 * If either var is missing the middleware skips auth entirely so the app
 * still boots during local dev without credentials configured.
 */

export const config = {
  // Match every route except Next.js internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

export function middleware(req: NextRequest) {
  const user = process.env.AUTH_USER?.trim();
  const pass = process.env.AUTH_PASSWORD?.trim();

  // Skip auth if env vars aren't set (local dev)
  if (!user || !pass) return NextResponse.next();

  const authHeader = req.headers.get('authorization') ?? '';

  if (authHeader.startsWith('Basic ')) {
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf-8');
    const [providedUser, ...rest] = decoded.split(':');
    const providedPass = rest.join(':'); // handle passwords containing ':'

    if (providedUser === user && providedPass === pass) {
      return NextResponse.next();
    }
  }

  // Return 401 with WWW-Authenticate to trigger the browser's login prompt
  return new NextResponse('Unauthorized', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Property Manager", charset="UTF-8"',
    },
  });
}
