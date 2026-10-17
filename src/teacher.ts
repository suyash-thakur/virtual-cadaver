import './styles.css';
import { loadContent } from './content';
import { classSummary, parseProgress, type Progress } from './logic/progress';
import { esc } from './app/html';

const C = loadContent();
const name = (id: string) => C.byId[id]?.name || C.surfaces[id]?.name || id;
const records: Progress[] = [];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function addFiles(files: FileList | File[]) {
  const errs: string[] = [];
  for (const f of Array.from(files)) {
    try { const p = parseProgress(await f.text()); const i = records.findIndex(r => r.student.id === p.student.id); if (i >= 0) records[i] = p; else records.push(p); }
    catch { errs.push(f.name); }
  }
  $('errors').textContent = errs.length ? `Not progress files: ${errs.join(', ')}` : '';
  render();
}

function render() {
  if (!records.length) return;
  const s = classSummary(records, C.steps.length);
  $('summary').hidden = false;
  $('tiles').innerHTML = [
    ['Students', String(s.rows.length)], ['Mean steps done', `${s.meanSteps} / ${C.steps.length}`], ['Mean spotter accuracy', s.meanAccuracy == null ? 'none yet' : `${s.meanAccuracy}%`],
  ].map(([k, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
  const tbody = $('table').querySelector('tbody')!;
  tbody.innerHTML = s.rows.sort((a, b) => a.name.localeCompare(b.name)).map(r => `<tr><td>${esc(r.name)}</td><td>${r.stepsDone} / ${r.totalSteps}</td><td>${r.spotterSessions}</td><td>${r.spotterAccuracy == null ? '' : r.spotterAccuracy + '%'}</td><td>${esc(r.weakest.slice(0, 3).map(w => name(w.id)).join(', '))}</td><td>${new Date(r.updatedAt).toLocaleDateString()}</td></tr>`).join('');
  $('weak').innerHTML = s.classWeakest.map(w => `<li>${esc(name(w.id))} <span class="muted">missed ${w.misses} time${w.misses === 1 ? '' : 's'}</span></li>`).join('') || '<li class="muted">No spotter sessions yet.</li>';
}

$('files').addEventListener('change', () => { const f = $<HTMLInputElement>('files').files; if (f) addFiles(f); });
const drop = $('drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer?.files) addFiles(e.dataTransfer.files); });
