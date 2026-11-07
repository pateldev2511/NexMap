import { execSync } from 'node:child_process';

/** Builds the production bundle the specs serve. Set E2E_SKIP_BUILD=1 to reuse `dist/`. */
export default function globalSetup() {
  if (process.env.E2E_SKIP_BUILD) return;
  execSync('npm run build', { stdio: 'inherit' });
}
