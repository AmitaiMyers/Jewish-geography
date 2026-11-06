import { registerSW } from 'virtual:pwa-register';
import { applyLanguageToDocument, setLanguage, t } from './i18n/i18n';
import { AppStore } from './store/appStore';
import { App, runOnboarding } from './ui/app';
import { toast } from './ui/dom';
import './styles.css';

/** Fail fast, but visibly: any unexpected error is shown instead of silently swallowed. */
function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  toast(`${t('errorPrefix')} ${message}`);
}
window.addEventListener('error', (event) => reportError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

registerSW({ immediate: true });

async function main(): Promise<void> {
  const store = await AppStore.load();
  if (!store.isOnboarded) {
    await runOnboarding(store);
  }
  setLanguage(store.settings.language);
  applyLanguageToDocument();
  new App(store).start();
}

void main();
