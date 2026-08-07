# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Note:** There is an automatic release GitHub workflow which regularly pushes new _patch-level_ (x.y.**z**) releases to NPM, whenever there are updates for the underlying dependencies used by renovate-log-parser. These patch versions do _not_ appear in this changelog!

## [0.3.0] - 2026-08-07

### Added

- `detect-errors` command supports new category "invalid-config" (detecting when `renovate.json` has invalid syntax)

### Fixed

- API server and web frontend support _multiple_ opened files in parallel, allowing you to have several browser tabs open with different files

## [0.2.0] - 2026-08-01

### Added

- Web frontend has a "Help" button that explains features that are not immediately obvious
- Web frontend has a customized favicon

### Changed

- Refined how the `install-analyze-skill` command queries GitHub-related information
- Refined information in the SKILL.md template
- Web frontend renders multiline string values in the details panel with line breaks

### Fixed

- Web frontend now ships the "Public Sans" font rather than falling back to whatever `sans-serif` the viewer's operating system provides (this was introduced to improve E2E test reliability)

## [0.1.2] - 2026-07-29

### Changed

- Switch from Nuxt.js _server api_ to a statically-rendered Nuxt SPA, with Express.s serving that SPA and the API. The underlying reason are complications with Nitro and h3, requiring several ugly workarounds, which are now removed

## [0.1.0] / [0.1.1] - 2026-07-29

### Added

- **Initial release** with basic functionality
