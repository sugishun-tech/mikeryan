import { el, button, busy, field, toast } from '../ui/dom.js?v=1.2.3';

const PROFILE_FIELDS = {
  display_name: '表示名',
  name: 'ユーザー名',
  about: '自己紹介',
  picture: 'プロフィール画像URL',
  banner: 'カバー画像URL',
  nip05: 'NIP-05',
  website: 'ウェブサイト',
  lud16: 'Lightning Address'
};

export function editProfileDialog(app, profile = {}) {
  const existing = document.querySelector('dialog[data-profile-editor]');
  if (existing) return existing;

  const dialog = el('dialog', {
    class: 'edit-dialog',
    dataset: { profileEditor: '' },
    'aria-labelledby': 'profile-editor-title'
  });
  const context=app.social.sessionContext();
  const initial=Object.fromEntries(Object.keys(PROFILE_FIELDS).map(key=>[key,String(profile[key]??'')]));
  const form = el('form');
  const inputs = {};
  let saving = false;
  const close = button('閉じる', () => dialog.close(), 'text-button');
  form.append(el('div', { class: 'dialog-header' },
    el('h2', { id: 'profile-editor-title' }, 'プロフィールを編集'), close));

  for (const [key, label] of Object.entries(PROFILE_FIELDS)) {
    const common = { name: key, value: String(profile[key] ?? ''), autocomplete: 'off' };
    // HTMLTextAreaElement.type is read-only. Only input elements receive type.
    const input = key === 'about'
      ? el('textarea', { ...common, rows: 5, maxLength: 8000 })
      : el('input', {
          ...common,
          type: ['picture', 'banner', 'website'].includes(key) ? 'url' : 'text',
          maxLength: 1024
        });
    inputs[key] = input;
    form.append(field(label, input));
  }

  // An error must be inside the modal: a page-level toast sits below the top layer.
  const error = el('p', { class: 'form-error', role: 'alert', hidden: true });
  const save = button('保存する', null, 'button primary', { type: 'submit' });
  form.append(error, save);
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (saving || !form.reportValidity()) return;
    void busy(save, async () => {
      const fields = Object.fromEntries(Object.entries(inputs)
        .filter(([key,input])=>input.value!==initial[key]).map(([key,input])=>[key,input.value]));
      app.social.checkSession(context);
      if(!Object.keys(fields).length){dialog.close();return;}
      saving = true;
      close.disabled = true;
      save.textContent = '保存中…';
      for (const input of Object.values(inputs)) input.disabled = true;
      error.hidden = true;
      error.textContent = '';
      try {
        await app.social.editProfile(fields,context);
      } catch (cause) {
        error.textContent = cause?.message || 'プロフィールを保存できませんでした。';
        error.hidden = false;
        error.scrollIntoView({ block: 'nearest' });
        return;
      } finally {
        saving = false;
        close.disabled = false;
        save.textContent = '保存する';
        for (const input of Object.values(inputs)) input.disabled = false;
      }
      if(!dialog.isConnected)return;
      dialog.close();
      toast('プロフィールを更新しました');
      if(app.social.sameSession(context))await app.render(app.router.route);
    });
  });
  dialog.addEventListener('cancel', event => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.append(form);
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
