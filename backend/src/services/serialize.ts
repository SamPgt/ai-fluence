import type { Asset, Generation, Persona, Place, Thread } from '@ai-fluence/shared';
import type { assets, generations, personas, places, threads } from '../db/schema.js';

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
    isMaster: row.isMaster,
    generationId: row.generationId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPersona(row: PersonaRow, referenceCount = 0): Persona {
  return {
    id: row.id,
    name: row.name,
    gender: row.gender ?? null,
    identity: row.identity,
    color: row.color,
    avatarAssetId: row.avatarAssetId,
    avatarUrl: row.avatarAssetId ? mediaUrl(row.avatarAssetId) : null,
    contextBlocks: row.contextBlocks,
    // Données antérieures aux mots déclencheurs par LoRA : liste vide par défaut.
    loras: row.loras.map(l => ({ ...l, triggerWords: l.triggerWords ?? [] })),
    defaultImageFamily: row.defaultImageFamily,
    defaultVideoFamily: row.defaultVideoFamily,
    referenceCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toPlace(row: typeof places.$inferSelect, personaIds: string[] = [], masterCount = 0): Place {
  return {
    id: row.id,
    name: row.name,
    identity: row.identity,
    avatarAssetId: row.avatarAssetId,
    avatarUrl: row.avatarAssetId ? mediaUrl(row.avatarAssetId) : null,
    defaultImageFamily: row.defaultImageFamily,
    personaIds,
    masterCount,
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

export function toGeneration(row: GenerationRow, references: Asset[], outputs: Asset[], face: Asset | null = null): Generation {
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
    face,
    traits: row.traits,
    variation: row.variation ?? null,
    batchId: row.batchId,
    batchIndex: row.batchIndex,
    contexts: row.contexts,
    loras: row.loras,
    lorasApplied: row.lorasApplied,
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    estimatedCost: row.estimatedCost,
    cost: row.cost,
    settled: row.settled,
    seed: row.seed,
    durationMs: row.durationMs,
    outputs,
    runtime: row.provider,
    spicyTaskId: row.spicyTaskId,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
