# Cognition LLM Memory/Profile Context Gate Slice

## Goal

Close the cognition-side blind spot where strategic and daily LLM compilers can receive memory/profile context, but durable runtime-profile diagnostics and gates cannot prove that context reached the provider trace.

## Scope

- Add cognitive context trace fields to strategic and daily planning compilation traces.
- Ensure trace repositories clone and persist those fields.
- Summarize cognition LLM stage diagnostics with short-term memory and long-term profile context counts.
- Extend runtime-profile gates and local profile gate criteria so strategic/daily LLM stages can require those contexts when enabled.

## Non-Goals

- Do not implement market-price feedback or new economic reasoning in this slice.
- Do not redesign objective proposer scoring.
- Do not touch Godot/frontend surfaces.
- Do not enable real production LLM credentials.

## Test Plan

- RED: observability report test expects cognition diagnostics to count STM/LTM context for strategic/daily traces.
- RED: runtime-profile gate test fails when a required cognition stage lacks STM/LTM context.
- RED: local profile gate criteria derives required cognition STM/LTM stages from strategic/daily runtime config.
- GREEN: run focused observability and server tests after implementation.
