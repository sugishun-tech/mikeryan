"""Profile-editor regression tests with native browser ES modules and DOM.

Run: python tests/browser_profile.py
Requires playwright and Chromium. No server, real account or relay is used.
Relative imports are mapped to Blob URLs; only asset/import.meta URLs are
adapted for the empty-document test origin. Module strict mode is unchanged.
The actual ProfileView button, editor, CSS and browser form controls run here.
Repository/social services are test doubles; browser_offline.py covers signing.
"""
import asyncio
import base64
import json
import os
import shutil
from pathlib import Path
from playwright.async_api import async_playwright
from browser_offline import html

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests' / 'output'

LOAD_MODULES = r'''async ({sources, avatar}) => {
  const urls = new Map();
  const base = 'https://offline.example/mikeryan/';
  function load(file) {
    if (urls.has(file)) return urls.get(file);
    let source = sources[file];
    if (source === undefined) throw Error('Missing test module: ' + file);
    source = source.replace(/import\.meta\.url/g, JSON.stringify(base + file));
    if (file === 'js/core/config.js') {
      source = source.replace(/^export const FALLBACK_ICON = .*;$/m,
        'export const FALLBACK_ICON = ' + JSON.stringify(avatar) + ';');
    }
    source = source.replace(/(from\s+)(['"])(\.[^'"]+)\2/g,
      (_, prefix, quote, relative) => {
        const target = new URL(relative, base + file).pathname.slice('/mikeryan/'.length);
        return prefix + JSON.stringify(load(target));
      });
    const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
    urls.set(file, url);
    return url;
  }
  window.__profile = await import(load('js/profiles/view.js'));
  window.__dom = await import(load('js/ui/dom.js'));
}'''

SETUP = r'''async () => {
  const pubkey = 'a'.repeat(64);
  const route = {view: 'profile', pubkey, tab: 'relays'};
  window.__state = {
    profile: {display_name: '編集テスト', name: 'test', about: '元の自己紹介\n二行目です。',
      picture: '', banner: '', nip05: '', website: 'https://example.com', lud16: ''},
    reads: 0, saves: [], renders: 0, mode: 'ok'
  };
  const state = window.__state;
  const app = {
    session: {pubkey}, settings: {value: {loadImages: false}}, router: {route},
    repo: {profile: async () => {state.reads++; return {...state.profile};}},
    identity: {mount: () => window.__dom.el('span', {}, state.profile.display_name)},
    social: {
      relays: async () => [],
      editProfile: async fields => {
        state.saves.push({...fields});
        if (state.mode === 'reject') throw Error('テスト用の署名拒否');
        if (state.mode === 'pending') await new Promise(resolve => {window.__finishSave = resolve;});
        state.profile = {...fields};
      }
    },
    render: async current => {
      state.renders++;
      await new window.__profile.ProfileView(app, current, document.getElementById('view')).init();
    }
  };
  window.__app = app;
  await app.render(route);
}'''


