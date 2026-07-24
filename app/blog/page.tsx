// Minimal published-content list. ContentItem is platform-wide (no
// tenantId) so this page isn't tenant-filtered — only branding/header are.

import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveTenant } from "@/lib/tenant";
import { getPublishedContent } from "@/lib/content";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { Header } from "@/components/Header";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) return {};
  return { title: `Community & guides — ${tenant.name}` };
}

const KIND_LABELS: Record<string, string> = {
  BLOG: "Blog",
  NEWS: "News",
  GUIDE: "Guide",
  SPOTLIGHT: "Spotlight",
  WHATS_ON: "What's on",
  JOB: "Job",
  ANNOUNCEMENT: "Announcement",
};

export default async function BlogIndexPage() {
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();

  const posts = await getPublishedContent();

  return (
    <main
      className="min-h-screen"
      style={
        {
          "--ink": tenant.branding.colorInk,
          "--primary": tenant.branding.colorPrimary,
          "--surface": tenant.branding.colorSurface,
          backgroundColor: "var(--surface)",
          color: "var(--ink)",
        } as React.CSSProperties
      }
    >
      <Header tenant={tenant} user={user} />

      <div className="mx-auto max-w-4xl px-5 py-10">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Community & guides</h1>
        <p className="mt-2 text-sm opacity-70">News, guides and updates from {tenant.name}.</p>

        {posts.length > 0 ? (
          <ul className="mt-8 space-y-4">
            {posts.map((p) => (
              <li key={p.slug} className="rounded-xl border border-black/[0.07] bg-white p-5 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
                <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "var(--primary)" }}>
                  {KIND_LABELS[p.kind] ?? p.kind}
                </span>
                <h2 className="mt-1 text-lg font-semibold">
                  <a href={`/blog/${p.slug}`} className="hover:underline">
                    {p.title}
                  </a>
                </h2>
                {p.excerpt && <p className="mt-1.5 text-sm opacity-75">{p.excerpt}</p>}
                {p.publishedAt && (
                  <p className="mt-2 text-xs opacity-50">
                    {p.publishedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-8 text-sm opacity-60">Nothing published yet.</p>
        )}
      </div>
    </main>
  );
}
