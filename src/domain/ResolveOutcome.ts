import type EmbedMetadata from '@/domain/EmbedMetadata';

type ResolveOutcome =
    | {
          status: 'ok';
          meta: EmbedMetadata;
          canonicalUrl: string;
          platform: string;
          cacheHit: boolean;
      }
    | {status: 'no-adapter'}
    | {
          status: 'degraded';
          canonicalUrl: string;
          platform: string;
          reason: string;
      };

export default ResolveOutcome;
