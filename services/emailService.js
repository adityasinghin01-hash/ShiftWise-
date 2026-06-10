// services/emailService.js
// Brevo HTTP API — native fetch only. No nodemailer, no SMTP, no axios.
// M9 FIX: HTML templates moved to templates/email.js
// H6 FIX (Wave 4): bounded fetch timeout via AbortController so a hung Brevo
// connection can no longer leak request handlers indefinitely.

const config = require('../config/config');
const t = require('../templates/email');
const htmlEscape = require('../utils/htmlEscape');
const logger = require('../config/logger');

const EMAIL_TIMEOUT_MS = 10_000; // 10s ceiling per Brevo call

// ── Core Send Function ───────────────────────────────────
const sendEmail = async ({ to, toName, subject, html, text }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);

  let response;
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': config.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: { name: config.BREVO_SENDER_NAME, email: config.BREVO_SENDER_EMAIL },
        to: [{ email: to, name: toName || 'User' }],
        subject,
        htmlContent: html,
        textContent: text,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Brevo request timed out after ${EMAIL_TIMEOUT_MS}ms`);
    }
    throw err;
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Brevo usually returns JSON, but fall back to text on a malformed body so
    // the upstream try/catch always sees a useful error message.
    let detail;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text().catch(() => '');
    }
    logger.error('Brevo email send failed', { status: response.status, detail });
    throw new Error(`Brevo error (${response.status}): ${JSON.stringify(detail)}`);
  }

  try {
    return await response.json();
  } catch {
    return {};
  }
};

// ── Verification Email ───────────────────────────────────
const sendVerificationEmail = async (email, rawToken, source = 'app') => {
  const verificationUrl = `${config.BASE_URL}/api/v1/verify-email?token=${rawToken}&source=${source}`;
  await sendEmail({
    to: email,
    subject: 'Verify Your Email Address',
    text: `Verify your email: ${verificationUrl}\n\nExpires in 24 hours.\n\nIf you did not create this account, ignore this email.`,
    html: t.verificationEmail({ verificationUrl }),
  });
};

// ── Password Reset Email ─────────────────────────────────
const sendPasswordResetEmail = async (email, rawToken) => {
  const resetUrl = `${config.CLIENT_URL}/#reset-password?token=${rawToken}`;
  await sendEmail({
    to: email,
    subject: 'Password Reset Request',
    text: `Reset your password: ${resetUrl}\n\nExpires in 15 minutes.\n\nIf you did not request this, ignore this email.`,
    html: t.passwordResetEmail({ resetUrl }),
  });
};

// ── OTP Email ────────────────────────────────────────────
const sendOtpEmail = async (email, otp) => {
  await sendEmail({
    to: email,
    subject: 'Your Password Reset Code',
    text: `Your password reset code is: ${otp}\n\nExpires in 15 minutes.\n\nIf you did not request this, ignore this email.`,
    html: t.otpEmail({ otp: htmlEscape(String(otp)) }),
  });
};

module.exports = { sendEmail, sendVerificationEmail, sendPasswordResetEmail, sendOtpEmail };