async def main():
    checks, errors, requests = [], [], []
    def ok(name, condition=True):
        if not condition:
            raise AssertionError(name)
        checks.append(name)
        print('PASS:', name, flush=True)

    sources = {p.relative_to(ROOT).as_posix(): p.read_text() for p in (ROOT / 'js').rglob('*.js')}
    avatar = 'data:image/svg+xml;base64,' + base64.b64encode((ROOT / 'assets/icons/avatar.svg').read_bytes()).decode()
    OUT.mkdir(exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
            headless=True, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1440, 'height': 1050}, locale='ja-JP')
        page.set_default_timeout(6000)
        page.on('pageerror', lambda error: errors.append(str(error)))
        async def block(route):
            requests.append(route.request.url)
            await route.abort()
        await page.route('**/*', block)
        await page.set_content(html())
        await page.evaluate(LOAD_MODULES, {'sources': sources, 'avatar': avatar})
        ok('Native ES-module strict mode rejects writes to textarea.type', await page.evaluate(r'''() => {
          try {window.__dom.el('textarea', {type: 'text'}); return false;}
          catch (error) {return error instanceof TypeError;}
        }'''))
        await page.evaluate(SETUP)
        edit = page.get_by_role('button', name='プロフィールを編集', exact=True)
        await edit.click()
        dialog = page.locator('dialog[data-profile-editor]')
        await dialog.wait_for(state='visible')
        ok('Actual profile button opens a populated native modal',
           await dialog.get_by_label('自己紹介', exact=True).input_value() == '元の自己紹介\n二行目です。'
           and await dialog.locator('input').count() == 7
           and await dialog.locator('textarea').count() == 1
           and await dialog.get_attribute('open') is not None)
        ok('Opening the editor does not call read/save services', await page.evaluate('__state.reads === 1 && __state.saves.length === 0'))
        await page.evaluate('__profile.editProfileDialog(__app, __state.profile)')
        ok('Repeated opening reuses one modal', await dialog.count() == 1)
        await dialog.get_by_label('自己紹介', exact=True).fill('保存しない変更')
        await dialog.get_by_role('button', name='閉じる', exact=True).click()
        await dialog.wait_for(state='detached')
        await edit.click()
        ok('Close discards unsaved edits and reopening works',
           await dialog.get_by_label('自己紹介', exact=True).input_value() == '元の自己紹介\n二行目です。')
        await page.keyboard.press('Escape')
        await dialog.wait_for(state='detached')
        ok('Escape closes without saving', await page.evaluate('__state.saves.length === 0'))
        await edit.click()
        await dialog.get_by_label('表示名', exact=True).fill('更新した表示名')
        await dialog.get_by_label('自己紹介', exact=True).fill('変更した自己紹介\n改行も維持')
        await page.evaluate('__state.mode = "reject"')
        await dialog.get_by_role('button', name='保存する', exact=True).click()
        await dialog.locator('[role="alert"]:not([hidden])').wait_for(state='visible')
        ok('Rejected save displays an error inside the open modal and retains edits',
           await dialog.is_visible()
           and await dialog.get_by_label('自己紹介', exact=True).input_value() == '変更した自己紹介\n改行も維持'
           and await dialog.locator('[role="alert"]').inner_text() == 'テスト用の署名拒否'
           and await dialog.get_by_role('button', name='保存する', exact=True).is_enabled())
        await page.evaluate('__state.mode = "ok"')
        await dialog.get_by_label('表示名', exact=True).press('Enter')
        await dialog.wait_for(state='detached')
        ok('Enter submits once and redraws the saved profile', await page.evaluate(r'''
          __state.saves.length === 2 && __state.renders === 2
          && __state.profile.display_name === '更新した表示名'
          && __state.profile.about === '変更した自己紹介\n改行も維持'
        '''))
        await edit.click()
        await dialog.get_by_label('ウェブサイト', exact=True).fill('not a URL')
        await dialog.get_by_role('button', name='保存する', exact=True).click()
        ok('Invalid URL blocks saving without dismissing the form',
           await page.evaluate('__state.saves.length === 2') and await dialog.is_visible())
        await dialog.get_by_label('ウェブサイト', exact=True).fill('https://example.com/updated')
        await page.evaluate('__state.mode = "pending"')
        await dialog.get_by_role('button', name='保存する', exact=True).click()
        await page.wait_for_function('__state.saves.length === 3 && typeof __finishSave === "function"')
        await dialog.locator('form').evaluate("form => {for(let i=0;i<3;i++) form.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}));}")
        await page.keyboard.press('Escape')
        ok('Pending save blocks duplicate submits, edits and accidental dismissal',
           await page.evaluate('__state.saves.length === 3') and await dialog.is_visible()
           and await dialog.get_by_label('自己紹介', exact=True).is_disabled()
           and await dialog.get_by_role('button', name='閉じる', exact=True).is_disabled())
        await page.evaluate('__finishSave()')
        await dialog.wait_for(state='detached')
        await edit.click()
        ok('Saved values are populated again after a successful retry',
           await dialog.get_by_label('ウェブサイト', exact=True).input_value() == 'https://example.com/updated')
        await page.screenshot(path=str(OUT / 'profile-editor-desktop.png'))
        await page.set_viewport_size({'width': 390, 'height': 844})
        await dialog.get_by_label('表示名', exact=True).focus()
        await page.screenshot(path=str(OUT / 'profile-editor-mobile.png'))
        ok('Mobile editor fits the viewport and can scroll to Save', await page.evaluate(r'''() => {
          const d = document.querySelector('dialog'); const box = d.getBoundingClientRect();
          d.querySelector('[type="submit"]').scrollIntoView({block:'nearest'});
          const save = d.querySelector('[type="submit"]').getBoundingClientRect();
          return document.documentElement.scrollWidth <= innerWidth && box.left >= 0
            && box.right <= innerWidth && save.top >= 0 && save.bottom <= innerHeight;
        }'''))
        await dialog.get_by_role('button', name='閉じる', exact=True).click()
        await dialog.wait_for(state='detached')
        ok('UI and documentation omit promotional headings', all(
            phrase not in (ROOT / path).read_text()
            for path in ['index.html', 'docs/index.html']
            for phrase in ['会話を、ひとつの場所に。', 'あなたのペースで', '通信をコンパクトに', 'プロフィールも、タイムラインも。', 'ONE SITE. LESS TRAFFIC.']))
        ok('No unexpected browser errors or HTTP requests', not errors and not requests)
        results = {'checks': checks, 'passed': len(checks), 'errors': errors, 'http_requests': requests,
                   'browser': browser.version, 'module_execution': 'native ES modules via Blob URLs',
                   'services': 'repository/social test doubles; no account or relay writes'}
        (OUT / 'profile-editor-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
        await browser.close()
    print(f'RESULT: {len(checks)} native-module profile checks passed')


if __name__ == '__main__':
    asyncio.run(main())
