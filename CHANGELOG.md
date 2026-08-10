# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## Release process

1. Ensure `pnpm check` and `pnpm build` pass on `main` and CI is green.
2. Add a dated `## [x.y.z]` section below, grouped as Added / Changed /
   Fixed / Removed, and bump the root `package.json` version.
3. Tag the release commit `vx.y.z` and push the tag.
4. Evidence-class language in release notes must follow
   `docs/PAPER_ALIGNMENT_MATRIX.md` (mechanism / pipeline / empirical / scale).

## [Unreleased]

### Added

- LLM social-signal extractor: conversations are classified by an LLM into a
  closed signal taxonomy with per-signal severity (0-1); deltas remain
  adjudicated by the deterministic rule table with unchanged clamps. Policy
  versions `conversation-outcome-v1` (keyword fallback) / `v2` (labels) /
  `v3` (severities) are recorded on events and memory hints. Enabled by
  default; `AIVILIZATION_SOCIAL_SIGNAL_EXTRACTION=off` opts out.
- Context-aware deterministic dialogue templates with relationship- and
  economy-driven arcs and hash-selected phrasing variants.
- Social-signal extraction traces across cycle, worker, observability, and
  run reports (`deterministic` / `fallback` / `accepted` states).
- `docs/CITY_MECHANISM_GAP_ANALYSIS.md`: public roadmap of city-simulation
  gaps versus Cities: Skylines and the evidence-boundary rules.
- Open-source infrastructure: Apache-2.0 `LICENSE`, `CONTRIBUTING.md`,
  CI workflow, issue and PR templates.

### Removed

- `AgentSocialize` command: the last path that let callers self-report
  relation/attitude deltas, bypassing world-authoritative evaluation.
  Social score writes now have a single authoritative entry point.
- `HANDOFF.md`: superseded by the paper alignment matrix and the roadmap.

## [0.1.0] - 2026-08-10

Initial public baseline: canonical agent runtime (hierarchical planning,
dual-process memory, adaptive profiles, human steering), unified
simulation-wide authority with hash-chained audit journal, society-wide
directory and projection, cross-owner movement with cognitive-snapshot
handoff, AMM market and production chains, social/institution systems
(education, occupation, residential, wage, welfare, healthcare, physiology),
deployment and recovery contracts, and observatory UI.
