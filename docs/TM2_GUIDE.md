# TM2 Guide — Public Site & Design System

**You own:** `app/(public)/**` · `components/ui/**` · `app/globals.css` · `tailwind.config.ts`
**You ship:** the landing page, the consent flow, the chat check-in, the crisis resource panel, and the design tokens everyone else uses.

**TM3 must read §1 and §2 of this file.** You define the visual language; they consume it. If TM3 needs a component that doesn't exist, they ask you — they don't add colours.

---

## 1. Design direction

The reference image (GainLove) gives us a usable language: warm cream ground, oversized serif headline with enormous breathing room, small scattered accent dots, white cards with generous radius, one saturated accent for actions.

**Take:** the typography scale, the cream ground, the dot motif, the card grid, the calm density.
**Leave:** all of the photography.

That reference is a donation site, so it sells with faces of the people it's about. **We must not do that.** No photographs of people anywhere on this site — not stock victims, not stock "hopeful" imagery, not silhouettes. It would be tonally wrong, it invites an obvious question about consent that we'd have no good answer to, and the problem statement's own priority use cases include people whose identity is protected by law. Use the abstract dot motif, generous whitespace, and type instead. It will look more serious, not less.

**Motivating, in this context, means calm and dignified — not cheerful.** The user is a person in the middle of a court case who may be having a bad week. The tone target is a well-designed public library, not a fundraising campaign. Warm, unhurried, obviously safe, zero urgency in the visual language. Nothing bouncing, nothing pulsing, no confetti, no progress gamification.

### Tokens

```css
/* app/globals.css */
:root {
  --bg:        #FAF7F2;   /* warm cream ground */
  --surface:   #FFFFFF;   /* cards */
  --ink:       #141414;   /* headlines */
  --ink-soft:  #55524D;   /* body */
  --line:      #E8E2D9;   /* hairlines */
  --accent:    #E8873A;   /* primary action, sparingly */
  --calm:      #1F9C8B;   /* confirmation, safe states */
  --dot-blue:  #4A9BE8;   /* decorative only */
  --alert:     #C4483A;   /* crisis panel only — nowhere else */

  --r-card: 24px;
  --r-btn:  999px;
}
```

**Type:** a display serif for headlines (Instrument Serif or Fraunces via `next/font`), Inter for everything else. Headline sizes: `clamp(2.75rem, 7vw, 4.5rem)`, line-height 1.05, tight tracking. Body 17px, line-height 1.7.

`--alert` red appears in exactly one place: the crisis panel. If it shows up anywhere else the crisis panel stops meaning anything.

### Non-negotiables

- **Minimum 18px touch targets and 48px tap heights.** Assume a cracked phone screen in poor light.
- **Language toggle in the header, visible on every page.** Hindi/English. Not buried in a menu.
- **The "Talk to a person" button is present on every single screen**, in the same position, always reachable without scrolling. It never depends on the model, the score, or the network being fast.
- No modals, no carousels, no auto-playing anything, no cookie banner (we set no cookies on the public side).
- Works with JavaScript slow. First paint must include the helpline number as plain text.

---

## 2. Components you build in `components/ui/`

Build these first — TM3 blocks on `Card`, `Button`, `TierBadge`, and `Stat`.

| Component | Notes |
|---|---|
| `Button` | variants: primary (accent), quiet (outline), danger (crisis only) |
| `Card` | white, `--r-card`, hairline border, no shadow by default |
| `Dot` | the decorative accent dot; takes colour + position |
| `TierBadge` | GREEN / AMBER / RED / CRITICAL. **Never colour alone** — always colour + text label, for colourblind users and for photocopied screenshots |
| `Stat` | big number, small label |
| `Field` | label + input, 48px min height |
| `LangToggle` | hi / en, persists in URL param, not localStorage |
| `CrisisPanel` | the one place `--alert` is used. Renders resources passed as props |

---

## 3. Pages you build

### `/` — landing

One screen, one message. Headline in the reference's scale. Sub-line in one sentence. Two buttons: **Start a check-in** and **Talk to a person now**. Below the fold: three cards explaining what the service does, what it does not do, and that it is voluntary.

Put "This is voluntary and does not affect your case, relief, or compensation" **on the landing page, in body text, not in fine print.** It is a legal point and a trust point, and a judge will look for it.

### `/consent` — before any check-in

Plain language, no legalese. Three checkboxes, all required, all unchecked by default:
- I understand what will be recorded
- I understand a counsellor may contact me
- I understand this is voluntary and does not affect my case

