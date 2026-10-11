/**
 * « Décrire » une image (prompt inversé) : JoyCaption, en local dans ComfyUI, écrit un prompt anglais à partir
 * d'une photo (lieu, tenue, pose, lumière, cadrage), pour faire vivre la scène à un personnage.
 * L'identité de la personne photographiée (origine, traits) n'est pas décrite : c'est le personnage qui la remplace.
 *
 * Nœud https://github.com/1038lab/ComfyUI-JoyCaption, modèle JoyCaption Beta One (~16 Go, dans `models/LLM`),
 * chargé en 4 bits : ~40 s pour la première description (chargement compris) sur RTX 3060, libéré ensuite.
 */
import { readFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db/index.js';
import { assets } from '../db/schema.js';
import { hasNodes, isComfyRunning, queuePrompt, uploadImage, waitForText } from './comfy.service.js';
import { extFor } from './storage.service.js';
import { unloadVoice } from './voice.service.js';

const OUTPUT_NODE = '4';

export async function describeImage(userId: string, assetId: string): Promise<string> {
  const [asset] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, assetId), eq(assets.userId, userId)))
    .limit(1);
  if (!asset) throw new HTTPException(404, { message: 'Image introuvable.' });
  if (asset.mediaType !== 'image') throw new HTTPException(400, { message: 'Seule une image peut être décrite.' });
  if (!(await isComfyRunning())) throw new HTTPException(503, { message: 'Démarre ComfyUI pour décrire une image.' });
  if (!(await hasNodes(['JC', 'JC_ExtraOptions']))) {
    throw new HTTPException(400, { message: 'Nœud JoyCaption absent de ComfyUI (ComfyUI-JoyCaption).' });
  }

  const image = await uploadImage(await readFile(asset.filePath), `ai-fluence-${asset.id}.${extFor(asset.mime)}`, asset.mime);
  await unloadVoice();
  const promptId = await queuePrompt({
    '1': { class_type: 'LoadImage', inputs: { image } },
    '2': {
      class_type: 'JC_ExtraOptions',
      inputs: {
        exclude_people_info: true,
        include_lighting: true,
        include_camera_angle: true,
        include_camera_shot_type: true,
        avoid_meta_descriptive_phrases: true,
        exclude_image_resolution: true,
        include_watermark: false,
        include_JPEG_artifacts: false,
        include_exif: false,
        exclude_sexual: false,
        include_aesthetic_quality: false,
        include_composition_style: false,
        exclude_text: false,
        specify_depth_field: false,
        specify_lighting_sources: false,
        do_not_use_ambiguous_language: false,
        include_nsfw: false,
        only_describe_most_important_elements: false,
        do_not_include_artist_name_or_title: false,
        identify_image_orientation: false,
        use_vulgar_slang_and_profanity: false,
        do_not_use_polite_euphemisms: false,
        include_character_age: false,
        exclude_mood_feeling: false,
        include_camera_vantage_height: false,
        mention_watermark: false,
        refer_character_name: false,
        character_name: '',
      },
    },
    '3': {
      class_type: 'JC',
      inputs: {
        image: ['1', 0],
        model: 'joycaption-beta-one',
        quantization: 'Maximum Savings (4-bit)',
        prompt_style: 'Descriptive',
        caption_length: 'long',
        // Libéré après chaque description : la VRAM reste aux modèles d'image et de vidéo.
        memory_management: 'Clear After Run',
        extra_options: ['2', 0],
      },
    },
    [OUTPUT_NODE]: { class_type: 'PreviewAny', inputs: { source: ['3', 0] } },
  });
  return waitForText(promptId, OUTPUT_NODE);
}
