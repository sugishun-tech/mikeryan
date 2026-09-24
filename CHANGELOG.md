# Changelog

## 1.0.1 (2026-09-24)

### Profile editor

- Fix the profile button failing before the dialog opens: `textarea.type` is
  read-only, and assigning to it throws in an ES module. Only `input` elements
  now receive a `type` property.
- Move the editor into `js/profiles/editor.js`. Keep the existing export from
  `profiles/view.js` and wrap the opening action in the normal error handler.
- Submit through the form handler, including Enter in a single-line field.
  Do not use `method="dialog"`, which can dismiss a form without saving it.
- Show rejected or failed saves inside the modal, preserve the entered values,
  and allow retrying. Disable duplicate submissions and dismissal during a save.
- Retain existing profile fields, signing and relay publication behavior.
  Opening the editor performs no additional relay query.

### Interface

- Remove the header slogan, the promotional sidebar card and footer slogan.
- Use a single-line header and the functional heading "通信状況".
- Remove promotional headings from the documentation and use a plain login prompt.
- Keep search, relay counters, settings, navigation and help links.

### Tests

- Correct the offline browser harness to preserve ES-module strict behavior.
  Its old non-strict transformation silently ignored the invalid property write,
  which is why the 1.0.0 profile-edit test did not catch this defect.
- Add `tests/browser_profile.py`: native ES modules loaded through local Blob
  URLs, native browser form controls and the actual ProfileView button. Only
  module/asset URLs and repository/social services are adapted for the test.
- Re-run 52 Node unit tests, 24 strict-mode offline browser checks and 14 native
  module/profile regression checks. All pass in Chromium.
- Real extensions, public relay acceptance, Firefox and production hosting remain
  unverified. No real account was accessed and no public event was published.

### Updating

Copy the contents of `mikeryan/` over the existing project and redeploy.
The changes-only archive contains changed/new files with the same directory
layout. It is not a standalone application. Neither archive deletes files.

The new `js/profiles/editor.js` must be deployed together with `view.js`.
`default.json`, relay settings, storage key prefixes and the login persistence
format are unchanged. Preserve any deployment-specific changes to `default.json`.
After deployment, reload the page without using the old cached scripts. Browser
storage does not need to be cleared.
