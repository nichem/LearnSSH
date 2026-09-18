# Changelog

All notable changes to this project are documented in this file.

## [1.1.1] - 2026-09-18

### Fixed

- Document the UTF-8 `$OutputEncoding` setting required before piping from Windows PowerShell 5.1, so its ASCII default does not turn a leading BOM into `?` before the CLI can normalize it.
- Filter the `tcsetattr: Inappropriate ioctl for device` job-control warning out of `bash -lic` stderr.

### Added

- Local development installs: run `node bin/install.mjs --force` from a checkout (documented in README).
- `npm test` script (`node --test tests/cli-output.test.mjs`).
- `.gitattributes` pinning LF line endings.

### Changed

- SKILL.md: the PowerShell `exec --stdin` example now sets `$OutputEncoding` to UTF-8; the CLI continues to strip a leading BOM and normalize CRLF.
- A running daemon is reused after an in-place CLI upgrade until it exits or is explicitly stopped, so active commands are not interrupted by an automatic restart.
