import { dismissToast, toasts } from '../state/store';
import { Icon } from './icons';

export function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind} ${t.action ? 'has-action' : ''}`}>
          {t.kind === 'success' && <Icon class="t-icon" name="check" size={15} />}
          {t.message}
          {t.action && (
            <button
              class="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
