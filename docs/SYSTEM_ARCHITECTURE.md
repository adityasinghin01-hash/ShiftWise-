# ShiftWise — System Architecture

> Created: June 2026
> Stack: Node.js + Express + MongoDB + Vite SPA
> Base: Adv_Backend (auth, RBAC, subscriptions, webhooks, API keys, MFA)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│  CLIENTS                                                  │
│  Landing Page (Three.js SPA)  │  App (Vite SPA)          │
└──────────────────┬────────────────────────┬──────────────┘
                   │ HTTPS                  │ HTTPS + JWT
┌──────────────────▼────────────────────────▼──────────────┐
│  BACKEND — Node.js / Express (Render)                     │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │  Auth   │ │ Scheduler│ │ Notifs   │ │  Analytics  │  │
│  │ (exist.)│ │  Engine  │ │  Service │ │   Service   │  │
│  └─────────┘ └──────────┘ └──────────┘ └─────────────┘  │
└──────────────────────────────────────────────────────────┘
                   │                  │
     ┌─────────────▼──────┐    ┌──────▼──────────┐
     │  MongoDB Atlas      │    │  Upstash Redis  │
     │  (primary data)     │    │  (rate limiting │
     └────────────────────┘    │   + job queue)  │
                                └─────────────────┘
                   │
     ┌─────────────▼──────┐
     │  Brevo (email)      │
     │  Web Push API       │
     └────────────────────┘
