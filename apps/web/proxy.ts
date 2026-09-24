import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/signup", "/offline"];
const PUBLIC_FILES = ["/icon.svg", "/apple-icon.png", "/manifest.webmanifest", "/sw.js"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_FILES.includes(pathname) ||
    pathname.startsWith("/welcome") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/_next/");

  if (!req.cookies.get("session")) {
    // Signed-out visitors get the landing page at "/" (URL stays "/"); the app itself stays behind login.
    if (pathname === "/") return NextResponse.rewrite(new URL("/welcome", req.url));
    if (!isPublic) return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw.js|icons/).*)"],
};
