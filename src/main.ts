import './styles.css';
import { loadContent } from './content';
import { renderFallback } from './app/fallback';

const C = loadContent();
const canvas = document.getElementById('c') as HTMLCanvasElement;
const fallback = document.getElementById('fallback') as HTMLElement;

async function boot() {
  const { createGfx } = await import('./engine/renderer');
  const gfx = createGfx(canvas);
  if (!gfx) { fail('This browser could not start WebGL.'); return; }
  try {
    const { App } = await import('./app/App');
    const app = new App(C, gfx, document.getElementById('app') as HTMLElement);
    (window as unknown as { __vc: unknown }).__vc = app; // debug handle, read-only use
    await app.start();
  } catch (err) {
    console.error(err);
    fail('The 3D specimen failed to start.');
  }
}

function fail(reason: string) {
  document.getElementById('loading')!.hidden = true;
  for (const el of document.querySelectorAll<HTMLElement>('.bar, .modes, .sheet, #labels, #leaders')) el.hidden = true;
  renderFallback(fallback, C, reason);
}

boot();
