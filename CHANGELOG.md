# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Note:** There is an automatic release GitHub workflow which regularly pushes new _patch-level_ (x.y.**z**) releases to NPM, whenever there are updates for the underlying dependencies used by renovate-log-parser. These patch versions do _not_ appear in this changelog!

## [0.1.2] - 2026-07-29

### Changed

- Switch from Nuxt.js _server api_ to a statically-rendered Nuxt SPA, with Express.s serving that SPA and the API. The underlying reason are complications with Nitro and h3, requiring several ugly workarounds, which are now removed

## [0.1.0] / [0.1.1] - 2026-07-29

### Added

- **Initial release** with basic functionality
