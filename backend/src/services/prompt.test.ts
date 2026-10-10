import { describe, expect, it } from 'vitest';
import { EDIT_INSTRUCTION, assemblePrompt } from './prompt.js';

const empty = { triggers: [], contexts: [], blocks: [] };

describe('assemblePrompt', () => {
  it('prompt seul : envoyé tel quel, sans titre', () => {
    expect(assemblePrompt({ ...empty, prompt: '  une pomme  ' })).toBe('une pomme');
  });

  it('Éditer : consigne en anglais juste après la demande', () => {
    const out = assemblePrompt({ ...empty, prompt: 'change le fond', editFirstImage: true });
    expect(out).toBe(`# Prompt (important)\nchange le fond\n\n# Images\n${EDIT_INSTRUCTION}`);
  });

  it('ordre : LoRA, demande, consigne, raccourcis, contexte du persona', () => {
    const out = assemblePrompt({
      prompt: 'portrait',
      triggers: ['ohwx', 'woman'],
      contexts: [
        { label: 'Lumière', text: 'douce\n  et   chaude' },
        { label: '', text: 'grain fin' },
        { label: 'Vide', text: '   ' },
      ],
      blocks: [
        { title: 'Visage', text: 'yeux verts' },
        { title: '', text: 'cheveux roux' },
      ],
      editFirstImage: true,
    });
    expect(out.split('\n\n').map(s => s.split('\n')[0])).toEqual([
      '# Lora',
      '# Prompt (important)',
      '# Images',
      '# Détails',
      '# Contexte général',
    ]);
    expect(out).toContain('# Lora\nohwx, woman');
    expect(out).toContain('# Détails\nLumière : douce et chaude\ngrain fin');
    expect(out).not.toContain('Vide');
    expect(out).toContain('# Contexte général\n- Visage : yeux verts\n- cheveux roux');
  });

  it('sans édition : pas de section Images', () => {
    expect(assemblePrompt({ ...empty, prompt: 'x', triggers: ['ohwx'] })).not.toContain('# Images');
  });
});
