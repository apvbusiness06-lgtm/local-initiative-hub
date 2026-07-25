// Provider-agnostic object storage, same shape as lib/mailer.ts: a local-disk
// adapter is the default so the app works with no cloud storage configured;
// set MEDIA_STORAGE=s3|gcs and implement that adapter to swap it out without
// touching callers. Local disk is fine for single-node/Docker-volume
// deployments; on ephemeral filesystems (Cloud Run) point MEDIA_LOCAL_DIR at
// a mounted volume or implement a cloud adapter before relying on it.

import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface StoredObject {
  key: string; // stable path fragment, e.g. "business/<id>/gallery/<uuid>.webp"
  url: string; // public URL the browser loads
}

export interface MediaStore {
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}

// Files land under <root>/<key> and are served by app/media/[...path]/route.ts.
class LocalDiskStore implements MediaStore {
  constructor(private readonly root: string, private readonly baseUrl: string) {}

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  async put(key: string, data: Buffer): Promise<StoredObject> {
    const full = join(this.root, key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    return { key, url: this.publicUrl(key) };
  }

  async remove(key: string): Promise<void> {
    await unlink(join(this.root, key)).catch(() => {});
  }
}

// Supabase Storage adapter — uses the public URL from a Supabase Storage bucket.
// Set MEDIA_STORAGE=supabase plus SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
// optionally SUPABASE_STORAGE_BUCKET (defaults to "media").
class SupabaseStore implements MediaStore {
  private client: import("@supabase/supabase-js").SupabaseClient | null = null;
  private readonly bucket: string;
  private readonly supabaseUrl: string;

  constructor(supabaseUrl: string, serviceRoleKey: string, bucket: string) {
    this.supabaseUrl = supabaseUrl;
    this.bucket = bucket;
    // Lazy-import to avoid loading Supabase SDK when not needed.
    const { createClient } = require("@supabase/supabase-js");
    this.client = createClient(supabaseUrl, serviceRoleKey);
  }

  publicUrl(key: string): string {
    return `${this.supabaseUrl}/storage/v1/object/public/${this.bucket}/${key}`;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const { error } = await this.client!.storage
      .from(this.bucket)
      .upload(key, data, { contentType, upsert: true });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
    return { key, url: this.publicUrl(key) };
  }

  async remove(key: string): Promise<void> {
    await this.client!.storage.from(this.bucket).remove([key]);
  }
}

let singleton: MediaStore | null = null;

export function getMediaStore(): MediaStore {
  if (singleton) return singleton;

  const provider = process.env.MEDIA_STORAGE ?? "local";

  if (provider === "supabase") {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "MEDIA_STORAGE=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      );
    }
    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "media";
    singleton = new SupabaseStore(url, key, bucket);
    return singleton;
  }

  if (provider !== "local") {
    throw new Error(
      `MEDIA_STORAGE=${provider} requested but no such adapter is implemented. ` +
        "Implement it against the MediaStore interface (see lib/storage.ts)."
    );
  }
  const root = process.env.MEDIA_LOCAL_DIR ?? join(process.cwd(), "storage", "media");
  singleton = new LocalDiskStore(root, "/media");
  return singleton;
}

/** Absolute filesystem root the /media route serves from — must match the store. */
export function localMediaRoot(): string {
  return process.env.MEDIA_LOCAL_DIR ?? join(process.cwd(), "storage", "media");
}
