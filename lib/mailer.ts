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

/**
 * Real transactional email (Slice 13 territory) isn't wired up yet. Until
 * SMTP_URL is set, callers get the sandbox mailer and must surface its
 * sandbox flag to the user rather than claiming a real email was sent.
 */
export function getMailer(): Mailer {
  if (!process.env.SMTP_URL) {
    return new ConsoleSandboxMailer();
  }
  throw new Error(
    "SMTP_URL is configured but no real SMTP adapter is implemented yet. " +
      "Connect a transactional email provider before relying on real delivery — see BACKLOG.md."
  );
}
