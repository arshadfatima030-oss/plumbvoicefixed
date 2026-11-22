import {escapeHtml} from './validate.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const isProd = process.env.NODE_ENV === 'production';

export function mailConfigured(): boolean {
  return Boolean(process.env.SENDGRID_API_KEY && process.env.MAIL_FROM);
}

/**
 * Sends transactional email through SendGrid. Without SENDGRID_API_KEY + MAIL_FROM
 * nothing is sent: in development the message is printed so links can be tested;
 * in production only a warning is logged (links contain secrets and are never logged).
 * Mail should come from a verified domain sender (MAIL_FROM), not a personal inbox,
 * or it will land in spam.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  if (!mailConfigured()) {
    if (isProd) {
      console.warn(`[mail] SENDGRID_API_KEY/MAIL_FROM not set; email "${mail.subject}" was not sent.`);
    } else {
      console.log(`\n[mail:dev] To: ${mail.to}\n[mail:dev] Subject: ${mail.subject}\n${mail.text}\n`);
    }
    return false;
  }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{to: [{email: mail.to}]}],
        from: {email: process.env.MAIL_FROM, name: 'PlumbVoice AI'},
        subject: mail.subject,
        content: [
          {type: 'text/plain', value: mail.text},
          ...(mail.html ? [{type: 'text/html', value: mail.html}] : []),
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[mail] SendGrid rejected message (${res.status}).`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[mail] send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

function layout(title: string, bodyHtml: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#23282D">
<h2 style="margin:0 0 16px">${escapeHtml(title)}</h2>${bodyHtml}
<p style="color:#7A746B;font-size:12px;margin-top:32px">PlumbVoice AI</p></div>`;
}

function button(url: string, label: string): string {
  return `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#C8672B;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a></p>
<p style="font-size:12px;color:#7A746B;word-break:break-all">${escapeHtml(url)}</p>`;
}

export function verificationEmail(name: string, url: string): Mail & {to: ''} {
  return {
    to: '',
    subject: 'Verify your PlumbVoice AI email',
    text: `Hi ${name},\n\nConfirm your email to finish setting up PlumbVoice AI:\n${url}\n\nThis link expires in 24 hours. If you didn't sign up, ignore this email.`,
    html: layout(
      'Confirm your email',
      `<p>Hi ${escapeHtml(name)}, confirm your email to finish setting up your account.</p>${button(url, 'Verify email')}<p style="font-size:13px">This link expires in 24 hours. If you didn't sign up, ignore this email.</p>`
    ),
  };
}

export function resetEmail(name: string, url: string): Mail & {to: ''} {
  return {
    to: '',
    subject: 'Reset your PlumbVoice AI password',
    text: `Hi ${name},\n\nUse this link to choose a new password:\n${url}\n\nIt expires in 1 hour. If you didn't ask for this, you can ignore this email.`,
    html: layout(
      'Reset your password',
      `<p>Hi ${escapeHtml(name)}, use the button below to choose a new password.</p>${button(url, 'Reset password')}<p style="font-size:13px">It expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`
    ),
  };
}

function codeBlock(code: string): string {
  return `<p style="font-size:32px;letter-spacing:8px;font-weight:700;font-family:monospace;margin:16px 0">${escapeHtml(code)}</p>`;
}

export function loginCodeEmail(name: string, code: string, userAgent: string): Mail & {to: ''} {
  return {
    to: '',
    subject: `Your PlumbVoice AI sign-in code: ${code}`,
    text: `Hi ${name},\n\nYour sign-in code is ${code}. It expires in 10 minutes.\n\nSign-in attempt from: ${userAgent}\n\nIf this wasn't you, change your password right away. Never share this code.`,
    html: layout(
      'Your sign-in code',
      `<p>Hi ${escapeHtml(name)}, enter this code to finish signing in. It expires in 10 minutes.</p>${codeBlock(code)}<p style="font-size:13px"><b>Sign-in attempt from:</b> ${escapeHtml(userAgent)}</p><p style="font-size:13px">If this wasn't you, change your password right away. Never share this code.</p>`
    ),
  };
}

export function actionCodeEmail(name: string, code: string): Mail & {to: ''} {
  return {
    to: '',
    subject: `Confirm this change: ${code}`,
    text: `Hi ${name},\n\nYour confirmation code is ${code}. It expires in 10 minutes.\n\nYou are being asked to confirm a sensitive change (password, billing or team). If this wasn't you, change your password right away. Never share this code.`,
    html: layout(
      'Confirm this change',
      `<p>Hi ${escapeHtml(name)}, enter this code to confirm a sensitive change to your account (password, billing or team).</p>${codeBlock(code)}<p style="font-size:13px">If this wasn't you, change your password right away. Never share this code.</p>`
    ),
  };
}

export function leadAlertEmail(o: {
  to: string;
  businessName: string;
  kind: 'emergency' | 'new-lead' | 'missed-call';
  name: string;
  phone: string;
  summary: string;
  url?: string;
}): Mail {
  const label = o.kind === 'emergency' ? 'EMERGENCY' : o.kind === 'missed-call' ? 'Missed call' : 'New lead';
  const subject = `${label}: ${o.name} (${o.phone})`.slice(0, 200);
  const text = `${label} for ${o.businessName}\n\nCaller: ${o.name}\nPhone: ${o.phone}\n\n${o.summary}\n${o.url ? `\nOpen in PlumbVoice: ${o.url}\n` : ''}`;
  const html = layout(
    `${label} — ${o.businessName}`,
    `<p><strong>${escapeHtml(o.name)}</strong><br>${escapeHtml(o.phone)}</p><p>${escapeHtml(o.summary)}</p>${o.url ? button(o.url, 'Open lead') : ''}`
  );
  return {to: o.to, subject, text, html};
}