Plus a visible "No, go back" that is the same visual weight as "Continue." A consent flow where declining is harder than accepting is not consent.

### `/checkin` — the chat

Three structured questions first (tap answers, 0–4, from `docs/SCORING_AND_POLICY.md` §3), then the open conversation. Message bubbles, an input, a send button. The bot's turn is at most two sentences — if it's ever longer, that's a bug in TM1's Pass-2 filter and you should tell them.

**When the response carries `tier: 'CRITICAL'`, render `CrisisPanel` immediately, above the conversation, before anything else paints.** No animation, no delay, no scroll-into-view. This path must not depend on any state you fetch afterwards.

---

## 4. Prompts

**Prompt 1 — tokens and shell** *(Day 1, first thing — TM3 is blocked on this)*

```
Read docs/TM2_GUIDE.md sections 1 and 2.

Set up app/globals.css with the CSS custom properties given there, and
extend tailwind.config.ts so they're available as Tailwind colours
(bg-bg, text-ink, border-line, bg-accent, etc). Load Instrument Serif and
Inter via next/font.

Build every component in the section 2 table in components/ui/. Each one:
- typed props, no `any`
- Tailwind classes only, using the tokens — no inline hex, no new colours
- TierBadge renders colour AND a text label, never colour alone
- minimum 48px tap height on anything interactive

Then app/(public)/layout.tsx: cream background, a header with the wordmark,
LangToggle, and a persistent "Talk to a person" button that is visible on
every page without scrolling.

Do not build any page content yet.
```

**Prompt 2 — landing**

```
Build app/(public)/page.tsx per docs/TM2_GUIDE.md section 3.

Layout language: cream ground, oversized left-aligned serif headline with
generous whitespace, small decorative accent Dots scattered asymmetrically,
a row of three white Cards below the fold.

ABSOLUTE RULE: no photographs of people, no stock imagery of people, no
illustrated human figures. Decoration is the abstract dot motif and
whitespace only. See TM2_GUIDE section 1 for why.

Include, as body text and not fine print: "This is voluntary. It does not
affect your case, your relief, or your compensation."

Mobile first. Test at 360px width before anything else.
```

**Prompt 3 — consent + chat**

```
Build app/(public)/consent/page.tsx and app/(public)/checkin/page.tsx per
docs/TM2_GUIDE.md section 3.

Consent: three required unchecked checkboxes, and a "No, go back" button of
EQUAL visual weight to "Continue". On continue, POST to /api/consent and
carry the returned consentId forward in the URL.

Check-in: the three structured 0-4 tap questions first, then the chat.
POST every turn to /api/checkin using the CheckInRequest type from
types/contract.ts. Import that type — do not redefine the shape locally.

CRITICAL PATH: when the response has tier === 'CRITICAL', render
CrisisPanel with response.resources IMMEDIATELY, above the conversation.
Synchronous, no animation, no delay, no additional fetch. Write a test that
mocks a CRITICAL response and asserts the panel is in the DOM on the very
next render.

While the model is thinking, show a plain "…" — no fake typing animation.
It is a check-in, not a friend.
```

---

## 5. Your checks

**Before every push:**
- [ ] 360px wide, one-handed, thumb reaches everything
- [ ] "Talk to a person" visible without scrolling on every page
- [ ] Zero photographs or illustrations of people
- [ ] `--alert` red appears only in `CrisisPanel`
- [ ] TierBadge shows text, not just colour
- [ ] No `NEXT_PUBLIC_` on any secret; no direct Supabase call from the browser
- [ ] Types imported from `types/contract.ts`, not redeclared
- [ ] Language toggle actually changes copy, not just a flag

**Day 3, sit with someone outside the team.** Hand them a phone, say nothing, watch them try to complete a check-in. Do not help. Write down every place they hesitate. That fifteen minutes will find more than a day of self-review.

**What Claude Code will try, and why to stop it:**

| It will | Catch it by |
|---|---|
| Add stock photos of people to the landing page | The reference image has them; your rule says no. Repeat the rule in the prompt |
| Add a typing animation to the bot | Feels polished, reads as a friend pretending to think |
| Put the crisis panel behind a state update or animation | It must paint synchronously |
| Introduce a new colour "for hierarchy" | Tokens only. Every new hex weakens `--alert` |
| Install shadcn, framer-motion, or a form library | Five days. Say no |
| Make "Continue" bigger than "Go back" on consent | That's a dark pattern in a consent flow |
