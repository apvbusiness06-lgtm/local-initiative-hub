# Legal templates — ⚠️ DRAFT, REQUIRES SOLICITOR REVIEW BEFORE PUBLICATION

These are **starting-point templates**, not legal advice and not
launch-ready. UK GDPR / PECR compliance and consumer law depend on facts this
document can't know (your lawful bases, retention periods, sub-processors,
company details). **A qualified solicitor must review and complete these
before any version is published or any real personal data is collected in
production.** Placeholders are marked `[LIKE THIS]`.

The platform is already built to support what these documents will promise:
consent is recorded with its exact wording version (`ConsentRecord`), marketing
sends are gated on un-withdrawn consent, unsubscribe works from a tokenised
link without login, and analytics session identifiers are hashed, never stored
raw.

---

## Privacy Policy (template)

**Data controller:** [LEGAL ENTITY NAME], [REGISTERED ADDRESS], [COMPANY NO.].
Contact: [PRIVACY@DOMAIN]. [ICO REGISTRATION NO.]

**What we collect**
- Account data: email, password (hashed), and any profile details you provide.
- Business data (for listing owners): business details, contact info, media.
- Enquiries: name, email, phone and message when you contact a business.
- Newsletter: email and interests, with a record of the consent you gave.
- Analytics: pages viewed and actions taken, tied to a **hashed** session
  identifier, not to your identity. Obvious bot traffic is discarded.

**Why, and our lawful basis (UK GDPR Art. 6)**
- Providing the service and your account — *performance of a contract*.
- Sending an enquiry to a business — *legitimate interests / your request*.
- Marketing newsletter — *consent* (withdraw any time; see below).
- Security, fraud prevention, and audit logging — *legitimate interests*.

**Marketing and consent (PECR)**
We send marketing email only where you have given consent, recorded with the
exact wording you agreed to. Every marketing email includes a one-click
unsubscribe link that needs no login; unsubscribing withdraws your consent and
stops sends immediately. You can also withdraw consent at [ACCOUNT SETTINGS].

**Sharing**
- Businesses you enquire with receive your enquiry.
- Processors acting on our instructions: [PAYMENTS: Stripe], [EMAIL PROVIDER],
  [CRM: GoHighLevel, where a tenant has connected it], [HOSTING].
  We do not sell personal data.

**Retention**
We keep personal data only as long as necessary for the purpose collected:
[SPECIFY PERIODS — e.g. account data until closure + [N] months; enquiries
[N] months; analytics rollups [N] months]. [CONFIRM WITH COUNSEL.]

**Your rights**
Access, rectification, erasure, restriction, portability, objection, and the
right to withdraw consent. To exercise them, contact [PRIVACY@DOMAIN]. You may
complain to the ICO (ico.org.uk).

**International transfers**
[STATE WHETHER ANY PROCESSOR TRANSFERS DATA OUTSIDE THE UK/EEA AND THE
SAFEGUARD RELIED ON — e.g. IDTA / SCCs.]

**Cookies**
[COMPLETE A COOKIE AUDIT. Session cookies are strictly necessary for login.
Declare any analytics/marketing cookies and obtain consent where required.]

_Last updated: [DATE]. Version: [VERSION]._

---

## Terms of Service (template)

**1. Who we are.** The platform is operated by [LEGAL ENTITY], [ADDRESS],
[COMPANY NO.].

**2. Accounts.** You are responsible for your account and for keeping your
credentials secure. You must provide accurate information and be [16]+.

**3. Business listings.** Listing owners must have authority to manage the
business they claim. We verify ownership before granting access and may
suspend listings that breach these terms. Edits to key public details are
reviewed before they go live.

**4. Reviews.** Reviews must reflect genuine experience. We do not gate reviews
(we never solicit only positive ones) and we do not fabricate them.
Business-provided testimonials are labelled as such. We may remove reviews that
breach [CONTENT POLICY].

**5. Offers and vouchers.** Offers are between the business and the customer.
Voucher codes are single-use unless stated. [BUSINESS] is responsible for
honouring its offers; [OPERATOR] is not a party to the transaction.

**6. Payments and subscriptions.** Paid business plans are billed via Stripe on
the cycle you choose. [STATE RENEWAL, CANCELLATION, AND REFUND TERMS — align
with the Consumer Contracts Regulations.] Entitlements change only when the
payment provider confirms the change.

**7. Acceptable use.** No unlawful, infringing, or harmful content; no scraping
or interference with the service; no impersonation.

**8. Liability.** [STANDARD LIMITATION OF LIABILITY, SUBJECT TO UK LAW —
nothing excludes liability that cannot lawfully be excluded.]

**9. Termination.** Either party may close the account per [SECTION]. We may
suspend for breach.

**10. Governing law.** These terms are governed by the laws of England and
Wales [OR AS ADVISED].

_Last updated: [DATE]. Version: [VERSION]._
