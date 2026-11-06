# Jewish Geography

A Progressive Web App that maps everyone you know as a graph and shows how they are connected: family, friends, shul, yeshiva, camp, army, work, and so on. Works in English and Hebrew (right-to-left), on iPhone and Android, and offline.

**Live app:** https://amitaimyers.github.io/Jewish-geography/ (after GitHub Pages is enabled, see [Deploy](#deploy))

## What it does (stage 1)

| Feature | How |
|---|---|
| Graph of the people you know | Interactive graph; tap anyone to open their card. Groups show as coloured clusters, and someone in several groups is drawn as a pie of those colours. |
| Import people | **Android**: pick phone contacts directly. **iPhone / Google**: import a `.vcf` contacts file. **WhatsApp**: an exported chat imports everyone who wrote in it, and can become a group. **Facebook**: `friends.json` from "Download your information". Already-known people are detected by phone or email and skipped. |
| Name connections | Parent / child, spouse, sibling, relative (custom label), friend, school / yeshiva, work, shul, neighbour, camp, army, or any custom label. |
| Connections from contact names | Names such as `Mom`, `Uncle Moshe`, `Avi (cousin)`, `Rivka (Sarah's mom)` or `אבא של שרה` produce suggestions that you accept or dismiss. |
| Family-tree inference | From parent, spouse and sibling links alone, the app works out uncle, great-aunt, second cousin once removed, brother-in-law, mechutan… in English and Hebrew. |
| How are two people connected? | The family relation, the shortest chain of any connections, and their mutual connections. Can be highlighted on the graph. |
| Groups | Create, colour, rename, bulk-add from the People list, and filter the graph. |
| Bulk clean-up | Select many people and delete them (with their connections) or add them to a group. |
| Private by default | Everything is stored on the device (IndexedDB). Export or restore a JSON backup to move phones. |

## Algorithms

All graph work runs on an adjacency list built in O(V + E):

- **Shortest chain:** bidirectional breadth-first search, which explores about 2·b^(d/2) nodes instead of b^d.
- **Mutual connections:** set intersection in O(deg(a) + deg(b)).
- **Everyone's relation to you:** one BFS over family links, computed once per change and cached.
- **Kinship naming:** each family walk becomes up / down / spouse steps, and its shape `[spouse] up^u down^d [spouse]` maps to a term. See [`src/graph/kinship.ts`](src/graph/kinship.ts).

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (vitest)
npm run build      # type-check + production build into dist/
```

Stack: Vite, TypeScript (strict), Cytoscape.js with the fcose layout, `idb`, and `vite-plugin-pwa` (Workbox service worker). The UI uses plain TypeScript and DOM, with no UI framework.

```
src/
  model/      domain types, identity matching, validation rules
  graph/      GraphIndex (BFS, mutual connections) and kinship inference
  importers/  vCard, WhatsApp, Facebook, Contact Picker, contact-name hints
  store/      IndexedDB persistence, in-memory store, backup format
  i18n/       English and Hebrew strings, kinship wording
  ui/         app shell, graph, people, groups, connect, more, person sheet
```

## Deploy

`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on every push to `main`.

**One-time setup:** in the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Then re-run the workflow.

## Platform limits

- **WhatsApp and Facebook** offer no API for contacts or friends, so the app imports their export files instead.
- **iPhone Safari** has no Contact Picker, so on iPhone you import a `.vcf` file.
- **AirDrop and NFC** cannot be used by web apps. Stage 2 will use QR codes and the system share sheet instead. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
