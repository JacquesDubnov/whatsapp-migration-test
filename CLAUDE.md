# CLAUDE.md -- WhatsApp Migration Test

## Global Instructions

Read and follow all instructions in `/Users/jacquesdubnov/Coding/CLAUDE.md` (global coding CLAUDE.md).

## Project Identity

**WhatsApp Migration Test** -- a ThirdAct proof-of-concept demonstrating WhatsApp chat history migration into OBLIQ. Built by Jacques to prove to the dev team that this can be done.

## Purpose

Prove that WhatsApp exported chat data (messages, media, group metadata) can be parsed, transformed, and imported into OBLIQ's data model. This is a one-shot test/demo, not a production system.

## Source of Truth

All project vision and product documents live in the Obsidian vault:

| Document | Vault Path |
|----------|-----------|
| Test Root Note | `PROJECTS/OBLIQ/OBLIQ - WhatsApp Migration Test/OBLIQ - WhatsApp Migration Test.md` |
| OBLIQ Vision | `PROJECTS/OBLIQ/OBLIQ - Vision Statement V2.md` |
| OBLIQ MRD | `PROJECTS/OBLIQ/OBLIQ - MRD V1.0.md` |
| OBLIQ PRD | `PROJECTS/OBLIQ/OBLIQ - PRD V1.0.md` |
| OBLIQ Migration | `PROJECTS/OBLIQ/OBLIQ - Migration.md` |

## Scope

- Parse WhatsApp exported `.txt` chat files and media archives
- Transform messages into OBLIQ-compatible format
- Handle group chats, media references, reactions, replies
- Output structured data ready for OBLIQ import
- Document the process for the dev team

## Constraints

- Proof of concept only -- optimize for speed and clarity, not production robustness
- Must work with real WhatsApp export data
- Must demonstrate the migration is feasible and document edge cases

## Handover System

Uses the global handover system at `~/.claude/handovers/`. Follow the protocol in `~/.claude/handovers/PROTOCOL.md`.
