// Pipeline — deals + tasks. Full version lands in P3; P0 ships the stub.
import { empty } from './core.js';
import { goTab } from './app.js';

export const id = 'pipeline';
export const title = 'Pipeline';
export const icon = '▤';
export const hotkey = 'p';

export function render(root) {
  root.appendChild(
    empty('Deals arrive in a later phase — interested leads will land here automatically.', 'View interested leads', () => {
      goTab('leads');
      setTimeout(() => {
        const sel = document.getElementById('f-status');
        if (sel) { sel.value = 'interested'; sel.dispatchEvent(new Event('change')); }
      }, 150);
    }),
  );
}
