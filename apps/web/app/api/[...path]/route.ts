import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8080";

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const url = `${API_URL}/api/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  const cookie = req.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const hasBody = !["GET", "HEAD"].includes(req.method);

  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await req.arrayBuffer() : undefined,
    redirect: "manual",
  });

  const resHeaders = new Headers();
  const upstreamContentType = upstream.headers.get("content-type");
  if (upstreamContentType) resHeaders.set("content-type", upstreamContentType);
  for (const setCookie of upstream.headers.getSetCookie?.() ?? []) {
    resHeaders.append("set-cookie", setCookie);
  }

  // 204/304 must not carry a body: `new Response(emptyBuffer, { status: 204 })` throws.
  const body = [204, 304].includes(upstream.status) ? null : await upstream.arrayBuffer();
  return new NextResponse(body, { status: upstream.status, headers: resHeaders });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as OPTIONS,
};
