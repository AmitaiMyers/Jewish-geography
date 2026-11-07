# Design system

> Status: **approved and implemented** (tokens in `src/styles.css`, components in `src/ui/`).
> Section 8 lists where the build differs from the original proposal.

## 1. Design language: "Warm network"

A calm, modern, content-first look with **one** strong idea: *people are warm, connections are light*.
People are rendered as soft, colourful avatars; everything structural (panels, lines, chrome) recedes.

- **Graph-first.** The graph is the home screen and fills the viewport edge to edge. All other UI floats over it (sheets, chips, floating action button) and gets out of the way.
- **Rooted in the theme, without kitsch.** The palette comes from *tekhelet* blue, Jerusalem-stone sand and candle-light gold. No stars of David as decoration; the only one is the app icon.
- **Rounded, soft and tactile.** Large radii, gentle shadows and springy motion. The app should feel touchable on a phone.
- **Bidirectional by construction.** Only logical CSS properties (`inline-start/end`), mirrored icons where direction has meaning, and fonts tested with Hebrew and Latin mixed.

## 2. Tokens

All values are CSS custom properties on `:root`, redefined for dark mode. Components use **only** tokens, never raw values.

### 2.1 Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | `#FAF8F4` stone white | `#0F1420` | App and graph background |
| `--color-surface` | `#FFFFFF` | `#171E2D` | Sheets, cards, inputs |
| `--color-surface-raised` | `#FFFFFF` + shadow | `#1E2638` | Floating elements |
| `--color-text` | `#172033` | `#E9ECF3` | Body text |
| `--color-text-muted` | `#5B6577` | `#9AA4B8` | Secondary text and hints |
| `--color-primary` | `#2B4C9B` tekhelet | `#8FB0FF` | Primary actions, focus, "me" |
| `--color-on-primary` | `#FFFFFF` | `#0F1420` | Text on primary |
| `--color-secondary` | `#C8A97E` stone sand | `#B89868` | Group chips, quiet emphasis |
| `--color-accent` | `#E3A72F` candle gold | `#F2C14E` | Highlights, badges, found paths |
| `--color-family` | `#B8592A` terracotta | `#E8945F` | Family edges |
| `--color-social` | `#7A8496` slate | `#5E6A80` | Social edges |
| `--color-success` | `#1E7A4C` | `#5CD49A` | Confirmations |
| `--color-danger` | `#B42318` | `#FF8A7A` | Destructive actions, errors |
| `--color-border` | `#E6E1D8` | `#2A3346` | Hairlines |

**Group palette:** 10 hues, already in the code (`src/model/groupColors.ts`). They are checked for colour-blind distinctness, and each colour is always paired with the group name, so colour never carries meaning alone.

**Contrast (WCAG 2.1, measured):**

| Pair | Light | Dark | Required |
|---|---|---|---|
| text / bg | 15.3 | 15.6 | 4.5 |
| muted / surface | 5.9 | 6.7 | 4.5 |
| on-primary / primary | 8.1 | 8.6 | 4.5 |
| text / accent (badges) | 7.6 | 11.0 | 4.5 |
| danger / surface | 6.6 | 7.3 | 4.5 |
| family edge / bg | 4.4 | 7.7 | 3 (non-text) |
| social edge / bg | 3.6 | 3.4 | 3 (non-text) |

### 2.2 Typography

