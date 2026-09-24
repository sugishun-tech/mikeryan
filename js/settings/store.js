import { DEFAULTS, LIMITS } from '../core/config.js?v=1.1.0';
import { local } from '../core/storage.js?v=1.1.0';
import { Emitter, lines, normalizeRelay, parseJSON, unique, isHex } from '../core/utils.js?v=1.1.0';
const array = (v, fallback = []) => Array.isArray(v) ? v : fallback;
export function validateSettings(input) {
  const merged = { ...DEFAULTS, ...input };
  const relays = unique(array(merged.relays).map(normalizeRelay).filter(Boolean));
  if (!relays.length || relays.length > LIMITS.relays) throw new Error(`有効なリレーを1〜${LIMITS.relays}件指定してください（通常は2件で十分です）`);
  const result = {
    relays,
    batchSize: 30,
    readRelayCount: Math.max(1, Math.min(relays.length, Math.floor(Number(merged.readRelayCount) || 2))),
    requestGapMs: Math.max(800, Math.min(10000, Math.floor(Number(merged.requestGapMs) || 1200))),
    muteDisplayNamePatterns: array(merged.muteDisplayNamePatterns).map(String),
    muteContentPatterns: array(merged.muteContentPatterns).map(String),
    mutedPubkeys: unique(array(merged.mutedPubkeys).map(x => String(x).trim().toLowerCase())),
    hideIncompleteProfiles: Boolean(merged.hideIncompleteProfiles),
    loadImages: Boolean(merged.loadImages),
    verifyNip05: Boolean(merged.verifyNip05),
    theme: ['light', 'dark', 'auto'].includes(merged.theme) ? merged.theme : 'light'
  };
  if (!result.mutedPubkeys.every(isHex)) throw new Error('ミュート公開鍵は64桁のhexで指定してください');
  for (const pattern of [...result.muteDisplayNamePatterns, ...result.muteContentPatterns]) {
    if (pattern.length > 512) throw new Error('ミュート正規表現は512文字以内にしてください');
    try { new RegExp(pattern, 'i'); } catch { throw new Error(`ミュート正規表現が不正です: ${pattern}`); }
  }
  if (result.muteDisplayNamePatterns.length + result.muteContentPatterns.length > 100) throw new Error('ミュート正規表現は合計100件までです');
  return result;
}
function legacySettings() {
  try {
    const oldRelays = lines(localStorage.getItem('nostr_relays'));
    const profileRelays = parseJSON(localStorage.getItem('nostr_profile_viewer_relays'), []);
    if (!oldRelays.length && !profileRelays.length && !localStorage.getItem('nostr_batch_size')) return null;
    return {
      ...DEFAULTS, relays: unique([...oldRelays, ...array(profileRelays)]).filter(normalizeRelay),
      batchSize: Number(localStorage.getItem('nostr_batch_size')) || 30,
      muteDisplayNamePatterns: lines(localStorage.getItem('nostr_mute_display_name_patterns')),
      muteContentPatterns: localStorage.getItem('nostr_mute_content_patterns') !== null ? lines(localStorage.getItem('nostr_mute_content_patterns')) : DEFAULTS.muteContentPatterns,
      mutedPubkeys: lines(localStorage.getItem('nostr_muted_pubkeys'))
    };
  } catch { return null; }
}
export class Settings extends Emitter {
  constructor() { super(); this.value = validateSettings(DEFAULTS); this.migrated = false; }
  async load() {
    let value = parseJSON(local.get('settings'));
    if (!value) { value = legacySettings(); this.migrated = !!value; }
    if (!value) {
      try { const res = await fetch(new URL('../../default.json', import.meta.url)); if (res.ok) value = { ...DEFAULTS, ...await res.json() }; } catch {}
    }
    try { this.value = validateSettings(value ?? DEFAULTS); } catch { this.value = validateSettings(DEFAULTS); }
    if (this.migrated) this.save(this.value);
    return this.value;
  }
  save(input) {
    const value = validateSettings(input);
    if (!local.set('settings', JSON.stringify(value))) throw new Error('設定を保存できません。ブラウザーのサイトデータ保存を許可してください');
    this.value = value; this.emit('change', value); return value;
  }
  reset() { return this.save(DEFAULTS); }
}
