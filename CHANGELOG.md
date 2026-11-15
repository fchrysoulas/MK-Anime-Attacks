# Changelog

## 1.0.2

- Add a stable Foundry update manifest URL and a versioned module download URL.
- Publish a release manifest and installable module archive.

## 1.0.1

- Filter chat using attack metadata, with an explicit opt-in for custom roll macros.
- Replace persisted token movement with local visual stand-ins on eligible GM and player clients.
- Honor movement durations and animate the camera concurrently with the stand-ins.
- Queue overlapping attacks and process all selected targets once per message.
- Respect message privacy, token visibility, author ownership and reduced-motion preferences.
- Clean up on scene teardown, token changes, user input and errors without altering shared textures.
- Validate numeric settings and account for large token footprints.
- Add documentation, regression tests and GitHub Actions checks.