- **Family:** `Rubik` (Google Fonts). It is designed for Hebrew *and* Latin with matching proportions, which suits this bilingual app. It falls back to `system-ui`.
- **Scale** (1.2 ratio, rem-based so it respects the user's text size):

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `--text-display` | 28 / 34 | 700 | Onboarding and empty-state titles |
| `--text-title` | 22 / 28 | 600 | Sheet titles (person name) |
| `--text-heading` | 17 / 24 | 600 | Section headings |
| `--text-body` | 15 / 22 | 400 | Default |
| `--text-label` | 13 / 18 | 500 | Field labels, chips, tabs |
| `--text-caption` | 12 / 16 | 400 | Hints, counts |

- Numbers use tabular figures (`font-variant-numeric: tabular-nums`) so counts don't jitter.
- Line length is capped at about 60 characters in sheets.

### 2.3 Spacing, radius, elevation

- **Spacing:** a 4 px base. Tokens `--space-1`…`--space-8` = 4, 8, 12, 16, 20, 24, 32, 48. Page gutter 16, gap between cards 12, padding inside cards 16.
- **Touch targets:** at least 44 × 44 px everywhere, and at least 8 px between neighbouring targets.
- **Radius:** `--radius-sm` 8 (inputs), `--radius-md` 14 (cards), `--radius-lg` 24 (sheets), `--radius-full` (chips, avatars, the floating button).
- **Elevation:** three shadow levels, `--shadow-1` (chips), `--shadow-2` (floating button, toasts) and `--shadow-3` (sheets). In dark mode a 1 px light top border replaces shadows, which barely show on dark backgrounds.

### 2.4 Motion

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Entering elements |
| `--ease-spring` | `cubic-bezier(.34,1.56,.64,1)` | Taps, toggles (slight overshoot) |
| `--dur-fast` | 120 ms | Press states, colour changes |
| `--dur-base` | 220 ms | Sheets, chips, list changes |
| `--dur-slow` | 450 ms | Graph camera moves, layout morphs |

When the user has asked for reduced motion (`prefers-reduced-motion: reduce`), every duration becomes 0 except opacity fades of 120 ms or less. The graph then jumps instead of flying.

## 3. Components

| Component | Notes |
|---|---|
| **Avatar node** | A circle with initials (or a group-colour pie when the person is in groups). "Me" is larger, with a tekhelet ring and a soft pulsing halo the first time the graph is shown. |
| **Bottom sheet** | Has a drag handle. Three snap points: peek (name and relation to you), half, and full. Swipe down to close; the Escape key and a close button also work. It replaces centred dialogs on phones; on screens 768 px and wider it becomes a side panel. |
| **Floating action button** | A "+" on the graph that opens a speed-dial: Add person, Import, New group. |
| **Search command bar** | Pull down or tap the search field. Results are grouped (People, Groups, Actions). Choosing a person flies the camera to them. |
| **Chip** | Filter, selectable and removable variants. Group chips carry a colour dot. |
| **Relation builder** | Reads as a sentence: **[Avi] is the [uncle ▾] of [Sarah ▾]**. Family types appear first, with icons. |
| **Path ribbon** | The result of "How are they connected?" shown as a horizontal chain of avatars joined by labelled connectors. It scrolls sideways and stays in sync with the graph highlight. |
| **Toast / snackbar** | One line, with an optional **Undo**. Undo replaces confirmation dialogs for most deletions. |
| **Empty states** | An illustration, one sentence, and one primary action. No dead ends. |
| **Skeletons** | Shimmering placeholders while IndexedDB loads or a file is parsed (over 150 ms). |

## 4. States and micro-interactions

| State | Treatment |
|---|---|
| Hover (pointer devices only) | Surface tint +4%, cursor change; graph node grows to 1.15× and its connections brighten. |
| Pressed | Scales to 0.97 using `--ease-spring`; Android-style ripple on primary buttons. |
| Focus (keyboard) | A 2 px `--color-primary` outline with a 2 px offset. It is never removed; shown only for keyboard focus (`:focus-visible`). |
| Disabled | 45% opacity, no pointer events, and `aria-disabled`, with the reason in a tooltip or hint. |
| Loading | The button keeps its width while its label becomes a spinner; long imports show a progress bar with a count ("Importing 312 / 500"). |
| Success | A check mark draws itself (300 ms), plus a light haptic tap (`navigator.vibrate(10)`) where supported. |
| Error | Field shakes gently (6 px, 2×), red helper text below it, and `aria-live` announces the message. |
| Graph: open a person | Camera eases to the node, neighbours fan out slightly, and the sheet slides to peek height. |
| Graph: find a path | The camera frames the path, then edges light up one after another along it (60 ms stagger) in gold. |
| Graph: filter a group | Non-members fade to 12% opacity over 220 ms, and the group cluster gains a soft tinted outline around it. |
| New people added | Nodes pop in from the "me" node with a spring, then the layout morphs from old positions to new. |
| Accepting a suggestion | The card collapses into the matching edge on the graph thumbnail; the badge count ticks down. |

## 5. User journey (zero friction)

```
First open ─▶ Welcome (name + language, 1 screen)
           ─▶ "Bring in your people" (Contacts / WhatsApp / Facebook / skip)
           ─▶ Review list: everything pre-ticked, duplicates pre-unticked
           ─▶ Graph appears around "me", with suggestions badge ("We found 6 family links")
           ─▶ Review suggestions one card at a time: Accept or Skip (swipe)
           ─▶ Coach mark: "Tap anyone to connect them"   (shown once)
```

**Navigation** (four tabs instead of five, to lower cognitive load):

| Tab | Contents |
|---|---|
| **Graph** | Home: graph, search bar, group chips, "+" button |
| **People** | List with search, sorting, multi-select |
| **Connect** | "How are they connected?" now; the stage-2 "Compare with a friend" QR flow later |
| **Me** | Suggestions, groups, import, backup, settings |

Rules applied throughout:

- **One primary action per screen**, always placed where the thumb reaches (bottom).
- **Undo instead of "are you sure?"** for every deletion that can be undone.
- **Progressive disclosure.** Phones, emails and notes stay collapsed until needed. The relation builder shows the five most-used types first and "More…" for the rest.
- **Recognition over recall.** Pickers show recent people first; relation labels are suggested from the ones already used.
- **The person's own words.** Labels like "chavrusa" or "Bnei Akiva" are kept exactly as typed.

## 6. Accessibility

- WCAG 2.1 AA contrast (table above), text resizing to 200%, and no information carried by colour alone.
- The graph canvas is not readable by a screen reader, so a parallel **accessible list view** exists for it: each person is a list item ("Avi Levi, first cousin, 3 connections"). Arrow keys move between neighbours, and Enter opens the person.
- Landmarks: `header`, `main`, and `nav[aria-label]`. Tabs use the `tablist`/`tab` pattern with `aria-selected`. Sheets are `role="dialog"` with `aria-modal`, trap focus, and return focus when closed.
- Live regions announce toasts, import progress and search result counts.
- `lang` and `dir` change together. Mixed-direction names are wrapped in `<bdi>`, so "Avi Levi (cousin)" stays intact inside Hebrew text.

## 7. Front-end architecture for Phase 2

| Area | Choice |
|---|---|
| Rendering | Keep **framework-free TypeScript** (as chosen in stage 1), but organise the UI as small **Web Components** (`<jg-sheet>`, `<jg-chip>`, `<jg-person-picker>`…). Each has typed properties and the shared token stylesheet. |
| State | The existing `AppStore` stays the single source of truth. Views subscribe and re-render only their own subtree; lists are keyed so DOM nodes are reused, which preserves focus and scroll position. |
| Graph | Cytoscape stays. Visual styles are generated from the same CSS tokens, so light/dark and the brand stay in sync. Avatar initials are drawn as node backgrounds (SVG data URIs, cached per person). |
| Motion | Web Animations API with the motion tokens, wrapped in one `animate()` helper that honours reduced motion. |
| Quality gates | Unit tests (existing), a Playwright smoke test of the user journey in English and Hebrew, an axe-core accessibility scan in CI, and a Lighthouse PWA/performance budget (JS under 250 KB gzipped). |

## 8. Implementation notes (where the build differs)

| Proposal | Built | Why |
|---|---|---|
| Ripple on primary buttons | Press-to-scale (0.97, spring) on all buttons | One consistent press effect; ripple added noise on dense rows. |
| Neighbours "fan out" when a person is tapped | The camera frames the person and their neighbours; everything else fades | Moving nodes would fight the layout and confuse spatial memory. |
| Suggestion card "collapses into the graph thumbnail" | The card flies off in the swipe direction; the graph shows the new link after closing | No graph is visible inside the sheet. |
| Lighthouse performance budget in CI | Bundle-size budget (`npm run check:bundle`, 250 KB gzipped) plus axe in Playwright | Deterministic in CI; Lighthouse scores vary run to run. |
| `--color-family` for family tags | New `--color-family-text` token (#8F4A2C light / #F0A875 dark) | Terracotta on its own tint measured 4.0:1 in axe; the text token gives 5.5:1 / 6.0:1. |
| Undo instead of every confirmation | Undo for every delete; **Restore backup** still asks first | A restore replaces everything and has nothing to undo to. |

## 9. New pattern: Pitzuchim reveal

### Problem
Discovering who two people both know is the reason the app exists, and it happens in person, phone to phone.
The first version showed it as a plain checklist sheet: correct, but flat, and it said nothing about *why*
those people matter (family? the army? university?).

### Existing patterns
| Related | Shared | Why it's not enough |
|---|---|---|
| `<jg-sheet>` | Modal, focus trap, Escape | A bottom sheet is a utility surface; this moment needs the whole screen. |
| Suggestion cards | Avatars, pop-in motion | One item at a time; here the *count* and the *list* are the story. |
| Success toast | Self-drawing check | Too small for the main payoff. |

### Proposed design
A full-screen celebratory dialog in three beats, then a calm list.

1. **Crack** (≈900 ms): the two avatars slide in from opposite edges (mirrored in RTL) and meet in the
   middle; on impact gold "seeds" burst outward and tumble (pitzuchim = cracked seeds), with a short haptic.
2. **Count**: "Pitzuchim!" in gold, then "You and Yossi both know" over a huge number counting up to N.
3. **Best pitzuach**: one highlighted line, the strongest shared link: family first
   ("Your cousin Avi knows Yossi too!"), otherwise the biggest shared group ("7 of them are from מדמ"ח").
4. **List**: shared people grouped as Family → your groups (largest first, with their colour) → Other,
   rows staggering in. Each row: avatar, name, how *you* know them.

#### API
| Property | Type | Description |
|---|---|---|
| `mode: 'compare'` | `{ payload, overlap }` | After scanning a friend's code: nothing is saved until confirmed. Rows have a "knows them" switch (untick coincidences); footer: relation picker + **Add Yossi + 12 pitzuchim**. |
| `mode: 'between'` | `{ aId, bId }` | Two people already in the graph (from a person sheet or Connect): rows open the person; footer: **Show on graph**. |

#### States
| State | Behaviour |
|---|---|
| Revealing | Fly-in, seed burst, count-up, list stagger (≤15 rows animated, rest instant). |
| Some unticked | Row dims with a strike-through; the count and the CTA update live. |
| None in common | No burst. "No pitzuchim… yet": the CTA still adds the friend. |
| Confirming | CTA shows the spinner; then the dialog fades and the graph highlights the friend. |
| Reduced motion | No fly-in, burst, count-up or stagger: final state at once, fades only. |

#### Tokens
- Colours (new, identical in both themes because the reveal is always dark): `--color-celebrate-1/2`
  (`#13224A` → `#203873`, a tekhelet night gradient), `--color-celebrate-gold` (`#F2C14E`: seeds, the number,
  the CTA), `--color-celebrate-text` (white) and `--color-celebrate-muted` (`#C9D4F0`);
  `--color-secondary` as the second seed colour; group colours on section dots.
- Type: `--text-hero` (new: 700 4.5rem/1) for the number; `--text-display` for "Pitzuchim!".
- Motion: `--ease-spring`, `--dur-slow`, new `--dur-celebrate` (900 ms).

### Accessibility
- `role="dialog"` with `aria-modal`, labelled by the title and described by a one-sentence summary
  ("Pitzuchim! You and Yossi both know 12 people.") that is also announced once through a live region.
- The animated number, avatars and seeds are `aria-hidden`; the summary carries the meaning.
- Sections are headings; rows are a list; the switches are real checkboxes labelled "Knows Yossi: Avi Levi".
- Escape = "Not now". Focus starts on the title so screen readers read the result first.
- Contrast, measured at the lighter end of the gradient (`#203873`): gold `#F2C14E` 6.7:1, white 11.2:1, muted `#C9D4F0` 7.5:1 (all pass AA; gold passes AAA for large text).

### Open questions
- Share the moment (a generated image to WhatsApp)? Deferred: it would reveal names to a third party.
