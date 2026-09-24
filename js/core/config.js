export const APP_NAME = 'mikeryan';
export const VERSION = '1.1.1';
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
export const OUTBOX_RETENTION = 7 * 24 * 3600000;
export const LIMITS = Object.freeze({
  filters: 20, authors: 100, page: 30, relays: 12, sessionProfiles: 2000,
  eventBytes: 262144, frameBytes: 524288, tags: 10000,
  requestTimeout: 10000, connectionTimeout: 6000, publishTimeout: 10000,
  idleTimeout: 120000, maxPageLimit: 1600, upwardQueries: 6
});
export const FALLBACK_ICON = new URL('../../assets/icons/avatar.svg', import.meta.url).href;
export const storagePrefix = () => `mikeryan:v1:${new URL('../../', import.meta.url).pathname}:`;
