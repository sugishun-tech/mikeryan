# Sources and notices

The original mynostr and mynostr_profile projects are by sugishun-tech.
Their MIT license is preserved in LICENSE. mikeryan is a modular rewrite.
No third-party JavaScript package or remote CDN script is bundled or loaded.

## BIP-340 test vectors

`tests/fixtures/bip340.json` reformats the public-key, message, signature and
expected-result columns from Bitcoin BIP-340's official test vectors. All 19
verification cases are included. Private-key and auxiliary-randomness columns
are intentionally omitted.

Source: https://github.com/bitcoin/bips/blob/master/bip-0340/test-vectors.csv
Specification: https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki
Authors: Pieter Wuille, Jonas Nick, Tim Ruffing.

The BIP-340 "Test Vectors and Reference Code" section offers the test vectors
under BSD-2-Clause, MIT, or CC0 1.0 at the recipient's choice. This distribution
uses the CC0 1.0 option for those test-vector data only.
https://creativecommons.org/publicdomain/zero/1.0/

The application verifier and NIP-19 codec are independently written from the
published equations and format. The Python fixture signer is test-only code
using cryptography/OpenSSL for point generation; it is not in the public build.
Do not use the deterministic example accounts for real messages or funds.

## Protocol and deployment references

- NIP-01: https://github.com/nostr-protocol/nips/blob/master/01.md
- NIP-05: https://github.com/nostr-protocol/nips/blob/master/05.md
- NIP-07: https://github.com/nostr-protocol/nips/blob/master/07.md
- NIP-10: https://github.com/nostr-protocol/nips/blob/master/10.md
- NIP-19: https://github.com/nostr-protocol/nips/blob/master/19.md
- NIP-42: https://github.com/nostr-protocol/nips/blob/master/42.md
- NIP-65: https://github.com/nostr-protocol/nips/blob/master/65.md
- Bech32: https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
- Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Pages workflow template: https://github.com/actions/starter-workflows/blob/main/pages/static.yml

Reviewed when preparing this package on 2026-09-24. The protocols and hosted
service rules can change; the app does not guarantee relay availability.
