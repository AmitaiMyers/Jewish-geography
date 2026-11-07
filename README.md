# Jewish Geography

A Progressive Web App that maps everyone you know as a graph, shows how they are connected (family, friends, shul, yeshiva, camp, army, work…), and lets two people compare graphs in person to find who they both know. It works in English and Hebrew (right-to-left), on iPhone and Android, and offline.

**Live app:** https://amitaimyers.github.io/Jewish-geography/ (once GitHub Pages is enabled, see [Deploy](#deploy))

## Features

| Area | What you get |
|---|---|
| **Graph** | Avatars with initials, ringed in their groups' colours. Family links are terracotta, social links are slate. Tapping a group outlines its cluster. Chains light up step by step in gold. New people pop out from "me". There is a quick-action button, plus a keyboard and screen-reader list version of the graph. |
| **Import** | **Android:** pick phone contacts directly. **iPhone / Google:** a `.vcf` file. **WhatsApp:** an exported chat — the `.zip` from iPhone or the `.txt` from Android — becomes a group; people already in your graph join it too. **Facebook:** `friends.json`. Duplicates are detected by phone or email and left unticked in the review screen. |
| **Suggestions** | Contact names become suggested links, reviewed one card at a time (swipe or tap). See [Name patterns](#name-patterns). When a name fits several people ("אמא של רז"), the card asks which one; a missing child ("אמא של יושו") can be added. |
| **Groups from names** | Labels shared by 5 or more contacts ("תומר מדמ"ח", "Liraz Axioma", "דניאל מילואים") become groups automatically. Service contacts (taxi, delivery, clinic…) go into a **Services** group. |
| **Family inference** | From parent, spouse and sibling links, the app works out uncle, great-aunt, second cousin once removed, brother-in-law, mechutan… in English and Hebrew. |
| **Connect** | For any two people: their family relation, the shortest chain (shown as a ribbon of avatars), and mutual connections. |
| **Compare with a friend** (stage 2) | Show your QR code and scan theirs, or share the code as text (WhatsApp, AirDrop…). You see who you both know, confirm the list, and both graphs are linked. No server is involved. |
| **Organise** | Groups with colours, multi-select to group or delete people, Undo on every delete, and a search across people, groups and actions. |
| **Private by default** | Everything is stored on the device (IndexedDB). JSON backup and restore. |

## Algorithms

- **Shortest chain:** bidirectional BFS over an adjacency index, so it explores about 2·b^(d/2) nodes instead of b^d.
- **Kinship:** each family walk becomes up / down / spouse steps, and its shape `[spouse] up^u down^d [spouse]` maps to a term ([`src/graph/kinship.ts`](src/graph/kinship.ts)). Everyone's relation to you comes from one BFS, cached per change.
- **Comparing graphs:** a salted **Bloom filter** of your contacts' phone and email keys (about 11 bits per contact, ≈0.5% false matches). 500 contacts fit in one QR code ([`src/compare/`](src/compare)).
- **Group outline:** the convex hull of the members' positions (monotone chain), redrawn every frame.
- **Large graphs:** up to about 150 connected people, the force layout runs and nodes show initials. Above that, an O(n) **cluster layout** takes over (you, then family, then one disc per group on a ring) with plain coloured nodes. Unconnected contacts are hidden behind a chip and drawn as a spiral of dots on demand. 1,500 contacts import in a few seconds on a phone.
- **Labels in names:** a word shared by enough contacts that isn't a first name (it usually comes first) or a common surname. Words that always appear together become one label ("באר שבע").

## Name patterns

| Contact name | Suggestion |
|---|---|
| `Mom`, `אבא`, `סבתא`, `Savta` | your mother / father / grandmother |
| `Uncle Moshe`, `דודה רחל`, `Avi (cousin)`, `לילך בת דודה` | your relative, labelled |
| `אמא של רז`, `אורנה אמא של הילה`, `Rivka (Sarah's mom)`, `אמא שאול` | parent of Raz / Hila / Sarah / Shaul |
| `נעמה של ניצן` | Naama and Nitzan are a couple |
| `שכנה של קרן`, `מזכירה של אריה`, `חברה של ניצן` | neighbour / colleague / friend of that person |
| `פני וגרי סבא וסבתא`, `מיירס פני וג'רי` | split into two people: a couple (and your grandparents / family) |
| `מתן שכן`, `חבר` | your neighbour / friend |
| `המפקד נדב`, `גל ברזני מפקד`, `סיון מורה ללשון`, `רוני הבוס`, `ספיר מאמנת` | army / school / work / coach link to you |
| `יוני מיירס` (your surname, in any of your names) | your relative — the card asks how |
| `מיקה ❤️`, `אהוב שלי` | the "❤️" group |
| `אמיתי מיירס` (one of your names) | merged into you; "This is me" merges anyone by hand |

Ambiguous words are left alone on purpose: `דוד` is also David, `בן דוד` a surname, `כפר סבא` a city, and
`X וY` is only split when both are known first names or the rest is your surname (`וייס`, `וולף` are surnames).
A shared phone never makes a contact "you": families share landlines.

## Development

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # unit tests (vitest)
npm run test:e2e      # Playwright journeys in English and Hebrew, two-user compare, axe accessibility scan
npm run build         # type-check + production build into dist/
npm run check:bundle  # start-up JavaScript must stay under 250 KB gzipped
```

Stack: Vite, TypeScript (strict), Cytoscape.js with the fcose layout, `idb`, `vite-plugin-pwa`, `qrcode-generator`, and `jsqr` (loaded only when scanning). The UI is framework-free TypeScript with two Web Components (`<jg-sheet>`, `<jg-person-picker>`) on the design tokens in [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md).

```
src/
  model/      domain types, identity matching, validation rules
  graph/      GraphIndex (BFS, mutual), kinship inference, convex hull
  compare/    Bloom filter, QR/share payload format, overlap detection (stage 2)
  importers/  vCard, WhatsApp, Facebook, Contact Picker, contact-name hints
  store/      IndexedDB persistence, in-memory store with undo snapshots, backup
  i18n/       English and Hebrew strings, kinship wording
  ui/         shell, views (graph, people, connect, me), sheets and flows, components
tests/e2e/    Playwright end-to-end and accessibility tests
```

## Deploy

`.github/workflows/deploy.yml` runs the unit tests, the end-to-end and accessibility tests and the bundle budget, then publishes to GitHub Pages on every push to `main`.

**One-time setup:** in the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

## Platform limits

- **WhatsApp and Facebook** have no API for contacts or friends, so the app imports their export files.
- **iPhone Safari** has no Contact Picker, so on iPhone you import a `.vcf` file.
- **AirDrop and NFC** are not available to web apps. The app uses QR codes and the system share sheet instead (which includes AirDrop on iPhone).
- **Phone-number matching** can't be made truly anonymous: a list of possible numbers can be tested against any code. The app therefore says "shares who you have in common" and never claims anonymity. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
