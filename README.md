# MK-Anime-Attacks

Cinematic attack effects for **Foundry VTT v12**. Visible attacker and target images approach a clash point while the camera zooms, then return. Real token positions, vision, and world documents are never changed.

## Installation

This repository is private. Download `mk-anime-attacks.zip` from the [latest release](https://github.com/fchrysoulas/MK-Anime-Attacks/releases/latest) using your GitHub account and extract it into `Data/modules/anime-attacks/`. Alternatively, clone the repository and copy `module.json`, `scripts/`, and `styles/` into that folder. Restart Foundry and enable **MK-Anime-Attacks** in the world. Keep the `anime-attacks` folder name: it matches the existing module ID and preserves saved settings.

There are no module dependencies. Compatibility remains limited to v12 until tested on newer Foundry versions.

The update manifest is [module.json](https://github.com/fchrysoulas/MK-Anime-Attacks/releases/latest/download/module.json). Each manifest points to its exact release archive. Foundry requires publicly accessible manifest and download URLs for automatic installation and updates; these private GitHub assets require authentication, so use manual updates while the repository remains private.

## Use

Select the attacker's token, select one or more targets, and roll an attack. Effects play for each target in sequence on every eligible client viewing the same scene, including players. A connected GM is not required. Each client must be able to see the message contents and both tokens; blind or private rolls are not exposed to other viewers.

Automatic detection uses structured metadata from:

- **D&D 5e:** attack roll flags or attack roll options.
- **Pathfinder 2e:** attack-roll and spell-attack-roll contexts.
- **Shadowdark:** attack roll configuration when the system supplies it. Older v12-era Shadowdark versions omit attack-type metadata; those require explicit opt-in as described below.

Ordinary chat, damage rolls, saving throws, item cards, and unsupported system rolls are ignored. For another system or a custom attack macro, add `flags["anime-attacks"].attack = true` to an actual roll message before creation, with a scene/token speaker and selected targets. Set it to `false` to suppress an effect. Target IDs are captured by the creating client; unflagged historical messages are not replayed.

Settings control approach, hold and return durations, clash spacing, and zoom. Each user can disable animations or camera movement independently. The operating system's reduced-motion preference disables effects. Clicking or scrolling on the canvas, or pressing camera navigation keys, cancels active and queued effects and leaves the camera under user control. Scene teardown, participant movement/deletion, loss of visibility, or an animation error cleans up local stand-ins. Normal completion restores the camera.

The local queue holds up to 20 waiting messages; further effects are skipped until space is available. Concurrent clients animate independently, so frame timing may differ. Stand-ins preserve the token texture, dimensions, mirroring, rotation, tint and opacity; external shader effects, labels and bars are not copied.

## Development and verification

Node.js 22 or newer is required for development checks. No dependency installation or build is needed.

```sh
npm run check
npm test
```

Automated tests use mocked Foundry/PIXI objects. Before release, test in a live v12 world with a GM and player: public/private/blind rolls, multiple targets, rapid attacks, a large token, camera input, and switching scenes during the effect. Automated tests do not establish live system compatibility.
