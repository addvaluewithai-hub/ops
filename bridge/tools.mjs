// What SLOP can do, as Gemini Live function declarations (live.mjs turns them into Gemini's
// shape). None of them block: the bridge answers at once and sends the outcome later as a note.
import { SECTION_ID } from './site.mjs';

export const MOODS = ['angry', 'furious', 'bored', 'contempt', 'suspicious', 'thinking', 'surprised', 'pleased', 'calm'];

export const TOOLS = [
  {
    name: 'set_mood',
    description:
      'Set your facial expression. Call it silently and often so your face matches what you say: ' +
      'before a rant, when something impresses you, when you are waiting for the intern.',
    parameters: {
      type: 'object',
      properties: {
        mood: { type: 'string', enum: MOODS },
        intensity: { type: 'number', description: '0 to 1, how strong' },
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
      'Make the intern build or change part of the site. key "site" writes the wireframe ' +
      '(site.json with the section list, and tokens.css, the design system) from the spec. A ' +
      'section id (lowercase, hyphens: hero, menu, story, visit) builds or rebuilds that ' +
      'section. key "scripts" writes the scroll choreography between sections. Returns at ' +
      'once; you are told when it is done. Refused without a real spec.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '"site", "scripts" or a section id' },
        brief: {
          type: 'string',
          description:
            'The full brief for the intern, in English: audience, goal, feeling, content, ' +
            'art direction, and for a section exactly what goes in it. For a change: what to ' +
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

export const buildKey = (key) =>
  key === 'site' || key === 'scripts' || SECTION_ID.test(String(key));

/** Why a build call is refused, or '' when it may go ahead. SLOP reads this out, so it is in character. */
export function refuseBuild({ key, brief }) {
  if (!buildKey(key)) return `"${key}" is not a section id. Lowercase words and hyphens.`;
  const words = String(brief ?? '').trim().split(/\s+/).filter(Boolean).length;
  if (words < 25)
    return `Spec incomplete: ${words} words. Who is it for, what should they do, what should it feel like, what goes in it.`;
  return '';
}

/** The intern's prompt for one build call. */
export function internPrompt({ key, brief }) {
  if (key === 'site')
    return `Wireframe task. Write site.json (title and the ordered section ids) and tokens.css (the complete design system: fonts via @import, colour, type scale, spacing, radius, motion, base element styles). Do not write any section file.\n\nBrief: ${brief}`;
  if (key === 'scripts')
    return `Write scripts.js: the scroll choreography that joins the existing sections (GSAP and ScrollTrigger are globals). Read tokens.css and every sections/*.html first. Keep it tasteful and respect prefers-reduced-motion.\n\nBrief: ${brief}`;
  return `Build or update sections/${key}.html. Read tokens.css and site.json first, and the current sections/${key}.html if it exists. One <section id="${key}"> with its scoped <style>. Use <img data-gen="..."> for any picture.\n\nBrief: ${brief}`;
}

/** What the session's system instruction says about the project right now. */
export function projectNote(site, existing) {
  if (!site.sections.length) return 'The project is empty: nothing has been built yet.';
  const lines = site.sections.map((id) => `${id}: ${existing.has(id) ? 'built' : 'wireframe only'}`);
  return `The project "${site.title}" has these sections, in order:\n${lines.join('\n')}`;
}
