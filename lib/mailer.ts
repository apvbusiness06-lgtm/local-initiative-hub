// Provider-agnostic mail adapter. No SMTP_URL configured (the default in
// every environment right now, including this one) means every send goes
// through the sandbox mailer: it never claims a message reached a real
// inbox, and the caller gets the rendered text back to show inline —
// "connection required", not a fake success state.
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface MailResult {
  delivered: boolean;
  sandbox: boolean;
  previewText?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<MailResult>;
}

class ConsoleSandboxMailer implements Mailer {
  async send(message: MailMessage): Promise<MailResult> {
    // eslint-disable-next-line no-console
    console.log(`[mailer:sandbox] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return { delivered: true, sandbox: true, previewText: message.text };
  }
}

// Real transactional email over SMTP. Provider-agnostic: SMTP_URL works with
// any transactional provider that speaks SMTP (Resend, Postmark, SES, Mailgun,
// SendGrid, a self-hosted relay...). MAIL_FROM sets the envelope/from address.
class SmtpMailer implements Mailer {
  // nodemailer is imported lazily so the sandbox path never loads it.
  private transportPromise: Promise<import("nodemailer").Transporter> | null = null;

  private async transport() {
    if (!this.transportPromise) {
      this.transportPromise = import("nodemailer").then((nm) => nm.createTransport(process.env.SMTP_URL));
    }
    return this.transportPromise;
  }

  async send(message: MailMessage): Promise<MailResult> {
    const transport = await this.transport();
    const from = process.env.MAIL_FROM || "Local Initiative <no-reply@localhost>";
    await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
    return { delivered: true, sandbox: false };
  }
}

/**
 * The sandbox mailer (console + inline preview) is the default so the app
 * works with no email provider configured, never claiming a real send. Set
 * SMTP_URL to route through a real provider.
 */
export function getMailer(): Mailer {
  if (!process.env.SMTP_URL) {
    return new ConsoleSandboxMailer();
  }
  return new SmtpMailer();
}
