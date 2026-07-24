import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { resolveTenant } from "@/lib/tenant";
import { getCurrentUser } from "@/lib/auth/currentUser";
import { getPortalBusiness, type PortalBusiness } from "@/lib/portal";
import { dayLabel, sortMondayFirst } from "@/lib/openingHours";
import { Header } from "@/components/Header";
import {
  saveProfileAction,
  saveCategoriesAction,
  saveHoursAction,
  addServiceAction,
  deleteServiceAction,
  uploadImageAction,
  deleteImageAction,
} from "../actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PortalEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { businessId } = await params;
  const host = (await headers()).get("host") ?? "";
  const [tenant, user] = await Promise.all([resolveTenant(host), getCurrentUser()]);
  if (!tenant) notFound();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/portal/${businessId}`)}`);

  const biz = await getPortalBusiness(user.id, businessId);
  if (!biz) redirect("/portal?error=forbidden");

  const sp = await searchParams;
  const saved = (Array.isArray(sp.saved) ? sp.saved[0] : sp.saved) ?? null;
  const error = (Array.isArray(sp.error) ? sp.error[0] : sp.error) ?? null;

  const cssVars = {
    "--ink": tenant.branding.colorInk,
    "--primary": tenant.branding.colorPrimary,
    "--surface": tenant.branding.colorSurface,
    backgroundColor: "var(--surface)",
    color: "var(--ink)",
  } as React.CSSProperties;

  const selected = new Set(biz.categories.map((c) => c.slug));

  return (
    <main className="min-h-screen" style={cssVars}>
      <Header tenant={tenant} user={user} />
      <div className="mx-auto max-w-3xl px-5 py-10">
        <Link href="/portal" className="text-sm opacity-70 transition hover:opacity-100">
          ← All listings
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{biz.tradingName}</h1>
          <div className="flex items-center gap-4">
            <a href={`/portal/${biz.id}/billing`} className="text-sm font-medium underline" style={{ color: "var(--primary)" }}>
              Billing &amp; plan
            </a>
            <a href={`/listing/${biz.slug}`} className="text-sm font-medium underline" style={{ color: "var(--primary)" }}>
              View public page →
            </a>
          </div>
        </div>
        <p className="mt-1 text-xs opacity-60">
          Status: {biz.status.replace("_", " ").toLowerCase()}
          {biz.pendingModeration && " · an identity change is awaiting admin approval"}
        </p>

        {saved === "1" && <Banner tone="ok">Saved.</Banner>}
        {saved === "review" && (
          <Banner tone="warn">
            Saved. Because you changed the business name or description, the change goes live once an admin approves it.
          </Banner>
        )}
        {error && <Banner tone="error">{error}</Banner>}

        {/* PROFILE */}
        <Section id="profile" title="Profile">
          <form action={saveProfileAction.bind(null, biz.id)} className="space-y-3">
            <Field label="Business name" name="tradingName" defaultValue={biz.tradingName} required />
            <Field label="Short summary (max 280 chars)" name="summary" defaultValue={biz.summary ?? ""} maxLength={280} />
            <TextArea label="Description" name="description" defaultValue={biz.description ?? ""} rows={5} />
            <Field label="Website" name="websiteUrl" defaultValue={biz.websiteUrl ?? ""} placeholder="https://…" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone" name="phone" defaultValue={biz.location?.phone ?? ""} />
              <Field label="Public email" name="email" defaultValue={biz.location?.email ?? ""} />
            </div>
            <Field label="Address line 1" name="addressLine1" defaultValue={biz.location?.addressLine1 ?? ""} />
            <Field label="Address line 2" name="addressLine2" defaultValue={biz.location?.addressLine2 ?? ""} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Town / city" name="locality" defaultValue={biz.location?.locality ?? ""} />
              <Field label="Postcode" name="postcode" defaultValue={biz.location?.postcode ?? ""} />
            </div>
            <p className="text-xs opacity-60">
              Changing the business name or description sends the listing for a quick re-approval before it shows publicly.
            </p>
            <SaveButton />
          </form>
        </Section>

        {/* CATEGORIES */}
        <Section id="categories" title={`Categories (up to ${biz.categoriesLimit})`}>
          <form action={saveCategoriesAction.bind(null, biz.id)} className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {biz.allCategories.map((c) => (
                <label
                  key={c.slug}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full border border-black/10 px-3 py-1 text-xs transition has-[:checked]:border-[var(--primary)] has-[:checked]:bg-[var(--primary)] has-[:checked]:text-white"
                >
                  <input type="checkbox" name="cat" value={c.slug} defaultChecked={selected.has(c.slug)} className="sr-only" />
                  {c.name}
                </label>
              ))}
            </div>
            <p className="text-xs opacity-60">The first selected category is your primary one.</p>
            <SaveButton />
          </form>
        </Section>

        {/* HOURS */}
        <Section id="hours" title="Opening hours">
          {biz.location ? (
            <form action={saveHoursAction.bind(null, biz.id)} className="space-y-2">
              {sortMondayFirst(
                Array.from({ length: 7 }, (_, day) => {
                  const h = biz.openingHours.find((x) => x.dayOfWeek === day);
                  return h ?? { dayOfWeek: day, opensAt: "09:00", closesAt: "17:00", isClosed: day === 0 };
                })
              ).map((h) => (
                <div key={h.dayOfWeek} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="w-24 opacity-70">{dayLabel(h.dayOfWeek)}</span>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" name={`closed_${h.dayOfWeek}`} defaultChecked={h.isClosed} /> Closed
                  </label>
                  <input
                    type="time"
                    name={`opens_${h.dayOfWeek}`}
                    defaultValue={h.opensAt}
                    className="rounded-lg border border-black/10 px-2 py-1 text-sm"
                  />
                  <span className="opacity-50">–</span>
                  <input
                    type="time"
                    name={`closes_${h.dayOfWeek}`}
                    defaultValue={h.closesAt}
                    className="rounded-lg border border-black/10 px-2 py-1 text-sm"
                  />
                </div>
              ))}
              <SaveButton />
            </form>
          ) : (
            <p className="text-sm opacity-60">Add an address in your profile first.</p>
          )}
        </Section>

        {/* SERVICES */}
        <Section id="services" title="Services">
          {biz.services.length > 0 && (
            <ul className="mb-4 space-y-2">
              {biz.services.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-black/[0.07] p-3 text-sm">
                  <div>
                    <span className="font-medium">{s.name}</span>
                    {s.priceMinor != null && (
                      <span className="ml-2 opacity-70">
                        {s.isFromPrice ? "from " : ""}
                        {new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(s.priceMinor / 100)}
                      </span>
                    )}
                    {s.description && <p className="mt-0.5 text-xs opacity-60">{s.description}</p>}
                  </div>
                  <form action={deleteServiceAction.bind(null, biz.id, s.id)}>
                    <button className="text-xs text-red-600 hover:underline">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addServiceAction.bind(null, biz.id)} className="space-y-3 border-t border-black/[0.06] pt-4">
            <Field label="Service name" name="name" required />
            <TextArea label="Description" name="description" rows={2} />
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Price (£)" name="price" placeholder="e.g. 85" />
              <label className="flex items-center gap-1.5 pb-2 text-sm">
                <input type="checkbox" name="isFromPrice" /> “From” price
              </label>
            </div>
            <button
              type="submit"
              className="rounded-lg border border-black/10 px-4 py-2 text-sm font-medium transition hover:bg-black/[0.03]"
            >
              Add service
            </button>
          </form>
        </Section>

        {/* GALLERY */}
        <Section id="gallery" title={`Gallery (${biz.gallery.length}/${biz.imagesLimit})`}>
          {biz.gallery.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {biz.gallery.map((m) => (
                <div key={m.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={m.altText ?? ""} className="h-28 w-full rounded-lg border border-black/[0.07] object-cover" />
                  <form action={deleteImageAction.bind(null, biz.id, m.id)} className="absolute right-1 top-1">
                    <button className="rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">Remove</button>
                  </form>
                </div>
              ))}
            </div>
          )}
          {biz.gallery.length < biz.imagesLimit ? (
            <form action={uploadImageAction.bind(null, biz.id)} className="space-y-2" encType="multipart/form-data">
              <input
                type="file"
                name="image"
                accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
                required
                className="block text-sm"
              />
              <Field label="Alt text (describe the image)" name="altText" />
              <button
                type="submit"
                className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: "var(--primary)" }}
              >
                Upload image
              </button>
              <p className="text-xs opacity-60">JPEG, PNG, WebP, AVIF or GIF up to 8 MB. Images are re-encoded and stripped of metadata.</p>
            </form>
          ) : (
            <p className="text-sm opacity-60">
              You&apos;ve reached your plan&apos;s image limit. Remove one to add another, or upgrade your plan.
            </p>
          )}
        </Section>
      </div>
    </main>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-6 scroll-mt-6 rounded-xl border border-black/[0.07] bg-white p-6 shadow-[0_1px_2px_rgba(48,43,39,0.04)]">
      <h2 className="font-heading mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium opacity-80">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
      />
    </label>
  );
}

function TextArea({ label, name, defaultValue, rows }: { label: string; name: string; defaultValue?: string; rows: number }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium opacity-80">{label}</span>
      <textarea
        name={name}
        defaultValue={defaultValue}
        rows={rows}
        className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
      />
    </label>
  );
}

function SaveButton() {
  return (
    <button type="submit" className="rounded-lg px-5 py-2 text-sm font-medium text-white transition" style={{ backgroundColor: "var(--primary)" }}>
      Save
    </button>
  );
}

function Banner({ tone, children }: { tone: "ok" | "warn" | "error"; children: React.ReactNode }) {
  const cls = tone === "ok" ? "bg-emerald-50 text-emerald-800" : tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-700";
  return <p className={`mt-4 rounded-lg p-3 text-sm ${cls}`}>{children}</p>;
}
