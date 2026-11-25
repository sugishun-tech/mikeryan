import { parseMuteRule } from '../core/utils.js?v=1.3.5';
export class Moderation {
  constructor(settings, repository, session) { this.settings=settings; this.repo=repository; this.session=session; this.rebuild(); settings.on('change',()=>this.rebuild()); }
  rebuild() {
    const s=this.settings.value;
    const patterns=rules=>rules.map(rule=>{const {value,forced}=parseMuteRule(rule);return Object.assign(new RegExp(value,'i'),{forced});});
    this.names=patterns(s.muteDisplayNamePatterns);this.content=patterns(s.muteContentPatterns);
    const keys=s.mutedPubkeys.map(parseMuteRule);
    this.keys=new Set(keys.map(rule=>rule.value));this.forcedKeys=new Set(keys.filter(rule=>rule.forced).map(rule=>rule.value));
  }
  nip05Allowed(pubkey) { return this.settings.value.allowVerifiedNip05 && this.repo.verification(pubkey)?.state==='valid'; }
  pubkeyMuted(pubkey) {
    if(this.forcedKeys.has(pubkey))return true;
    if(this.nip05Allowed(pubkey))return false;
    const event=this.repo.replacements.get(`10000:${this.session.pubkey}`);
    if(this.muteEvent!==event){this.muteEvent=event;this.publicKeys=new Set((event?.tags??[]).filter(t=>t[0]==='p').map(t=>t[1]));}
    return this.keys.has(pubkey)||!!this.publicKeys?.has(pubkey);
  }
  muted(event, profile={}, { notification=false }={}) {
    // Forced rules override the NIP-05 exemption; notifications still bypass pattern rules.
    if(this.pubkeyMuted(event.pubkey))return true;
    if(notification)return false;
    const allowed=this.nip05Allowed(event.pubkey);
    if(this.content.some(r=>(!allowed||r.forced)&&r.test(event.content)))return true;
    if(this.names.some(r=>(!allowed||r.forced)&&(r.test(String(profile.name??''))||r.test(String(profile.display_name??'')))))return true;
    if(!allowed && this.settings.value.hideIncompleteProfiles && (!String(profile.name??'').trim()||!String(profile.display_name??'').trim()))return true;
    return false;
  }
}
