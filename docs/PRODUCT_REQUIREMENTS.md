# ShiftWise — Product Requirements Document

> Finalized from Q&A session — June 2026

---

## What is ShiftWise?

Smart shift scheduling for café/restaurant teams of all sizes. One manager can run multiple locations. The app auto-generates fair, conflict-free weekly rosters — then the manager adjusts manually before publishing. Staff submit availability, request time off, and swap shifts. The algorithm guarantees no rule is ever broken.

---

## Core Decisions

### Business & Team
- **Target:** Cafés and restaurants (primary)
- **Team size:** All sizes (scalable — no hard cap)
- **Locations:** One manager can run multiple locations
- **Shift structure:** Both fixed named slots (Morning/Afternoon/Evening) AND custom hours — manager picks per location

### Scheduling
- **How schedule is made:** App auto-generates first → manager drags and adjusts → publishes
- **Schedule period:** Flexible — manager chooses (1 week, 2 weeks, or 1 month)
- **Templates:** Save shift patterns as reusable weekly templates + copy last week's schedule as starting point

### Staff
- **Availability:** Staff submit availability in advance — manager can override
- **Time off:** Staff submit requests → if approved, automatically blocked from scheduling
- **Shift swaps:** Staff request swaps → manager approves/denies
- **Absence handling:** Manager marks absent → app auto-notifies available staff to volunteer for the shift

### Notifications
- **Channels:** In-app + email + browser push notification
- **Schedule visibility:** Staff see who else is working their shift, but NOT the full team schedule

### Fairness & Performance
- **Tracking:** Hours worked + shift types (weekends, nights, early mornings) + dedication score (who covers more, who requests less time off)
- **Auto-balance:** Fairness engine balances unpopular shifts when auto-generating
- **Rewards:** Manager can give badges to top performers
- **Data:** All metrics calculated from real data — no dummy numbers in production

### Analytics Dashboard (Manager)
- Hours worked per staff (week/month)
- Labor cost estimate
- Attendance patterns
- Fairness scores
- Late/absent tracking
- Performance trends
- Data source: real tracked data — dummy dataset used during development/testing only

### Pricing
- **Model:** 14-day free trial → Tiered pricing (Basic / Pro / Business)
- **Tiers:**
  - **Basic** — 1 location, up to 15 staff, manual + auto-schedule
  - **Pro** — 3 locations, unlimited staff, fairness engine, badges, swap requests
  - **Business** — unlimited locations, advanced analytics, priority support

### Platform
- **Web-first, responsive** (works on mobile browser too)
- **Language:** i18n support (English + multiple languages)
- **Integrations:** None in v1 — payroll + calendar integrations planned for final product

---

## Feature List (v1)

### Manager
- [ ] Create and manage multiple locations
- [ ] Add/remove staff, assign roles
- [ ] Set shift rules per location (min/max coverage, hours, incompatible pairs)
- [ ] Submit/view availability overview
- [ ] Auto-generate schedule (constraint-based algorithm)
- [ ] Drag-drop schedule adjustments
- [ ] Live conflict warnings on the schedule builder
- [ ] Save and reuse weekly templates
- [ ] Copy last week's schedule
- [ ] Approve/deny time-off requests
- [ ] Approve/deny shift-swap requests
- [ ] Mark staff as absent → auto-notify available staff
- [ ] Publish schedule → triggers notifications
- [ ] Full analytics dashboard
- [ ] Assign badges/rewards to staff

### Staff
- [ ] Set weekly availability
- [ ] View my shifts
- [ ] See who else is working my shift
- [ ] Submit time-off requests
- [ ] Request shift swap with another staff member
- [ ] Receive notifications (in-app + email + push) when schedule is published
- [ ] Receive notification when asked to cover an absent colleague's shift

### System
- [ ] 14-day free trial
- [ ] Subscription tier enforcement
- [ ] i18n (multi-language)
- [ ] Responsive design (web-first, mobile-friendly)
- [ ] Dummy dataset for development/testing

---

## What ShiftWise is NOT (v1 scope)
- No payroll integration (v2)
- No calendar sync (v2)
- No native mobile app (v2)
- No AI — pure constraint-based algorithm + real data analytics

---

## The Algorithm (core moat)
Constraint-satisfaction scheduler with fairness scoring. Guarantees:
1. Every scheduling rule is satisfied (coverage, max hours, rest time, incompatible pairs)
2. Unpopular shifts (weekends, nights) are distributed fairly across staff
3. Approved time-off requests are always respected
4. Result is deterministic and correct — not a probabilistic guess

AI cannot reliably solve this. That's the product's moat.
