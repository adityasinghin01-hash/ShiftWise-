# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.0   | ✅ Yes    |
| < 1.0.0 | ❌ No     |

## Reporting a Vulnerability

> **Do NOT open public GitHub issues for security vulnerabilities.**

Please report security vulnerabilities privately via email:

- **Email:** aditya.singh.in01@gmail.com
- **Response time:** Within 48 hours
- **What to include:**
  - Clear description of the vulnerability
  - Steps to reproduce
  - Impact assessment (what an attacker could achieve)
  - Affected version(s)

We will acknowledge your report within 48 hours and provide a detailed
response within 5 business days, including planned remediation steps.

## Security Measures Implemented

### Authentication & Authorization

- **JWT Authentication** — Short-lived access tokens + rotating refresh tokens
- **API Key Authentication** — HMAC-SHA256 hashed keys with per-key rate limiting
- **Role-Based Access Control (RBAC)** — Granular permissions (`user`, `moderator`, `admin`, `superadmin`)
- **Account Lockout** — Progressive lockout after failed login attempts

### Transport & Headers

- **Helmet** — Standard HTTP security headers
- **Custom Security Headers** — X-Frame-Options DENY, Permissions-Policy, COEP/COOP/CORP
- **CORS** — Strict origin allowlisting
- **HPP** — HTTP Parameter Pollution protection

### Input Validation & Sanitization

- **express-mongo-sanitize** — Prevents NoSQL injection via `$` and `.` operators
- **xss-clean** — Strips XSS payloads from request body, query, and params
- **express-validator** — Schema-based input validation on all endpoints
- **Password Policy** — Enforced complexity (min 8 chars, uppercase, lowercase, number, special)

### Rate Limiting

- **Global Rate Limiter** — Configurable per-window request cap
- **Auth Rate Limiter** — Stricter limits on login/signup endpoints
- **API Key Rate Limiter** — Per-key monthly request quotas tied to subscription plan

### Cryptography

- **bcrypt (12 rounds)** — Password hashing with salt
- **AES-256-GCM** — Reversible encryption for webhook signing secrets
- **HMAC-SHA256** — Webhook payload signatures for delivery verification
- **SHA-256** — One-way hashing for verification tokens, reset tokens, OTPs

### Secrets Management

- **No hardcoded secrets** — All secrets via environment variables
- **dotenv override: false** — CI/CD secrets are never overwritten by `.env`
- **Webhook secrets shown once** — Raw secret displayed only at creation time

### Observability & Resilience

- **Winston Structured Logging** — JSON logs with request ID correlation
- **Request ID Tracking** — UUID per request for distributed tracing
- **Graceful Shutdown** — Ordered teardown: stop workers → drain connections → flush stats → close DB
- **No sensitive data in logs** — URLs, emails, and secrets are stripped from log output

## Out of Scope

The following activities are **out of scope** for security reports:

- Penetration testing without prior written permission
- Denial of Service (DoS/DDoS) attacks
- Social engineering of team members
- Physical security attacks
- Attacks against infrastructure we don't own (MongoDB Atlas, Render, etc.)
- Spam or volume-based attacks against public endpoints
- Reports from automated scanners without manual verification

## Acknowledgements

We appreciate responsible disclosure from the security community.
Contributors who report valid vulnerabilities will be credited in this
section (with permission).
