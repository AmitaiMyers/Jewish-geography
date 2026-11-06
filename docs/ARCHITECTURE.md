# Architecture and product decisions

## Decisions made

| # | Topic | Decision |
|---|---|---|
| 1 | Nodes | People only. |
| 2 | Connection types | A fixed list plus custom labels. |
| 3 | Family | Full family tree with inference, stored as three primitives: parent (directed), spouse, sibling. |
| 4 | Contact-name hints | The app suggests, and the user confirms. Nothing is linked automatically. |
| 5 | Groups | A person can be in many groups. Groups show as coloured clusters. |
| 6 | Scale | Around 500 people per user, which is easy for a canvas renderer. |
| 7 | Sharing (stage 2) | Only the overlap (people both users know) is revealed. |
| 8 | Matching across users | By normalised phone number or email, never by name. |
| 9 | Backend | None in v1. Data lives in IndexedDB on the device. |
| 10 | "Find connections" | Mutual connections plus the shortest chain. |
| 11 | Login | All options: phone, Google, Apple, email. **Deferred until a backend exists**, because decision 9 rules one out; stage 2 works without accounts. |
| 12 | Third-party data | Accepted, with private-first design. |
| 13–14 | Platforms and languages | iPhone and Android; English and Hebrew (right-to-left). |
| 15 | Stack | Vite, TypeScript, Cytoscape.js, IndexedDB, GitHub Pages. |

## Data model

```
Person    { id, name, gender, phones[], emails[], groupIds[], notes, source }
Relation  { id, from, to, type, label }      // parent: from IS PARENT OF to
Group     { id, name, color }
Suggestion{ from, to, type, label, subjectId, genderHint, evidence }
Settings  { meId, language }
```

"Me" is an ordinary person (`source: 'self'`). People you have not linked to anyone are tied to you by invisible layout edges, so the graph stays compact.

## Stage 2: comparing graphs with another user

### Constraints found

- **No AirDrop or NFC for web apps.** Exchange instead by **QR code** (scanned in person) or by **sharing a file through the system share sheet**. On iPhone that sheet includes AirDrop, and on Android it includes Quick Share.
- **Hashing phone numbers is not real privacy.** There are only about 10⁹ possible numbers, so anyone holding a list of hashes can recover the numbers by brute force in minutes. Hashes are fine as a matching key, but they must not be presented as anonymous.
- **QR codes are small** (under about 2.9 KB). 500 contacts × 2 identifiers × 8-byte hashes is about 8 KB, which does not fit.

### Implemented design (serverless; matches decisions 7–9)

| Step | What happens | Code |
|---|---|---|
| 1 | **Build a code.** My name, my own phone/email, and a salted Bloom filter of every contact's identity key (`p:<last 9 digits>` / `e:<email>`). About 11 bits per key; the filter shrinks to fit one QR code (≤ 2000 characters), accepting more false matches for very large graphs. | `src/compare/payload.ts`, `src/compare/bloom.ts` |
| 2 | **Hand it over.** A QR code on screen, or shared as text through the share sheet (WhatsApp, AirDrop…) — copied to the clipboard where sharing is unavailable. A received code can be pasted or opened from a .txt file. | `src/ui/compareFlow.ts` |
| 3 | **Receive.** The camera scans it (jsQR, loaded only when needed), or the user pastes the code or opens the file. | `openScanner` |
| 4 | **Overlap.** On the receiver's phone only: which of my contacts the filter says my friend knows, and whether my friend is already in my graph (matched by their phone or email). | `src/compare/overlap.ts` |
| 5 | **Confirm and link.** The user unticks coincidences and chooses how they know the friend. One transaction then adds the friend if they are new, a link me ↔ friend, and a `knows` link friend ↔ each person we have in common. | `AppStore.applyComparison` |
| 6 | **Both ways.** The friend does the same with my code. After that, shortest chains run through each other. | — |

What the receiver learns: the sender's name and contact details (shared on purpose), and which of the receiver's *own* contacts the sender probably knows. The sender's full list is never sent, but see the caveat above: phone numbers can be tested against a filter.

### When a backend is added (global search, accounts)

Supabase would provide Postgres, row-level security, and phone OTP / Google / Apple / email login, which covers decision 11. Real private matching would then use private set intersection (ECDH-PSI) on the server instead of plain hashes.
