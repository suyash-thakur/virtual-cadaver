// Builds the site for GitHub Pages and pushes dist/ to the gh-pages branch of the origin remote.
//   npm run deploy
// Requires: git remote "origin" on GitHub, assets generated (npm run assets / vh / zanatomy).
import { execSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync, cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const sh = (c, o = {}) => execSync(c, { stdio: 'inherit', ...o });
const out = (c) => execSync(c, { encoding: 'utf8' }).trim();
const origin = out('git remote get-url origin');
const m = origin.match(/github\.com[:/]([^/]+)\/([^/.]+)/); if (!m) throw new Error(`origin is not a GitHub remote: ${origin}`);
const [, owner, repo] = m;
const base = `/${repo}/`;
console.log(`building for https://${owner}.github.io${base}`);
if (!existsSync('public/assets/body.glb')) console.warn('warning: public/assets has no body.glb; run npm run assets first for the real body');
sh('npx vite build', { env: { ...process.env, BASE_PATH: base } });
writeFileSync('dist/.nojekyll', '');
writeFileSync('dist/404.html', '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=' + base + '"><title>Redirecting</title>');
const work = mkdtempSync(join(tmpdir(), 'pages-'));
cpSync('dist', work, { recursive: true });
sh('git init -q', { cwd: work }); sh('git checkout -q -b gh-pages', { cwd: work });
sh('git add -A', { cwd: work });
sh(`git -c user.name="deploy" -c user.email="deploy@local" commit -q -m "Deploy ${out('git rev-parse --short HEAD')}"`, { cwd: work });
sh(`git push -f "${origin}" gh-pages:gh-pages`, { cwd: work });
rmSync(work, { recursive: true, force: true });
console.log(`pushed. Site: https://${owner}.github.io${base}`);
