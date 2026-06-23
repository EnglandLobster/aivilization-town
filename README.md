# AIvilization Town

AIvilization Town is a ground-up reconstruction of an AI-town simulation inspired by
`AIvilization v0: Toward Large-Scale Artificial Social Simulation with a Unified Agent
Architecture and Adaptive Agent Profiles`.

This repository is intentionally independent from the two older reference projects in the
parent directory:

- `../a16z-ai-town` is a visual and real-time-game reference only.
- `../generative_agents` is a paper-era agent simulation reference only.

The product goal is a large, extensible town-scale simulation game rather than a small demo. The
initial architecture therefore separates simulation, economy, society, agent cognition, memory,
LLM integration, observability, and user-facing applications from the first commit.

## Current State

The repository is in the design phase. The authoritative starting spec is:

- `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`

Implementation begins after that spec is reviewed and approved.
