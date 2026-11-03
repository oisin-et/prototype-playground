# Prototype playground

A Claude Code skill that puts a playground around your own app. The app runs in the browser, on a canvas under a strip of its versions and between two panels:

- **Explorations**, the strip across the top, lays out the versions of the screen on show step by step: each exploration (4.0) and its iterations (4.1, 4.2 …) side by side. Hover a step to see a snapshot of it, and click it to try it live: the app keeps its state. **Use this version** picks it.
- **Files**, on the left, is your project's folder as VS Code shows it, live: what's behind the screen on show, what's changed, or everything, with a glow on whatever has just changed, so you can watch Claude work.
- **Library**, beside Files, is your app's component library: each component with its picture, side-by-side specimens and everywhere it's used, including copies and look-alikes that have drifted. **Inspect** (I) names the component under the pointer. Claude designs from the library, proposes a component when nothing fits, and each version is checked against it.
- **Claude**, on the right, is a chat that makes new versions while you watch. Up to four chats can run at once, and you can capture parts of the app and pin notes to them.

The skill comes with no project. Open your project, ask for a playground, and the skill sets one up around it. It works with **Flutter** apps and **web** apps (React, Vite, Next, Vue, Svelte or plain HTML).

## Install

```sh
git clone https://github.com/oisinomuiridesign-hub/prototype-playground.git ~/.claude/skills/prototype-playground
```

To update it later: `git -C ~/.claude/skills/prototype-playground pull`.

Install it as a git clone, as above. The playground checks the skill's commit to know when a project's copy is out of date, so an install without git history can't offer updates.

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
