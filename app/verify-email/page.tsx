import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveTenant } from "@/lib/tenant";
import { AuthCard } from "@/components/AuthCard";

const COPY: Record<string, { title: string; body: string }> = {
  success: { title: "Email verified", body: "Your email address is confirmed — you can log in now." },
  "already-used": { title: "Link already used", body: "This verification link has already been used." },
  expired: { title: "Link expired", body: "This verification link has expired. Register again to get a new one." },
  invalid: { title: "Invalid link", body: "This verification link isn't valid." },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const host = (await headers()).get("host") ?? "";
  const tenant = await resolveTenant(host);
  if (!tenant) notFound();

  const { status } = await searchParams;
  const copy = COPY[status ?? ""] ?? COPY.invalid!;

  return (
    <AuthCard tenant={tenant} title={copy.title}>
      <p className="text-sm opacity-80">{copy.body}</p>
      <a
        href="/login"
        className="mt-6 inline-block rounded-lg px-4 py-2.5 text-sm font-medium text-white"
        style={{ backgroundColor: "var(--primary)" }}
      >
        Go to log in
      </a>
    </AuthCard>
  );
}
