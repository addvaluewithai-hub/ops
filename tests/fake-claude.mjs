// Stands in for `claude -p ... --output-format stream-json` in the bridge test: writes the
// hero with a picture to generate and prints the events Claude Code would print.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const file = join(process.cwd(), 'sections', 'hero.html');
out({ type: 'system', subtype: 'init', session_id: args[args.indexOf('--session-id') + 1] });
out({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: file } }] },
});
mkdirSync(join(process.cwd(), 'sections'), { recursive: true });
writeFileSync(
  file,
  '<section id="hero"><h1>Slurp</h1><img data-gen="steam over a ramen bowl" data-aspect="4:5" alt="" src=""></section>\n',
);
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hero done.' }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: 'Hero done.' });
