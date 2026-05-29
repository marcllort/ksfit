import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/api/login", "/api/fitbit"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }
  if (process.env.KSFIT_DEMO === "1") return NextResponse.next();
  // Single-user self-hosted install: env credentials drive an auto-login in the
  // data layer, so there's no cookie to gate on — let every request through.
  if (process.env.KSFIT_EMAIL && process.env.KSFIT_PASSWORD) {
    return NextResponse.next();
  }
  const session = req.cookies.get("ksfit_session")?.value;
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon|robots|api/health).*)"],
};
