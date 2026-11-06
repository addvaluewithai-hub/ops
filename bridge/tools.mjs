// What SLOP can do, as Gemini Live function declarations (live.mjs turns them into Gemini's
// shape). None of them block: the bridge answers at once and sends the outcome later as a note.
import { SECTION_ID, STEPS } from './site.mjs';

export const MOODS = ['smug', 'deadpan', 'bored', 'suspicious', 'contempt', 'thinking', 'angry', 'furious', 'surprised', 'pleased', 'calm'];
export const GESTURES = ['eyeroll', 'glance', 'slowblink', 'squint', 'doubletake', 'wide'];

export const TOOLS = [
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
      'at once; you are told when it is done. Refused without a real brief.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: '"design", "structure", "scripts" or a section id' },
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

export const buildKey = (key) => STEPS.has(key) || SECTION_ID.test(String(key));

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
  if (key === 'design')
    return `Design task. Write tokens.css: the complete design system this site will use. Follow the "Design task" rules in your brief (the required variable names, fonts via @import, base element styles). Also set "title" in site.json to the site's name (keep any other fields). Nothing else.\n\nBrief: ${brief}`;
  if (key === 'structure' || key === 'site')
    return `Structure task. Write site.json (the title, the ordered section ids, and "plan": one line per section saying what goes in it and its one bold idea), then a wireframe for every section in sections/<id>.html, following the "Structure task" rules in your brief (the wf- primitives, data-wire, real proportions). Read tokens.css first.\n\nBrief: ${brief}`;
  if (key === 'scripts')
    return `Write scripts.js: the scroll choreography that joins the existing sections (GSAP and ScrollTrigger are globals). Read tokens.css and every sections/*.html first. Keep it tasteful and respect prefers-reduced-motion.\n\nBrief: ${brief}`;
  return `Build or update sections/${key}.html. Read tokens.css and site.json first (its plan line for ${key}), and the current sections/${key}.html if it exists. One <section id="${key}"> with its scoped <style>. Use <img data-gen="..."> for any picture, always with a fixed aspect-ratio in CSS.\n\nBrief: ${brief}`;
}

/** What the session's system instruction says about the project right now. */
export function projectNote(site, existing, hasDesign) {
  if (!hasDesign && !site.sections.length) return 'The project is empty: nothing has been built yet. Start with the spec, then "design".';
  const lines = site.sections.map((id) => `${id}: ${existing.has(id) ? 'built' : 'wireframe only'}${site.plan[id] ? ` (plan: ${site.plan[id]})` : ''}`);
  return `${hasDesign ? 'The design system exists.' : 'There is no design system yet.'} ${
    site.sections.length ? `The project "${site.title}" has these sections, in order:\n${lines.join('\n')}` : 'There is no structure yet.'
  }`;
}
