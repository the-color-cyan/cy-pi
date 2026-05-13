---
name: async-scout
description: Scout context, then planner synthesis. Pair with /parallel for true async fan-out.
---

## scout
output: scout-context.md

Analyze {task}. Focus on files, risks, and likely change scope.

## planner
reads: scout-context.md
progress: true

Create a concise plan for {task} using {previous}. Include execution order and risk mitigations.
