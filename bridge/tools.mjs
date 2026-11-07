// What SLOP can do, as Gemini Live function declarations (live.mjs turns them into Gemini's
// shape). None of them block: the bridge answers at once and sends the outcome later as a note.
import { SECTION_ID, STEPS } from './site.mjs';
import { SPEC_FIELDS, missingAll, missingFor, specText } from './spec.mjs';

export const MOODS = ['smug', 'deadpan', 'bored', 'suspicious', 'contempt', 'thinking', 'angry', 'furious', 'surprised', 'pleased', 'calm'];
export const GESTURES = ['eyeroll', 'glance', 'slowblink', 'squint', 'doubletake', 'wide'];

export const TOOLS = [
  {
    name: 'note_spec',
    description:
      'Record one answer to the spec the moment you hear it, whether you asked for it or the ' +
      'human volunteered it. Call it silently, one field per call. The reply lists what is ' +
      'still missing, so you know what to ask next. Fields: ' +
      SPEC_FIELDS.map((f) => `${f.id} (${f.question})`).join('; '),
    parameters: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: SPEC_FIELDS.map((f) => f.id) },
        answer: { type: 'string', description: 'The answer in a few words, in English. "none" is a valid answer for brand.' },
      },
      required: ['field', 'answer'],
    },
  },
  {
    name: 'set_mood',
    description:
      'Set your facial expression, and optionally play a short gesture on top. Call it silently ' +
      'and often so your face matches your tone: before a verdict, when something is absurd, ' +
      'when you are waiting for the intern.',
    parameters: {
      type: 'object',
      properties: {
        mood: { type: 'string', enum: MOODS },
        intensity: { type: 'number', description: '0 to 1, how strong' },
        gesture: { type: 'string', enum: GESTURES, description: 'A short move to play now' },
      },
      required: ['mood'],
    },
  },
  {
    name: 'look_at',
    description:
      'Turn your gaze. "user" looks at the human. "site" looks at the website being built. ' +
      'A section id looks at that section and scrolls the site to it.',
    parameters: {
      type: 'object',
      properties: { target: { type: 'string', description: '"user", "site" or a section id' } },
      required: ['target'],
    },
  },
  {
    name: 'build',
    description:
      'Make the intern build or change part of the site. In order: key "design" writes the ' +
      'design system (tokens.css: colours, typefaces, spacing) and shows it as a style tile; key ' +
      '"structure" writes the section list with a one-line plan each and a real low-fidelity ' +
      'wireframe of every section (layout, proportions, where the picture and headline go); a ' +
      'section id (lowercase, hyphens: hero, menu, story, visit) replaces that wireframe with the ' +
      'real section; key "scripts" writes the scroll choreography between sections at the end. Returns ' +
      'at once; you are told when it is done. "design" and "structure" are refused while spec ' +
      'fields are missing; the refusal names them, so ask those.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '"design", "structure", "scripts" or a section id' },
        brief: {
          type: 'string',
          description:
            'The brief for the intern, in English. The recorded spec is attached automatically, ' +
            'so say what this step needs: art direction for the design, the sections and their ' +
            'ideas for the structure, exactly what goes in a section. For a change: what to ' +
            'change and what to keep.',
        },
      },
      required: ['key', 'brief'],
    },
  },
  {
    name: 'show_site',
    description: 'Show or hide the website on screen. It appears by itself on the first build.',
    parameters: {
      type: 'object',
      properties: { visible: { type: 'boolean' } },
      required: ['visible'],
    },
  },
];

export const buildKey = (key) => STEPS.has(key) || SECTION_ID.test(String(key));

/** Why a build call is refused, or '' when it may go ahead. SLOP reads this out, so it names the gap. */
export function refuseBuild({ key, brief, spec = {} }) {
  if (!buildKey(key)) return `"${key}" is not a section id. Lowercase words and hyphens.`;
  const missing = missingFor(key, spec);
  if (missing.length) {
    const asks = SPEC_FIELDS.filter((f) => missing.includes(f.id)).map((f) => `${f.id}: ${f.question}`);
    return `Not yet. Still unanswered: ${asks.join(' ')} Ask, or record what you already heard with note_spec.`;
  }
  const words = String(brief ?? '').trim().split(/\s+/).filter(Boolean).length;
  if (words < 8) return `The brief is ${words} words. Say what this step should be.`;
  return '';
}

/** The intern's prompt for one build call: the task, the brief, and the recorded spec. */
export function internPrompt({ key, brief, spec = {} }) {
  return `${taskPrompt({ key, brief })}\n\nClient spec (recorded by SLOP):\n${specText(spec)}`;
}

function taskPrompt({ key, brief }) {
  if (key === 'design')
    return `Design task. Write tokens.css: the complete design system this site will use. Follow the "Design task" rules in your brief (the required variable names, fonts via @import, base element styles). Also set "title" in site.json to the site's name (keep any other fields). Nothing else.\n\nBrief: ${brief}`;
  if (key === 'structure' || key === 'site')
    return `Structure task. Write site.json (the title, the ordered section ids, and "plan": one line per section saying what goes in it and its one bold idea), then a wireframe for every section in sections/<id>.html, following the "Structure task" rules in your brief (the wf- primitives, data-wire, real proportions). Read tokens.css first.\n\nBrief: ${brief}`;
  if (key === 'scripts')
    return `Write scripts.js: the scroll choreography that joins the existing sections (GSAP and ScrollTrigger are globals). Read tokens.css and every sections/*.html first. Keep it tasteful and respect prefers-reduced-motion.\n\nBrief: ${brief}`;
  return `Build or update sections/${key}.html. Read tokens.css and site.json first (its plan line for ${key}), and the current sections/${key}.html if it exists. One <section id="${key}"> with its scoped <style>. Use <img data-gen="..."> for any picture, always with a fixed aspect-ratio in CSS.\n\nBrief: ${brief}`;
}

/** What the session's system instruction says about the project right now. */
export function projectNote(site, existing, hasDesign, spec = {}) {
  const missing = missingAll(spec);
  const specNote = `Spec so far:\n${specText(spec)}\n${
    missing.length ? `Still unanswered: ${missing.join(', ')}.` : 'The spec is complete.'
  }`;
  if (!hasDesign && !site.sections.length)
    return `${specNote}\nNothing has been built yet. Get the spec, then "design".`;
  const lines = site.sections.map((id) => `${id}: ${existing.has(id) ? 'built' : 'wireframe only'}${site.plan[id] ? ` (plan: ${site.plan[id]})` : ''}`);
  return `${specNote}\n${hasDesign ? 'The design system exists.' : 'There is no design system yet.'} ${
    site.sections.length ? `The project "${site.title}" has these sections, in order:\n${lines.join('\n')}` : 'There is no structure yet.'
  }`;
}
