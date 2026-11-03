import { spawnSync } from 'node:child_process';

const executable = process.env.CODELEADER_GITLEAKS || 'gitleaks';
const result = spawnSync(executable, ['git', '--staged', '--redact', '--no-banner', '--exit-code', '1', '.'], { stdio: 'inherit' });
if (result.error) console.error('Gitleaks is required; install it or set CODELEADER_GITLEAKS to its executable.');
process.exit(result.status ?? 1);
