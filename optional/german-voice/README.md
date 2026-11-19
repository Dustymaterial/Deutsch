# Optional German voice package

This separately licensed package contains installation and storage code under GPL-3.0-or-later. It is not imported by the MIT application, has no enabled release, and does not provide production speech synthesis yet. Creating an installer never downloads anything. The checked-in `release.json` is deliberately rejected for installation.

`installation.mjs` accepts an independently reviewed release manifest. Installation requires an explicit consent flag, a secure browser with WebAssembly, Worker, AudioContext, CacheStorage, SubtleCrypto, Web Locks and abortable downloads, and enough estimated storage. Assets download sequentially with size bounds, SHA-256 checks and a two-minute per-asset deadline. Interrupted or invalid installations are removed. Only a complete installation receives a marker. Cached assets are read without a network fallback and are checked again before use. Removal touches only this package's caches. Browser storage can be evicted; a missing asset requires a new explicit download.

Release assets must be served from the application's origin under an immutable versioned `/optional-voice/releases/<version>/` path. Each manifest entry has a unique `role`, `path`, positive `bytes` and lowercase hexadecimal `sha256`. Required roles: `model`, `config`, `runtime`, `runtime-wasm`, `phonemizer`, `phonemizer-wasm`, `phonemizer-data`, `notices`, `source`, `build-recipe`, `model-card`. The combined release limit is 200 MiB, including source and notices. No release artifacts or model weights are bundled in the app.

Activation requires all five reviewed checks in the manifest: corresponding source, licenses, cold-start offline use, physical iOS and physical Android. These are maintainer attestations backed by release evidence, not capabilities inferred from a browser name. A manifest flag alone is not proof of a completed review. Device checks do not establish available memory or acceptable synthesis speed.

The separate desktop prototype used Thorsten medium (63,201,294-byte model; roughly 75 MB total asset transfer), VITS Web 1.0.3 and ONNX Runtime Web 1.18.0. It produced speech with networking disabled in a warm desktop browser. That does not verify a cold restart or phone compatibility. No prototype binary is distributed here. Its unpinned phonemizer build cannot currently be matched to complete corresponding source, so release checks remain false. Code executing inference must run in a disposable worker, reuse and release its ONNX session, take only explicitly requested study text and never make a speech-service request.

Human recording playback remains a separate path. It must not use this cache, and installing this package must not prefetch human recordings or transmit study text. Source and license details are in [NOTICE](NOTICE).

Run installation regression checks from the project root with `node --test tests/optionalVoice.test.mjs`.
