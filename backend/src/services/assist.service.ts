/**
 * Aide à l'écriture des prompts, en local : dictée (Whisper, serveur de voix) puis reformulation (Ollama).
 *
 * On dit l'idée à voix haute (« elle boit de l'eau puis lui sourit ») ; le LLM la réécrit pour le modèle visé, avec
 * ses règles d'écriture (LTX : l'action pas à pas, les gestes, la caméra, les sons), en anglais pour le modèle et en
 * français pour la relire.
 */
import { HTTPException } from 'hono/http-exception';
import type { AssistStatus, RewritePromptRequest, RewritePromptResponse } from '@ai-fluence/shared';
import { env } from '../env.js';
import { freeComfyMemory, waitForVram } from './comfy.service.js';
import { chatJson, llmModel, llmState } from './llm.service.js';

/** Dictée et reformulation disponibles (serveur de voix configuré ; Ollama qui répond, avec un modèle). */
export async function assistStatus(): Promise<AssistStatus> {
  const model = await llmModel();
  return { dictation: Boolean(env.VOICE_URL), rewrite: Boolean(model), model };
}

// ── Règles d'écriture par modèle ──────────────────────────────
//
// Le personnage est ajouté à part à chaque génération (ou donné par l'image jointe) : le prompt ne décrit jamais
// son apparence, sauf ce que l'utilisateur demande de changer.

const VIDEO_LTX = [
  'Target: LTX-2.3, a video model that also generates the sound. The prompt describes one continuous shot, like a short film scene.',
  'Write one flowing paragraph in the present tense, 60 to 150 words, in this order:',
  '- the shot (close-up, medium shot, wide shot…) and the light;',
  '- the action step by step, in chronological order, with concrete physical movements: hands, head, gaze, posture, objects handled (“she lifts the glass to her lips, takes a slow sip, then sets it down”);',
  '- emotions shown by the body and the face (a soft smile, raised eyebrows, a relaxed shoulder drop), never named abstractly;',
  '- what the camera does (static, slowly pushes in, follows her, handheld);',
  '- the sounds (ambient noise, the clink of the glass, footsteps).',
  'Fill the gaps the user left with natural, plausible in-between gestures, so the motion flows, but never add new events or characters.',
  'Do not write any dialogue or quoted words: the spoken text, if any, is set elsewhere. If the user wants her to talk, write that she talks to the camera.',
];
const VIDEO_WAN = [
  'Target: Wan 2.2, an image-to-video model (no sound). The prompt describes the motion of a 5-second clip.',
  'Write one paragraph in the present tense, 40 to 90 words: the action step by step with concrete movements, the facial expression, then the camera movement.',
  'Fill the gaps with natural in-between gestures, but never add new events or characters.',
];
const IMAGE_TEXT = [
  'Target: a photorealistic text-to-image model. The prompt describes one photo.',
  'Write one paragraph, 40 to 90 words, natural sentences: what the person is doing and the pose, the place, the light, the framing and the photo look (candid handheld shot, 35mm, shallow depth of field…).',
  'Concrete and visual only; no quality tags or keyword lists.',
  // Vu en test : nommer l'appareil (« smartphone photo ») fait apparaître un téléphone dans l'image.
  'Never name a camera device (phone, smartphone, iPhone) unless the user wants one in the picture: describe the look instead.',
  // La tenue vient des choix du composer (Tenue), ajoutés à part.
  'Do not invent clothing: mention it only if the user does.',
];
const IMAGE_EDIT = [
  'Target: an image editing model that receives the attached images. The prompt is an instruction about those images.',
  'Refer to attached images as “image 1”, “image 2”… in the order given. Say clearly what changes and what must stay the same (identity, face, outfit, background).',
  'Write 1 to 4 short sentences, 20 to 70 words.',
];

function guideFor(req: RewritePromptRequest): string[] {
  const family = req.familyId ?? '';
  if (req.media === 'video') return /wan/i.test(family) ? VIDEO_WAN : VIDEO_LTX;
  return req.attachments > 0 && /klein|edit|kontext|nano|seedream/i.test(family) ? IMAGE_EDIT : IMAGE_TEXT;
}

const SUBJECT: Record<string, string> = { female: 'a woman (she)', male: 'a man (he)' };

function systemPrompt(req: RewritePromptRequest): string {
  const subject = SUBJECT[req.gender ?? ''] ?? 'a person';
  return [
    'You turn a short spoken idea (often French, dictated, possibly with transcription mistakes) into the best possible prompt for an AI generation model.',
    ...guideFor(req),
    `The main character is ${subject}. Her or his appearance (face, hair, body) is provided separately: never describe it, unless the user asks to change it.`,
    req.media === 'video' && req.attachments > 0
      ? 'The video starts from the attached image: the person, outfit and place are already there. Do not describe them again; focus on what happens.'
      : '',
    'Keep every explicit detail from the user; fix obvious dictation mistakes.',
    'Answer in JSON: "en" is the prompt in English, sent to the model; "fr" is the same prompt translated into natural French, for the user to read.',
  ]
    .filter(Boolean)
    .join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: { en: { type: 'string' }, fr: { type: 'string' } },
  required: ['en', 'fr'],
};

/** Reformule l'idée de l'utilisateur pour le modèle choisi (Ollama, local). */
export async function rewritePrompt(req: RewritePromptRequest): Promise<RewritePromptResponse> {
  const model = await llmModel();
  if (!model) throw new HTTPException(503, { message: 'Ollama ne répond pas (OLLAMA_URL), ou aucun modèle n’est installé.' });
  // La carte pour le LLM, avant qu'Ollama le charge : les modèles de ComfyUI en sortent (ils restent en RAM), s'il ne
  // génère rien. Déjà chargé : rien à faire.
  const state = await llmState(model);
  if (!state.loaded) {
    await freeComfyMemory({ ram: false }).catch(() => undefined);
    await waitForVram(state.size).catch(() => undefined);
  }
  const lines = [
    req.modelLabel ? `Model: ${req.modelLabel}.` : '',
    req.attachments > 0 ? `Attached images: ${req.attachments}.` : '',
    `Idea: ${req.text}`,
  ].filter(Boolean);
  const started = Date.now();
  const out = await chatJson<{ en?: string; fr?: string }>(model, systemPrompt(req), lines.join('\n'), SCHEMA).catch(err => {
    throw new HTTPException(502, { message: (err as Error).message });
  });
  const en = out.en?.trim();
  if (!en) throw new HTTPException(502, { message: 'Le modèle n’a rien renvoyé.' });
  console.info(`[assist] reformulation par ${model} en ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return { en, fr: out.fr?.trim() ?? '', model };
}
