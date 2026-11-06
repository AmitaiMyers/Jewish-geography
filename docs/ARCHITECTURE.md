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
| 11 | Login | All options: phone, Google, Apple, email. **Deferred to stage 2**, because login needs a backend and decision 9 rules one out for v1. |
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

### Proposed design (serverless; matches decisions 7–9)

1. Each phone builds a **Bloom filter** of its contacts' normalised identifiers: about 1 KB for 500 people at a 1% false-positive rate, small enough for one QR code.
2. User A shows a QR code with A's filter. B scans it and tests each of B's own contacts against the filter. That gives the **people both know** without sending B anything.
3. Two-way: B then shows a QR code and A scans it. The likely overlap is confirmed by tapping through a short list, which removes false positives.
4. A's "me" node and the overlapping people are linked in both graphs. The shortest chain then works across the two users (`you → Avi → them`).
5. Fallback for people not standing together: send the same payload as a small file through the share sheet (AirDrop, WhatsApp…).

A Bloom filter only answers "is this contact in your list?" It does not reveal a list of numbers. It is still open to dictionary attacks (as is every phone-number scheme), so the UI will say "shares who you have in common". It will not claim to be anonymous.

### When a backend is added (global search, accounts)

Supabase would provide Postgres, row-level security, and phone OTP / Google / Apple / email login, which covers decision 11. Real private matching would then use private set intersection (ECDH-PSI) on the server instead of plain hashes.