```

---

## 2. Data Models

### 2.1 Business (top-level tenant)
```js
{
  _id, name, ownerId,
  plan: 'basic' | 'pro' | 'business',
  trialEndsAt, subscriptionId,
  settings: { timezone, currency, weekStartsOn },
  createdAt
}
```

### 2.2 Location
```js
{
  _id, businessId, name, address,
  timezone,  // override business timezone if different
  isActive,
  settings: {
    shiftTypes: [{ name, startTime, endTime, color }],  // Morning/Afternoon/Evening
    minStaffPerShift, maxStaffPerShift,
    minRestHoursBetweenShifts,  // e.g. 8h
    maxHoursPerWeek,
    maxDaysConsecutive
  },
  createdAt
}
```

### 2.3 Staff Member
```js
{
  _id, businessId, locationIds: [],  // can work at multiple locations
  userId,  // links to User (auth system)
  name, email, phone, role,
  hourlyRate,  // for cost estimation
  employmentType: 'full-time' | 'part-time' | 'casual',
  maxHoursPerWeek,
  incompatibleWith: [staffId],  // can't work same shift
  badges: [{ type, awardedAt, awardedBy }],
  isActive,
  joinedAt
}
```

### 2.4 Availability
```js
{
  _id, staffId, locationId,
  weekOf: Date,  // Monday of the week this applies to
  slots: [
    {
      dayOfWeek: 0-6,  // 0=Monday
      available: Boolean,
      preferredStart: '08:00', preferredEnd: '18:00',
      note: String
    }
  ],
  submittedAt, approvedAt, approvedBy
}
```

### 2.5 Schedule
```js
{
  _id, locationId, businessId,
  periodStart: Date, periodEnd: Date,  // e.g. Mon–Sun
  status: 'draft' | 'published' | 'archived',
  generatedBy: 'auto' | 'manual',
  generatedAt, publishedAt, publishedBy,
  templateId,  // if copied from template
  notes: String,
  fairnessScore: Number  // computed on generation
}
```

### 2.6 Shift
```js
{
  _id, scheduleId, locationId, staffId,
  date: Date,
  startTime: '08:00', endTime: '14:00',
  shiftType: 'morning' | 'afternoon' | 'evening' | 'custom',
  isWeekend: Boolean, isNight: Boolean,
  status: 'scheduled' | 'confirmed' | 'absent' | 'covered',
  coveredBy: staffId,  // if absent and covered
  actualStart, actualEnd,  // for attendance tracking
  notes: String
}
```

### 2.7 TimeOffRequest
```js
{
  _id, staffId, locationId,
  startDate, endDate,
  reason: String,
  status: 'pending' | 'approved' | 'denied',
  reviewedBy, reviewedAt, reviewNote,
  createdAt
}
```

### 2.8 ShiftSwapRequest
```js
{
  _id, requesterStaffId, targetStaffId,
  requesterShiftId, targetShiftId,
  status: 'pending' | 'approved' | 'denied' | 'cancelled',
  reviewedBy, reviewedAt,
  createdAt
}
```

### 2.9 ScheduleTemplate
```js
{
  _id, locationId, businessId, name,
  shifts: [
    { dayOfWeek, shiftType, startTime, endTime, requiredCount }
  ],
  createdBy, createdAt
}
```

### 2.10 StaffMetrics (denormalized, updated on each schedule publish)
```js
{
  _id, staffId, locationId,
  period: { year, month },
  totalHours, weekendHours, nightHours, earlyMorningHours,
  absences, lateArrivals,
  swapsRequested, swapsApproved,
  timeOffDaysTaken,
  dedicationScore: Number,  // computed
  fairnessDebt: Number  // how many "bad" shifts vs average
}
```

### 2.11 Notification
```js
{
  _id, userId, type, title, body,
  data: {},  // contextual payload
  channels: ['in-app', 'email', 'push'],
  readAt, sentAt, createdAt
}
```

---

## 3. API Routes

### Auth (inherited from Adv_Backend)
All existing auth routes remain: signup, login, Google OAuth, MFA, forgot-password, etc.

### Business
```
POST   /api/v1/business              — create business (on signup)
GET    /api/v1/business              — get my business
PUT    /api/v1/business              — update business settings
```

### Locations
```
GET    /api/v1/locations             — list locations for business
POST   /api/v1/locations             — create location
GET    /api/v1/locations/:id         — get location
PUT    /api/v1/locations/:id         — update location + rules
DELETE /api/v1/locations/:id         — soft delete
```

### Staff
```
GET    /api/v1/locations/:id/staff           — list staff at location
POST   /api/v1/locations/:id/staff           — add staff (invite by email)
PUT    /api/v1/staff/:id                     — update staff profile
DELETE /api/v1/staff/:id                     — deactivate staff
POST   /api/v1/staff/:id/badges              — award badge
```

### Availability
```
GET    /api/v1/locations/:id/availability    — get all staff availability for week
POST   /api/v1/availability                  — staff submits availability
PUT    /api/v1/availability/:id              — update availability
GET    /api/v1/my/availability               — staff: my availability
```

### Schedule
```
GET    /api/v1/locations/:id/schedules       — list schedules
POST   /api/v1/schedules                     — create draft schedule
POST   /api/v1/schedules/:id/generate        — AUTO-GENERATE (runs algorithm)
GET    /api/v1/schedules/:id                 — get schedule + all shifts
PUT    /api/v1/schedules/:id                 — update schedule metadata
POST   /api/v1/schedules/:id/publish         — publish → notify all staff
POST   /api/v1/schedules/:id/copy            — copy last week as starting point
DELETE /api/v1/schedules/:id                 — delete draft
```

### Shifts
```
GET    /api/v1/schedules/:id/shifts          — all shifts in schedule
POST   /api/v1/schedules/:id/shifts          — manually add shift
PUT    /api/v1/shifts/:id                    — update shift (drag-drop)
DELETE /api/v1/shifts/:id                    — remove shift
POST   /api/v1/shifts/:id/absent             — mark absent → notify available staff
GET    /api/v1/my/shifts                     — staff: my upcoming shifts
```

### Time Off
```
GET    /api/v1/locations/:id/timeoff         — manager: list all requests
POST   /api/v1/timeoff                       — staff: submit request
PUT    /api/v1/timeoff/:id/review            — manager: approve/deny
GET    /api/v1/my/timeoff                    — staff: my requests
```

### Shift Swaps
```
GET    /api/v1/locations/:id/swaps           — manager: list pending swaps
POST   /api/v1/swaps                         — staff: request swap
PUT    /api/v1/swaps/:id/review              — manager: approve/deny
GET    /api/v1/my/swaps                      — staff: my swap requests
```

### Templates
```
GET    /api/v1/locations/:id/templates       — list templates
POST   /api/v1/templates                     — save current as template
PUT    /api/v1/templates/:id                 — update template
DELETE /api/v1/templates/:id                 — delete template
```

### Analytics
```
GET    /api/v1/locations/:id/analytics       — full analytics dashboard data
GET    /api/v1/staff/:id/metrics             — individual staff metrics
GET    /api/v1/locations/:id/fairness        — fairness report
```

### Notifications
```
GET    /api/v1/notifications                 — list my notifications
PUT    /api/v1/notifications/:id/read        — mark read
DELETE /api/v1/notifications/:id             — dismiss
POST   /api/v1/notifications/push-subscribe  — register push subscription
```

---

## 4. The Scheduling Algorithm

### Input
```
- Location rules (coverage, max hours, rest time)
- Staff list with availability + time-off blocks
- Previous schedule fairness debt per staff
- Schedule period (start/end dates)
```

### Algorithm: Constraint Satisfaction + Fairness Scoring

```
Phase 1 — Slot Generation
  For each day × shift type → create required slots (e.g. 2 morning slots Monday)

Phase 2 — Eligibility Filter
  For each slot, find eligible staff:
    ✓ Available that day/time
    ✓ No approved time-off
    ✓ Not exceeding max weekly hours
    ✓ Adequate rest since last shift (≥ minRestHours)
    ✓ Not incompatible with other staff on same slot
    ✓ Not exceeding maxDaysConsecutive

