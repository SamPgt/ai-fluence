import type { Asset, Generation, Persona, Thread } from '@ai-fluence/shared';
import type { assets, generations, personas, threads } from '../db/schema.js';

type AssetRow = typeof assets.$inferSelect;
type PersonaRow = typeof personas.$inferSelect;
type ThreadRow = typeof threads.$inferSelect;
type GenerationRow = typeof generations.$inferSelect;

export function mediaUrl(assetId: string): string {
  return `/api/media/${assetId}`;
}

export function toAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    kind: row.kind,
    mediaType: row.mediaType,
    mime: row.mime,
    url: mediaUrl(row.id),
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    personaId: row.personaId,
    isReference: row.isReference,
    generationId: row.generationId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPersona(row: PersonaRow, referenceCount = 0): Persona {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    avatarAssetId: row.avatarAssetId,
    avatarUrl: row.avatarAssetId ? mediaUrl(row.avatarAssetId) : null,
    description: row.description,
    personality: row.personality,
    promptSuffix: row.promptSuffix,
    triggerWord: row.triggerWord,
    loras: row.loras,
    defaultImageFamily: row.defaultImageFamily,
    defaultVideoFamily: row.defaultVideoFamily,
    referenceCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toThread(
  row: ThreadRow,
  agg: { totalCost?: string | null; generationCount?: number; coverAssetId?: string | null } = {},
): Thread {
  return {
    id: row.id,
    title: row.title,
    personaId: row.personaId,
    isPinned: row.isPinned,
    totalCost: agg.totalCost ?? '0',
    generationCount: agg.generationCount ?? 0,
    coverUrl: agg.coverAssetId ? mediaUrl(agg.coverAssetId) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toGeneration(row: GenerationRow, references: Asset[], outputs: Asset[]): Generation {
  return {
    id: row.id,
    threadId: row.threadId,
    personaId: row.personaId,
    prompt: row.prompt,
    finalPrompt: row.finalPrompt,
    family: row.family,
    modelId: row.modelId,
    task: row.task,
    params: row.params,
    refMode: row.refMode,
    references,
    lorasApplied: row.lorasApplied,
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    estimatedCost: row.estimatedCost,
    cost: row.cost,
    settled: row.settled,
    seed: row.seed,
    outputs,
    spicyTaskId: row.spicyTaskId,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
