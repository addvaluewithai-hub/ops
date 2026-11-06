// The intern: Claude Code, started the moment SLOP asks (no queue). It works inside the
// project folder with file tools only (no shell, no web), and its JSON events are turned into
// short lines that stream to the browser, so SLOP can comment on the work while it happens.
// One Claude session per key ("site", "hero", "features"...), so sections can build side by
// side and an edit to the hero resumes the hero's own conversation.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const HERE = dirname(fileURLToPath(import.meta.url));

export const internBrief = () => readFile(join(HERE, 'intern.md'), 'utf8');

export function claudeArgs({ prompt, sessionId, resume, config, brief }) {
  return [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    // Only the bridge user's own settings and login, nothing from the project folder.
    '--setting-sources',
    'user',
    ...(resume ? ['--resume', sessionId] : ['--session-id', sessionId]),
    '--model',
    config.claudeModel,
    ...(config.claudeEffort ? ['--effort', config.claudeEffort] : []),
    '--max-turns',
    String(config.claudeMaxTurns),
    '--append-system-prompt',
    brief,
    '--strict-mcp-config',
    '--tools',
    TOOLS.join(','),
    '--allowedTools',
    TOOLS.join(','),
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
  ];
}

/** A tool call as one short line: "writing sections/hero.html". */
export function describe(name, input = {}, dir = '') {
  const file = input.file_path ? relative(dir, input.file_path) || input.file_path : '';
  if (name === 'Write') return `writing ${file}`;
  if (name === 'Edit') return `editing ${file}`;
  if (name === 'Read') return `reading ${file}`;
  if (name === 'Glob' || name === 'Grep') return 'looking around the project';
  return name.toLowerCase();
}

/** One stream-json event into the run's state; onStep gets each new visible line. */
export function consume(event, state, onStep, dir) {
  const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
  if (event.type === 'assistant')
    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const text = describe(block.name, block.input, dir);
        if (block.name === 'Write' || block.name === 'Edit') state.files.add(text.split(' ')[1]);
        onStep({ kind: 'tool', text });
      }
      if (block.type === 'text' && block.text?.trim())
        onStep({ kind: 'said', text: block.text.trim().slice(0, 400) });
    }
  if (event.type === 'result') {
    if (event.is_error || event.subtype !== 'success')
      state.failure = `${event.subtype}: ${String(event.result ?? '').slice(0, 300)}`;
    else state.result = typeof event.result === 'string' ? event.result : '';
  }
}

async function sessions(dir) {
  try {
    return JSON.parse(await readFile(join(dir, '.slop', 'sessions.json'), 'utf8'));
  } catch {
    return {};
  }
}

async function remember(dir, key, sessionId) {
  const all = await sessions(dir);
  all[key] = sessionId;
  await mkdir(join(dir, '.slop'), { recursive: true });
  await writeFile(join(dir, '.slop', 'sessions.json'), JSON.stringify(all, null, 2));
}

const LOST_SESSION = /no conversation found|session.*(not found|does not exist)/i;

function run({ dir, prompt, sessionId, resume, config, brief, spawner }, onStep) {
  const state = { files: new Set(), result: '', failure: '' };
  const child = spawner(config.claudeBin, claudeArgs({ prompt, sessionId, resume, config, brief }), {
    cwd: dir,
    env: {
      ...process.env,
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, config.claudeTimeoutMs);
  child.stderr.on('data', (chunk) => (stderr = `${stderr}${chunk}`.slice(-4000)));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      consume(JSON.parse(line), state, onStep, dir);
    } catch {
      // not a JSON event
    }
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && !state.failure) return resolve(state);
      reject(
        new Error(
          state.failure ||
            (timedOut ? 'the intern timed out' : stderr.trim() || `claude exited ${code}`),
        ),
      );
    });
  });
}

/**
 * Builds one key. Resolves { files, result }. A key whose session the machine no longer has
 * (a new VPS, a cleared home) starts a fresh session.
 */
export async function build({ dir, key, prompt, config, spawner = spawn }, onStep) {
  const brief = await internBrief();
  const known = (await sessions(dir))[key];
  const sessionId = known ?? crypto.randomUUID();
  await remember(dir, key, sessionId);
  const input = { dir, prompt, sessionId, resume: Boolean(known), config, brief, spawner };
  try {
    return await run(input, onStep);
  } catch (error) {
    if (!known || !LOST_SESSION.test(error.message)) throw error;
    const fresh = crypto.randomUUID();
    await remember(dir, key, fresh);
    return run({ ...input, sessionId: fresh, resume: false }, onStep);
  }
}
