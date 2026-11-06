import type { Path } from '../graph/graphIndex';
import { kinshipText } from '../i18n/kinshipText';
import type { Person } from '../model/types';
import type { AppStore } from '../store/appStore';

/** What views need from the app shell. */

export type TabName = 'graph' | 'people' | 'groups' | 'connect' | 'more';

export type Highlight = { kind: 'path'; path: Path } | { kind: 'group'; groupId: string } | { kind: 'person'; personId: string };

export interface AppContext {
  store: AppStore;
  openPerson(personId: string): void;
  showOnGraph(highlight: Highlight): void;
  navigate(tab: TabName): void;
}

export interface View {
  element: HTMLElement;
  render(): void;
  onShow(): void;
  setQuery(query: string): void;
}

/** "uncle", "בת דודה"… or '' when the person is not family (or is me). */
export function relationToMeText(store: AppStore, person: Person): string {
  const kinship = store.kinshipToMe(person.id);
  return kinship === null ? '' : kinshipText(kinship, person.gender, (id) => store.person(id).gender);
}

export function groupColors(store: AppStore, person: Person): string[] {
  return person.groupIds.map((id) => store.group(id).color);
}
