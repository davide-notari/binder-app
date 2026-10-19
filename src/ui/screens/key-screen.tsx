// Access key (SPEC.md §6 screen 2): paste the personal key, validated by reading index.json.
import { useState } from 'preact/hooks';
import { strings } from '../strings';
import './screens.css';

export type KeyProblem = 'invalid' | 'no-access' | 'offline' | 'rate-limited' | 'revoked' | 'unexpected';

const MESSAGES: Readonly<Record<KeyProblem, string>> = {
  invalid: strings.keyInvalid,
  'no-access': strings.keyNoAccess,
  offline: strings.keyOffline,
  'rate-limited': strings.keyRateLimited,
  revoked: strings.keyRevoked,
  unexpected: strings.keyUnexpected,
};

interface Props {
  /** Shown before the user types anything (e.g. the stored key was revoked). */
  readonly initialProblem?: KeyProblem | undefined;
  /** Validates and stores the key; resolves with a problem, or null when the binder can open. */
  readonly onSubmit: (key: string) => Promise<KeyProblem | null>;
  /** Replacing a key from the settings: going back keeps the current one. */
  readonly onCancel?: (() => void) | undefined;
}

export function KeyScreen({ initialProblem, onSubmit, onCancel }: Props) {
  const [key, setKey] = useState('');
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<KeyProblem | null>(initialProblem ?? null);

  const submit = async (event: Event) => {
    event.preventDefault();
    const trimmed = key.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setProblem(null);
    const result = await onSubmit(trimmed);
    setChecking(false);
    setProblem(result);
  };

  return (
    <main class="screen">
      <h1>{strings.keyTitle}</h1>
      <p>{strings.keyIntro}</p>
      <form class="key-form" onSubmit={(e) => void submit(e)}>
        <label class="key-label" for="access-key">
          {strings.keyLabel}
        </label>
        <input
          id="access-key"
          class="key-input"
          type="password"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          placeholder="github_pat_…"
          value={key}
          disabled={checking}
          onInput={(e) => {
            setKey(e.currentTarget.value);
          }}
        />
        {problem && (
          <p class="key-problem" role="alert">
            {MESSAGES[problem]}
          </p>
        )}
        <button type="submit" class="primary-button" disabled={!key.trim() || checking}>
          {checking ? strings.keyChecking : strings.keyContinue}
        </button>
        {onCancel && (
          <button type="button" class="secondary-button" disabled={checking} onClick={onCancel}>
            {strings.cancel}
          </button>
        )}
      </form>
    </main>
  );
}
