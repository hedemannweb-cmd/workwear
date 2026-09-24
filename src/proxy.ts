import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistische Weiterleitung auf /login, wenn kein Session-Cookie vorhanden ist.
 * Das ist KEINE Sicherheitsprüfung: jede Seite und jede Server Action prüft Session,
 * Rolle und Abteilungs-Scope selbst (requireActor / assertCan).
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
