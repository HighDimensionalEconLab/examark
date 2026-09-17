import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Package output', () => {
  it('replaces an existing zip instead of appending to it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'examark-zip-'));
    const md = (title: string) => `# ${title}\n\n## 1. Q [1 pts]\n\na) x [correct]\nb) y\n`;
    const input = join(dir, 'quiz.md');
    const output = join(dir, 'quiz.qti.zip');
    writeFileSync(input, md('First title'));
    execSync(`node dist/index.js "${input}" -o "${output}"`, { stdio: 'pipe' });
    writeFileSync(input, md('Second title'));
    execSync(`node dist/index.js "${input}" -o "${output}"`, { stdio: 'pipe' });
    const listing = execSync(`unzip -Z1 "${output}"`, { encoding: 'utf-8' });
    const assessmentDirs = listing.split('\n').filter(l => /^[0-9a-f]{32}\/$/.test(l));
    rmSync(dir, { recursive: true, force: true });
    expect(assessmentDirs).toHaveLength(1);
  });
});
