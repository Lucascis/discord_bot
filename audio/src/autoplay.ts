// Backwards-compatible re-exports for autoplay helpers split into modules
export { isBlockReason, ensurePlayback } from './autoplay/engine.js';
export { buildAutomixCandidates, pickAutomixTrack, normalizeTitle, type LLTrack, type SearchResult, type SearchFn } from './autoplay/recommendations.js';
export { seedRelatedQueue, type LLPlayer } from './autoplay/seeds.js';
