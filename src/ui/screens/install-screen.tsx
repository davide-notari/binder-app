// Welcome / installation (SPEC.md §6 screen 1): shown when the app is not running from the Home Screen.
import { strings } from '../strings';
import './screens.css';

function ShareIcon() {
  return (
    <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3v12M7.5 7.5 12 3l4.5 4.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 10H16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg class="share-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.8" />
      <path d="M12 8.5v7M8.5 12h7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}

export function InstallScreen() {
  return (
    <main class="screen">
      <h1>{strings.installTitle}</h1>
      <p>{strings.installIntro}</p>
      <ol class="install-steps">
        <li>
          <ShareIcon />
          <span>{strings.installStep1}</span>
        </li>
        <li>
          <AddIcon />
          <span>{strings.installStep2}</span>
        </li>
        <li>
          <img class="install-app-icon" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />
          <span>{strings.installStep3}</span>
        </li>
      </ol>
      <p class="screen-note">{strings.installSafari}</p>
      <p class="screen-note">{strings.installNote}</p>
    </main>
  );
}