Phase 3 — Fairness Scoring
  Score each eligible staff for each slot:
    + Higher score = more fairness debt (hasn't had bad shifts recently)
    + Lower score = already has many weekend/night shifts this period
    Algorithm prefers highest-scored eligible staff per slot

Phase 4 — Assignment
  Greedy assignment: fill each slot with highest-scored eligible staff
  If no eligible staff: flag slot as UNDERSTAFFED (conflict warning)

Phase 5 — Validation
  Verify ALL constraints are met across the whole schedule
  If violations found: backtrack and retry (max 3 attempts)
  Return schedule + conflict report + fairness scores
```

### Fairness Score Formula
```
fairnessScore = (avgWeekendShifts - myWeekendShifts) * 2
              + (avgNightShifts   - myNightShifts)   * 1.5
              + (avgTotalHours    - myTotalHours)     * 1
              + (timeOffRequested * -0.5)
```
Higher score = more "owed" bad shifts = higher priority for next one.

---

## 5. RBAC Roles for ShiftWise

Built on top of existing `roles.js`:

| Role | Who | Can do |
|---|---|---|
| `owner` | Business owner | Everything + billing + delete business |
| `manager` | Location manager | Manage staff, create/publish schedules, approve requests |
| `staff` | Team member | View own shifts, submit availability, request time-off/swap |
| `admin` | Platform admin | Inherited from Adv_Backend |

---

## 6. Notification Events

| Event | Channels | Who receives |
|---|---|---|
| Schedule published | Email + in-app + push | All staff at location |
| Shift assigned | In-app | Staff member |
| Time-off approved/denied | In-app + email | Staff member |
| Swap approved/denied | In-app + email | Both staff members |
| Absent → cover needed | In-app + push | All available staff (off today) |
| Badge awarded | In-app | Staff member |
| Trial ending in 3 days | Email | Business owner |

---

## 7. Subscription Tier Enforcement

Enforced via existing `planMiddleware.js` + new ShiftWise-specific limits:

| Limit | Basic | Pro | Business |
|---|---|---|---|
| Locations | 1 | 3 | Unlimited |
| Staff per location | 15 | Unlimited | Unlimited |
| Auto-generate | ✓ | ✓ | ✓ |
| Fairness engine | ✗ | ✓ | ✓ |
| Badges | ✗ | ✓ | ✓ |
| Swap requests | ✗ | ✓ | ✓ |
| Analytics | Basic | Full | Full + export |
| Templates | 1 | 10 | Unlimited |

---

## 8. Frontend Architecture

### Structure
```
ShiftWise/frontend/src/
  js/
    landing.js           ← entry for landing page (move from /landing/)
    app.js               ← SPA router for dashboard
    api.js               ← all API calls
    store.js             ← auth state
    pages/
      auth/              ← login, signup, forgot-pass (redesigned)
      dashboard/         ← manager dashboard
      schedule/          ← schedule builder (hero screen)
      team/              ← staff management
      availability/      ← availability overview
      requests/          ← time-off + swap requests
      analytics/         ← charts + metrics
      profile/           ← existing profile + MFA
      settings/          ← business + location settings
      staff-portal/      ← staff-facing screens (my shifts, availability)
```

### State management
- Auth state: `store.js` (existing)
- Schedule builder state: local component state (complex, no global needed)
- Notifications: polling every 30s or WebSocket (v2)

---

## 9. Build & Deploy

| Component | Tool | Host |
|---|---|---|
| Backend | Node.js + Express | Render (existing) |
| Frontend (app) | Vite SPA | Render static (served by backend) |
| Landing page | Three.js + Vite | Same Render deploy |
| Database | MongoDB Atlas | Atlas (existing) |
| Rate limiting | Upstash Redis | Upstash (existing) |
| Email | Brevo | Brevo (existing) |
| Push notifications | Web Push API (VAPID) | Self-hosted via backend |

---

## 10. Development Order

```
Phase 1 — Foundation
  1. Data models (Business, Location, Staff, Availability, Shift, Schedule)
  2. Seed script (create test business + locations + staff)
  3. Core API routes (CRUD for all models)
  4. RBAC middleware for ShiftWise roles

Phase 2 — Core Algorithm
  5. Scheduling algorithm (constraint solver + fairness scoring)
  6. Algorithm tests with dummy dataset
  7. /generate endpoint wired to algorithm

Phase 3 — Frontend (screen by screen)
  8. Redesign auth screens (login/signup/forgot-pass)
  9. Manager dashboard
  10. Schedule builder (drag-drop + auto-generate)
  11. Team management
  12. Staff portal (availability + my shifts)
  13. Requests (time-off + swaps)
  14. Analytics dashboard

Phase 4 — Polish
  15. Notifications (email + push)
  16. Subscription enforcement
  17. i18n
  18. Wire landing page CTA → auth
```
