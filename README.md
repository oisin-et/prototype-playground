# Prototype playground

A Claude Code skill that puts a playground around your own app. The app runs in the browser, on a canvas between two panels:

- **Explorations**, on the left, holds versions of each screen. Click one to try it live: the app keeps its state. **Use this version** picks it.
- **Claude**, on the right, is a chat that makes new versions while you watch. Up to four chats can run at once, and you can capture parts of the app and pin notes to them.

The skill comes with no project. Open your project, ask for a playground, and the skill sets one up around it. It works with **Flutter** apps and **web** apps (React, Vite, Next, Vue, Svelte or plain HTML).

## Install

```sh
git clone https://github.com/oisin-et/prototype-playground.git ~/.claude/skills/prototype-playground
```

To update it later: `git -C ~/.claude/skills/prototype-playground pull`.

## Use it

1. Open your project in Claude Code: its terminal, or VS Code with the Claude Code extension.
2. Ask: **"set up a prototype playground for this project"**, or type `/prototype-playground`.
3. Claude asks whether the playground should be committed for the team or kept on your computer. It then sets it up, lists your app's screens and hooks the app up with a small change that does nothing outside the playground. Finally it checks that the playground works.
4. Run it any time: `python3 playground/serve.py --open`, or double-click `playground/Open playground.command`.

When the skill gets an update, ask Claude to "update the playground" in each project. Your settings and explorations are kept.

## What's inside

| | |
|---|---|
| `SKILL.md` | What Claude follows: find the project, set it up, run it, make and pick versions |
| `kit/` | The playground itself (page, panels, server, scripts), copied into a project's `playground/` |
| `adapters/flutter/`, `adapters/web/` | The bridge the app uses to talk to the playground, and how to hook it up (`HOOK.md`) |
| `scripts/setup.py` | Installs the kit and the bridge into a project, or updates them (`--update`) |
| `PROTOCOL.md` | The messages between the playground and the app |

You'll need Python 3 (it comes with macOS), and for chat, Claude Code. A Flutter app also needs Flutter, and a web app needs whatever already runs it.
