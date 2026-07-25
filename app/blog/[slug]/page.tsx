import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { getContentBySlug } from "@/lib/content";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { Header } from "@/components/Header";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getContentBySlug(slug);
  if (!post) return {};
  return { title: post.title, description: post.excerpt ?? undefined };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const host = (await headers()).get("host") ?? "";
  const [tenant, user, post] = await Promise.all([resolveTenant(host), getCurrentUser(), getContentBySlug(slug)]);
  if (!tenant || !post) notFound();

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

      <article className="mx-auto max-w-2xl px-5 py-10">
        <Link href="/blog" className="mb-6 inline-block text-sm opacity-70 transition hover:opacity-100">
          ← Community & guides
        </Link>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{post.title}</h1>
        {post.publishedAt && (
          <p className="mt-2 text-xs opacity-50">
            {post.publishedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        )}
        <div className="prose prose-sm mt-6 max-w-none space-y-4">
          {post.bodyBlocks.map((b, i) =>
            b.type === "heading" ? (
              <h2 key={i} className="font-heading text-xl font-semibold">
                {b.text}
              </h2>
            ) : (
              <p key={i} className="text-sm leading-relaxed opacity-80">
                {b.text}
              </p>
            )
          )}
        </div>
      </article>
    </main>
  );
}
