import { shardLoadProbability, type ShardKind } from './shard-planner';

export type PageProfileId = 'headline' | 'article' | 'longform';

export interface PageProfile {
  readonly id: PageProfileId;
  /** 页面正文字符数。 */
  readonly tokens: number;
}

const ARTICLE: PageProfile = { id: 'article', tokens: 1500 };

export const PAGE_PROFILES: readonly PageProfile[] = [
  { id: 'headline', tokens: 300 },
  ARTICLE,
  { id: 'longform', tokens: 6000 },
];

export function pageProfile(id: PageProfileId): PageProfile {
  return PAGE_PROFILES.find((profile) => profile.id === id) ?? ARTICLE;
}

export interface MeasuredShard {
  readonly kind: ShardKind;
  readonly mass: number;
  readonly bytes: number;
}

export interface ProfileMetrics {
  readonly id: PageProfileId;
  readonly tokens: number;
  readonly expectedRequests: number;
  readonly expectedBytes: number;
}

export interface PlanMetrics {
  readonly shardCount: number;
  readonly totalBytes: number;
  readonly profiles: readonly ProfileMetrics[];
}

export function evaluateShards(shards: readonly MeasuredShard[]): PlanMetrics {
  const totalBytes = shards.reduce((total, shard) => total + shard.bytes, 0);
  return {
    shardCount: shards.length,
    totalBytes,
    profiles: PAGE_PROFILES.map((profile) => {
      let expectedRequests = 0;
      let expectedBytes = 0;
      for (const shard of shards) {
        const probability = shardLoadProbability(shard, profile.tokens);
        expectedRequests += probability;
        expectedBytes += probability * shard.bytes;
      }
      return { id: profile.id, tokens: profile.tokens, expectedRequests, expectedBytes };
    }),
  };
}

export function profileMetrics(metrics: PlanMetrics, id: PageProfileId): ProfileMetrics {
  return (
    metrics.profiles.find((profile) => profile.id === id) ?? {
      id,
      tokens: pageProfile(id).tokens,
      expectedRequests: 0,
      expectedBytes: 0,
    }
  );
}
