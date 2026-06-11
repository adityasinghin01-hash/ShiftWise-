# ShiftWise — Frontend Screens Document

> Built from Q&A session — June 2026
> Skills used: UI_UX_PRO_MAX_SKILL.md, APP_STRUCTURE.md, FRONTEND_PATTERNS.md, ANIMATIONS.md

---

## Screen 1 — Landing Page

### Concept
An immersive 3D scroll-jacked experience. The page NEVER scrolls down. Moving the cursor up (or scroll wheel) moves the camera forward through a 3D restaurant world. A waiter character walks through the restaurant as the camera follows in third-person (like a game). Each stop in the restaurant reveals a section of content. At the end, a manager presents two menu cards — Sign Up and Login.

### Interaction mechanic
- `overflow: hidden` — no page scroll at all
- `wheel` event hijacked — scroll delta drives a GSAP timeline
- Camera follows the waiter character along a predefined path
- Page stays 100% fixed — depth/forward movement only

### Full flow
```
1. Page opens
   → ShiftWise vintage badge logo floats in centre (3D, breathing idle animation like lusion.co astronaut)
   → Warm wooden restaurant environment visible in background

2. User moves cursor up / scrolls
   → Waiter character appears
   → Camera switches to third-person follow (like a game)
   → Waiter starts walking through the restaurant

3. Stop 1 — Dining area (Morning light — cool blue)
   → Waiter gestures at tables
   → "Features" content cards float in

4. Stop 2 — Kitchen (Lunch rush — bright warm light)
   → Waiter points at chefs working
   → "How it works" section reveals (3 steps)

5. Stop 3 — Bar/Counter (Evening — golden amber light)
   → Waiter slides a physical menu card across the bar
   → "Pricing" appears as a real restaurant menu card (3 tiers)

6. Stop 4 — Manager's Office (Night — dim warm light)
   → Waiter hands manager a notepad
   → Manager turns, holds up TWO menu cards
   → Card 1: "Start Free Trial" (14-day, no card)
   → Card 2: "Log In" (returning users)

7. User clicks a card
   → Cloud/fog animation sweeps across screen
   → Clouds clear → Sign Up or Login screen appears
```

### Time of day lighting
- Morning (Stop 1): Cool blue-white light
- Lunch (Stop 2): Bright, warm, busy
- Evening (Stop 3): Golden amber, candles
- Night (Stop 4): Dim, intimate, one lamp

### Brand & Visual Style
- **Theme:** Old-fashioned wooden restaurant — oak furniture, brick walls, warm vintage charm
- **Primary palette:** Forest green (`#2D5016`, `#4A7C2F`)
- **Accent:** Warm cream/parchment (`#F5E6C8`)
- **Wood tones:** `#8B5E3C`, `#6B4226` (3D scene materials)
- **Text:** Deep charcoal `#1A1A1A` on light, cream on dark
- **Logo:** Vintage circular badge — clock with shift arrows inside + "ShiftWise" wordmark
- **Font:** Playfair Display (headings) + Inter (body) — changeable during design phase

### Tech Stack
- **Three.js** — 3D restaurant scene + lighting
- **GLTF models** — waiter + manager characters with walk/idle animations (Mixamo/Sketchfab)
- **GSAP ScrollTrigger** — scroll/cursor drives camera path + character movement
- **CSS** — menu card UI overlays in 3D space
- **Cloud transition** — particle/fog shader or CSS blur animation between 3D → 2D

### Final screen (after cloud transition)
Two large menu-style cards centred on screen:
- Left card: "Start Free Trial" — "14 days free, no credit card"
- Right card: "Log In" — "Welcome back"
Vintage menu card style matching the restaurant theme.

### Platform
- Desktop only (v1) — no mobile optimization for landing page
- Minimum screen: 1280px wide

---

## Screens 2–15 — App Screens
> To be documented after landing page is built.

---

*Document will be updated screen by screen as each is finalized.*
