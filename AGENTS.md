# Repository guidance

## Project and compatibility

- This is MK-Anime-Attacks, a browser ES module for Foundry VTT. The stable package ID and installed folder name are `anime-attacks`; preserve them to retain settings and flags.
- The supported Foundry range is **v13 through v14**. Keep `compatibility.minimum` at `13` and `compatibility.maximum` at `14` unless the user changes that requirement.
- [module.json](./module.json) is the Foundry manifest. [package.json](./package.json) configures development commands and is not shipped as a runtime dependency.
- There is no build step or dependency installation. Use Node.js 22 or newer for development.

## Code map

- [scripts/anime-attacks.js](./scripts/anime-attacks.js): settings, chat hooks, per-client queues, PIXI stand-ins, camera movement and cleanup.
- [scripts/core.js](./scripts/core.js): pure attack classification, setting bounds, clash geometry and interpolation.
- [tests/core.test.js](./tests/core.test.js): manifest and pure logic checks.
- [tests/runtime.test.js](./tests/runtime.test.js): mocked Foundry/PIXI lifecycle and privacy regressions.
- [README.md](./README.md): installation, system support, settings and validation limits.
- [CHANGELOG.md](./CHANGELOG.md): release history.

## Animation invariants

- Effects are local visuals. Never change TokenDocument coordinates or persist token movement to create an animation.
- Let Foundry's chat creation broadcast trigger each eligible client. No GM coordinator or custom socket is needed for the current design.
- Preserve message visibility, blind-roll restrictions, attacker ownership, token visibility, client opt-outs, reduced motion and photosensitive mode checks.
- Keep targets in the speaker's scene, reject self-targets and duplicates, and maintain bounded queues.
- In v14, respect the viewed scene level and cancel effects when scene, level, participant position, elevation, membership or visibility changes.
- Restore hidden meshes, remove listeners and overlays, release animation state, and leave shared textures intact on every completion or interruption path. User camera input cancels active and queued effects.
- Detect attacks from structured system metadata. Current automatic adapters cover D&D 5e, PF2e and Shadowdark where the necessary metadata exists. Project FU automatic attack detection is not implemented. Preserve the explicit roll-only `flags["anime-attacks"].attack` integration and opt-out behavior.

## Checks

- For JavaScript or behavior changes, run `npm run check` and `npm test`. In Windows PowerShell use `npm.cmd` when execution policy blocks `npm.ps1`.
- For manifest changes, run `node --test --test-name-pattern=manifest tests/core.test.js` and check matching manifest/package versions and release URLs.
- Use `git diff --check` before committing. Add focused regression coverage for behavioral fixes; documentation-only changes do not need new runtime tests.
- [The GitHub workflow](./.github/workflows/checks.yml) runs syntax checks and tests on Node.js 22.
- Mock tests and API review do not establish live world compatibility. Report the exact validation performed.

## Compatibility badge diagnosis

- Foundry v14.370 returns availability `UNKNOWN` when `compatibility.verified` is absent, even with a valid minimum/maximum range. Its package UI renders a red crossed-file badge with the tooltip **Compatibility Unknown**.
- This exact behavior was reproduced with the installed Foundry availability and badge functions against the matching repository and installed v1.0.4 manifests.
- In the same v14 calculation, a verified value of `13` produces a compatibility-risk warning; `14` produces a success badge. These comparisons are metadata checks, not evidence that either runtime was tested.
- The user explicitly requested `compatibility.verified: "14"` for v1.0.5. Preserve that declared value with minimum v13 and maximum v14. This metadata decision does not establish live gameplay validation; report validation status separately.
- Before declaring any additional core version verified, exercise GM/player clients, public/private/blind rolls, supported system attack detection, multiple targets, rapid attacks, camera cancellation, token changes, scene changes and v14 level changes. Report any unavailable checks.

## Releases and local deployment

- Keep release versions aligned in [module.json](./module.json), [package.json](./package.json), [CHANGELOG.md](./CHANGELOG.md) and the GitHub tag.
- The stable manifest URL is `https://github.com/fchrysoulas/MK-Anime-Attacks/releases/latest/download/module.json`. Pin each download URL to that version's `mk-anime-attacks.zip`.
- Release ZIPs contain the manifest at the root, the complete `scripts/` and `styles/` trees, README and changelog. Validate the archive manifest and required entry points before publishing.
- Documentation-only changes do not require a version bump, runtime ZIP or release.
- The repository is private. Preserve that visibility; GitHub release assets require authentication, so Foundry cannot use those URLs for anonymous automatic updates. Never embed credentials in manifests or silently change repository visibility.
- When local deployment is requested, discover the data directory from Foundry configuration and confirm the running core version. Install runtime files under `Data/modules/anime-attacks/`, retain a backup of an existing installation, and compare copied file hashes.
- Foundry may need a restart to discover a new package and a client reload to use changed assets. Report what was deployed and any remaining reload step.
- Keep fixes to external systems or their assets separate from this module's runtime.