import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/env";

/**
 * Mailversand über SMTP. Zugangsdaten kommen ausschließlich aus der Umgebung (SMTP_*).
 * Ohne SMTP_HOST ist der Versand deaktiviert.
 */
export type Mail = { to: string[]; subject: string; text: string };
export type MailSender = (mail: Mail) => Promise<void>;

let transporter: Transporter | undefined;

export function mailConfigured(): boolean {
  return Boolean(env().SMTP_HOST);
}

export const sendMail: MailSender = async (mail) => {
  const e = env();
  if (!e.SMTP_HOST) throw new Error("Mailversand ist nicht konfiguriert (SMTP_HOST fehlt).");
  transporter ??= nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD ?? "" } : undefined,
  });
  await transporter.sendMail({
    from: e.SMTP_FROM || e.SMTP_USER,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
};
