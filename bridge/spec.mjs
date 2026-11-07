// The spec: the fixed set of questions SLOP needs answered before he builds. He records every
// answer as he hears it (volunteered or asked), asks only what is still missing, and each build
// step refuses with the exact missing fields, not a vague "spec incomplete".
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SPEC_FIELDS = [
  { id: 'name', question: 'What is it called?' },
  { id: 'what', question: 'What is it: the business, product or person, in one line?' },
  { id: 'audience', question: 'Who is it for? Be specific: not "everyone".' },
  { id: 'goal', question: 'The one thing a visitor should do: book, buy, call, sign up, read?' },
  { id: 'feeling', question: 'The one feeling it should give, or a reference you like?' },
  { id: 'content', question: 'What must be on it: the sections or must-haves?' },
  { id: 'brand', question: 'Anything fixed already: colours, fonts, a logo, a language? (optional)' },
];

/** What each step needs filled in. Sections need nothing beyond the structure. */
export const NEEDS = {
  design: ['name', 'what', 'audience', 'feeling'],
  structure: ['name', 'what', 'audience', 'goal', 'feeling', 'content'],
};

export const isField = (id) => SPEC_FIELDS.some((f) => f.id === id);

export async function readSpec(dir) {
  try {
    const raw = JSON.parse(await readFile(join(dir, '.slop', 'spec.json'), 'utf8'));
    const spec = {};
    for (const f of SPEC_FIELDS) if (typeof raw[f.id] === 'string' && raw[f.id].trim()) spec[f.id] = raw[f.id].trim();
    return spec;
  } catch {
    return {};
  }
}

export async function writeSpec(dir, spec) {
  await mkdir(join(dir, '.slop'), { recursive: true });
  await writeFile(join(dir, '.slop', 'spec.json'), JSON.stringify(spec, null, 2));
}

/** The fields a step still needs, in the order to ask them. */
export const missingFor = (key, spec) => (NEEDS[key] ?? []).filter((id) => !spec[id]);

/** Every unanswered field, required ones first. */
export const missingAll = (spec) => SPEC_FIELDS.map((f) => f.id).filter((id) => !spec[id]);

/** The spec as a block for prompts: the intern's and SLOP's. */
export function specText(spec) {
  const lines = SPEC_FIELDS.filter((f) => spec[f.id]).map((f) => `${f.id}: ${spec[f.id]}`);
  return lines.length ? lines.join('\n') : '(nothing recorded yet)';
}
