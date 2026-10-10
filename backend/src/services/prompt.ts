/**
 * Prompt réellement envoyé au modèle (`finalPrompt`), structuré par ordre
 * d'importance : la LoRA d'abord (le mot déclencheur agit mieux en tête), puis
 * la demande, la consigne d'édition, les raccourcis et le contexte général.
 */

export const EDIT_INSTRUCTION = 'Edit image 1: it is the image to modify. Any other images are references only.';

export interface PromptParts {
  prompt: string;
  /** Mots déclencheurs des LoRA cochées (déjà filtrés). */
  triggers: string[];
  /** Raccourcis activés. */
  contexts: { label: string; text: string }[];
  /** Contexte du persona, en lignes étiquetées. */
  blocks: { title: string; text: string }[];
  /** « Éditer » : la première image est celle à modifier. */
  editFirstImage?: boolean;
}

const oneLine = (t: string) => t.trim().replace(/\s+/g, ' ');

export function assemblePrompt(p: PromptParts): string {
  const sections: [string, string][] = [
    ['Lora', p.triggers.join(', ')],
    ['Prompt (important)', p.prompt.trim()],
    // En anglais, mieux suivi par les modèles ; jamais affiché dans la bulle.
    ['Images', p.editFirstImage ? EDIT_INSTRUCTION : ''],
    [
      'Détails',
      p.contexts
        .filter(c => c.text.trim())
        .map(c => `${c.label.trim() ? `${c.label.trim()} : ` : ''}${oneLine(c.text)}`)
        .join('\n'),
    ],
    [
      'Contexte général',
      p.blocks
        .filter(b => b.text.trim())
        .map(b => `- ${b.title.trim() ? `${b.title.trim()} : ` : ''}${oneLine(b.text)}`)
        .join('\n'),
    ],
  ];
  const filled = sections.filter(([, body]) => body);
  // Prompt seul : on l'envoie tel quel, sans titre.
  if (filled.length === 1 && filled[0][0] === 'Prompt (important)') return filled[0][1];
  return filled.map(([title, body]) => `# ${title}\n${body}`).join('\n\n');
}
