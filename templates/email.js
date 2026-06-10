// templates/email.js
// M9 FIX: Externalized email HTML templates.
// Replaces inline HTML strings scattered across emailService.js and
// verificationController.js with a single named-template registry.
// Templates are plain functions — no dependencies, no file system reads.

'use strict';

// Shared base wrapper (minimal inline CSS, kept tight for email clients)
const base = (body) => `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:#fff}
.w{max-width:600px;margin:0 auto;padding:40px 20px}
h2{color:#111;font-size:22px;margin-bottom:8px}
p{color:#444;font-size:15px;line-height:1.6;margin-bottom:16px}
.btn{display:inline-block;background:#111;color:#fff;padding:14px 32px;text-decoration:none;border-radius:4px;font-size:15px;font-weight:600}
.code{display:inline-block;background:#f4f4f5;padding:16px 40px;border-radius:8px;font-size:32px;font-weight:700;letter-spacing:8px;color:#111}
hr{border:none;border-top:1px solid #eee;margin:32px 0}
.muted{color:#999;font-size:12px}
</style></head>
<body><div class="w">${body}</div></body>
</html>`;

const templates = {
  /** Email verification link */
  verificationEmail: ({ verificationUrl }) =>
    base(`
      <h2>Verify Your Email</h2>
      <p>Click the button below to activate your account. This link expires in <strong>24 hours</strong>.</p>
      <div style="text-align:center;margin:32px 0">
        <a href="${verificationUrl}" class="btn">Verify Email</a>
      </div>
      <hr><p class="muted">If you did not create this account, ignore this email.</p>
    `),

  /** Password reset link (web flow) */
  passwordResetEmail: ({ resetUrl }) =>
    base(`
      <h2>Reset Your Password</h2>
      <p>We received a password reset request. This link expires in <strong>15 minutes</strong>.</p>
      <div style="text-align:center;margin:32px 0">
        <a href="${resetUrl}" class="btn">Reset Password</a>
      </div>
      <hr><p class="muted">If you did not request this, ignore this email.</p>
    `),

  /** 6-digit OTP code */
  otpEmail: ({ otp }) =>
    base(`
      <h2>Password Reset Code</h2>
      <p>Use the code below to reset your password. It expires in <strong>15 minutes</strong>.</p>
      <div style="text-align:center;margin:32px 0">
        <span class="code">${otp}</span>
      </div>
      <hr><p class="muted">If you did not request this code, ignore this email.</p>
    `),

  /** Email verified — web source (auto-closing tab) */
  emailVerifiedWeb: () => `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;color:#f1f5f9;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:rgba(255,255,255,.05);border:1px solid rgba(6,182,212,.3);border-radius:24px;padding:48px 32px;text-align:center;max-width:440px;width:90%}h1{font-size:28px;font-weight:800;margin-bottom:12px}p{color:#475569;line-height:1.6}.icon{font-size:64px;margin-bottom:20px}#closing{color:#06b6d4;font-size:13px;margin-top:16px}</style>
</head>
<body><div class="card"><div class="icon">✅</div><h1>Email Verified!</h1>
<p id="msg">Closing this tab and returning you to the app...</p></div>
<script>setTimeout(function(){window.close();setTimeout(function(){document.getElementById("msg").textContent="Your account is verified! You can close this tab."},500)},1200)</script>
</body></html>`,

  /** Email verified — app source (deep-link button) */
  emailVerifiedApp: () => `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;color:#f1f5f9;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:24px;padding:48px 32px;text-align:center;max-width:440px;width:90%}h1{font-size:28px;font-weight:800;margin-bottom:12px}p{color:#475569;margin-bottom:28px;line-height:1.6}a{display:inline-block;padding:14px 32px;border-radius:999px;background:linear-gradient(135deg,#7c3aed,#06b6d4);color:#fff;font-weight:700;text-decoration:none;font-size:15px}.icon{font-size:64px;margin-bottom:20px}</style>
</head>
<body><div class="card"><div class="icon">✅</div><h1>Email Verified!</h1>
<p>Your account is ready. Return to the app to continue.</p>
<a href="myapp://dashboard">Open App</a></div></body></html>`,

  /** Reset password page — valid token */
  resetPasswordPage: ({ token }) => `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Reset Password</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:white;border-radius:20px;padding:50px 40px;text-align:center;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.2)}.icon{font-size:64px;margin-bottom:20px}h1{color:#333;font-size:26px;margin-bottom:12px}p{color:#666;font-size:15px;line-height:1.6;margin-bottom:30px}.btn{background:linear-gradient(135deg,#667eea,#764ba2);color:white;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:600;display:inline-block}</style>
</head>
<body><div class="card"><div class="icon">🔑</div><h1>Reset Your Password</h1>
<p>Your reset link is valid. Tap the button below to open the app and set your new password.</p>
<a href="myapp://reset-password?token=${token}" class="btn">Reset Password →</a></div></body></html>`,

  /** Reset password page — expired / invalid token */
  resetPasswordExpired: () => `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Link Expired</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#f093fb,#f5576c);min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:white;border-radius:20px;padding:50px 40px;text-align:center;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.2)}.icon{font-size:64px;margin-bottom:20px}h1{color:#333;font-size:26px;margin-bottom:12px}p{color:#666;font-size:15px;line-height:1.6;margin-bottom:30px}.btn{background:linear-gradient(135deg,#f093fb,#f5576c);color:white;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:600;display:inline-block}</style>
</head>
<body><div class="card"><div class="icon">❌</div><h1>Link Expired</h1>
<p>This password reset link is invalid or has expired. Please request a new one from the app.</p>
<a href="myapp://forgot-password" class="btn">Back to App →</a></div></body></html>`,

  /** Email verification page — expired / invalid token */
  verificationExpired: () => `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Verification Failed</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;background:linear-gradient(135deg,#f093fb,#f5576c);min-height:100vh;display:flex;align-items:center;justify-content:center}.card{background:white;border-radius:20px;padding:50px 40px;text-align:center;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.2)}.icon{font-size:64px;margin-bottom:20px}h1{color:#333;font-size:26px;margin-bottom:12px}p{color:#666;font-size:15px;line-height:1.6;margin-bottom:30px}.btn{background:linear-gradient(135deg,#f093fb,#f5576c);color:white;text-decoration:none;padding:16px 40px;border-radius:10px;font-size:16px;font-weight:600;display:inline-block}</style>
</head>
<body><div class="card"><div class="icon">❌</div><h1>Link Expired</h1>
<p>This link has expired or is invalid. Please request a new one from the app.</p>
<a href="myapp://verification-pending" class="btn">Back to App →</a></div></body></html>`,
};

module.exports = templates;
