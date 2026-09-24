export const APP_NAME = 'mikeryan';
export const VERSION = '1.0.1';
export const DEFAULTS = Object.freeze({
  relays: ['wss://relay-jp.nostr.wirednet.jp/', 'wss://yabu.me/'],
  batchSize: 30,
  readRelayCount: 2,
  requestGapMs: 1200,
  muteDisplayNamePatterns: [],
  muteContentPatterns: ['https', 'nostr\\:', '#', '^[^ぁ-ゖァ-ヶ]*$'],
  mutedPubkeys: [],
  hideIncompleteProfiles: true,
  loadImages: true,
  verifyNip05: true,
  theme: 'light'
});
export const TTL = Object.freeze({
  profile: 6 * 3600000, list: 5 * 60000, absent: 10 * 60000,
  feed: 60000, query: 30000, nip05: 24 * 3600000, nip05Failure: 15 * 60000,
  event: 7 * 24 * 3600000
});
export const LIMITS = Object.freeze({
  filters: 20, authors: 100, page: 200, relays: 12,
  eventBytes: 262144, frameBytes: 524288, tags: 10000,
  requestTimeout: 10000, connectionTimeout: 6000, publishTimeout: 10000,
  idleTimeout: 120000, maxRecords: 6000, maxPageLimit: 1600
});
export const FALLBACK_ICON = new URL('../../assets/icons/avatar.svg', import.meta.url).href;
export const storagePrefix = () => `mikeryan:v1:${new URL('../../', import.meta.url).pathname}:`;
