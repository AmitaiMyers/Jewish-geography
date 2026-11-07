import type { Path } from '../graph/graphIndex';
import { kinshipText } from '../i18n/kinshipText';
import type { Person } from '../model/types';
import type { AppStore, Snapshot } from '../store/appStore';
import type { Snap } from './components/sheet';

/** What views and flows need from the app shell. */

export type TabName = 'graph' | 'people' | 'connect' | 'me';

export type Highlight =
  | { kind: 'path'; path: Path }
  | { kind: 'group'; groupId: string }
  | { kind: 'person'; personId: string };

export interface AppContext {
  store: AppStore;
  navigate(tab: TabName): void;
  openPerson(personId: string, snap?: Snap): void;
  showOnGraph(highlight: Highlight): void;
  /** Connect tab with both people pre-filled. */
  showConnection(fromId: string, toId: string): void;
  openSearch(): void;
  openImport(welcome?: boolean): void;
  openSuggestions(): void;
  openCompare(mode: 'show' | 'scan'): void;
  addPerson(): Promise<void>;
  createGroup(): Promise<void>;
  /** "Look for patterns in names" over everyone, then offer to review what was found. */
  rescanNames(): Promise<void>;
  /** Runs a delete and offers Undo in the toast (no "are you sure?"). */
  deleteWithUndo(message: string, run: () => Promise<Snapshot>): Promise<void>;
}

export interface View {
  element: HTMLElement;
  render(): void;
  onShow(): void;
}

/** "uncle", "בת דודה"… or '' when the person is not family (or is me). */
export function relationToMeText(store: AppStore, person: Person): string {
  const kinship = store.kinshipToMe(person.id);
  return kinship === null || kinship.kind === 'self' ? '' : kinshipText(kinship, person.gender, (id) => store.person(id).gender);
}

export function groupColors(store: AppStore, person: Person): string[] {
  return person.groupIds.map((id) => store.group(id).color);
}
