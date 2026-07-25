// Serves locally-stored media (the default LocalDiskStore). With a cloud
// MediaStore the stored URL points straight at the CDN and this route is
// never hit. Path traversal is blocked: the resolved path must stay inside
// the media root.

import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import { localMediaRoot } from "@/lib/storage";

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  avif: "image/avif",
  gif: "image/gif",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  const { path } = await params;
  const root = localMediaRoot();
  const requested = normalize(join(root, ...path));

  // Containment check: reject anything that escaped the root via "..".
  if (!requested.startsWith(root + sep)) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const data = await readFile(requested);
    const ext = requested.split(".").pop()?.toLowerCase() ?? "";
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
