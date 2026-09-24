export class Moderation {
  constructor(settings, repository, session) { this.settings=settings; this.repo=repository; this.session=session; this.rebuild(); settings.on('change',()=>this.rebuild()); }
  rebuild() { const s=this.settings.value;this.names=s.muteDisplayNamePatterns.map(p=>new RegExp(p,'i'));this.content=s.muteContentPatterns.map(p=>new RegExp(p,'i'));this.keys=new Set(s.mutedPubkeys); }
  pubkeyMuted(pubkey) {
    const event=this.repo.replacements.get(`10000:${this.session.pubkey}`);
    if(this.muteEvent!==event){this.muteEvent=event;this.publicKeys=new Set((event?.tags??[]).filter(t=>t[0]==='p').map(t=>t[1]));}
    return this.keys.has(pubkey)||!!this.publicKeys?.has(pubkey);
  }
  muted(event, profile={}, { notification=false }={}) {
    // Preserve the original notification exemption, but always honor explicit public-key mutes.
    if(this.pubkeyMuted(event.pubkey))return true;
    if(notification)return false;
    if(this.content.some(r=>r.test(event.content)))return true;
    if(this.names.some(r=>r.test(String(profile.name??''))||r.test(String(profile.display_name??''))))return true;
    if(this.settings.value.hideIncompleteProfiles && (!String(profile.name??'').trim()||!String(profile.display_name??'').trim()))return true;
    return false;
  }
}
