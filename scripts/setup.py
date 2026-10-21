#!/usr/bin/env python3
"""Put the playground into a project, or bring a project's playground up to
date with this kit.

    python3 setup.py <project> --adapter flutter|web [--name "My App"] [--data DIR]
                     [--port 8820] [--app-port 8821] [--command "npm run dev -- --port {port} --host {host} --strictPort"]
    python3 setup.py <project> --update

A new setup copies the kit into <project>/playground/ and the adapter's
bridge into the app, and writes what's particular to the project:
playground/playground.json, playground/RULES.md (its rules for Claude),
playground/templates/ (how duplicate.py turns a copied screen into a
version) and, in <data>/, an empty index.json, picks.json and screens.json.
It never touches the app's own code: hooking the app up (HOOK.md in the
adapter's folder) and listing its screens are left to do.

--update copies the kit and the bridge again and leaves everything
particular to the project as it is.

Standard library only.
"""

import argparse
import json
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
KIT = SKILL / "kit"
ADAPTERS = SKILL / "adapters"
KIT_FILES = ["serve.py", "pglib.py", "new.py", "duplicate.py", "reload.py", "index.html", "README.md", "src"]
DEFAULT_DATA = {"flutter": "lib/playground", "web": "src/playground"}
LAUNCHER = """#!/bin/zsh
# Double-click to start the playground and open it in the browser.
cd "$(dirname "$0")/.." && exec python3 playground/serve.py --open
"""
RULES = """# Rules for versions in this project

Claude in the playground's chat reads this on every message, after the kit's own
rules. Write what's particular to this project: its tokens and how to use them,
what a version's builder returns, what not to touch. Keep it short.

-
"""
GITIGNORE = ["/playground/attachments/", "/playground/notes/", "/playground/__pycache__/"]


def kit_version():
    try:
        return subprocess.run(["git", "-C", str(SKILL), "rev-parse", "--short", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def copy(src, dest):
    if src.is_dir():
        shutil.copytree(src, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", ".DS_Store"))
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)


def write_new(path, text):
    """Writes path only if it isn't there: it belongs to the project once written."""
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return True


def install_kit(project):
    pg = project / "playground"
    for name in KIT_FILES:
        copy(KIT / name, pg / name)
    launcher = pg / "Open playground.command"
    launcher.write_text(LAUNCHER)
    launcher.chmod(launcher.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    (pg / ".kit-version").write_text(kit_version() + "\n")


def install_bridge(project, adapter, data):
    """The adapter's runtime: what the app imports to talk to the playground."""
    src = ADAPTERS / adapter
    if adapter == "flutter":
        for f in (src / "lib").glob("*.dart"):
            copy(f, data / f.name)
        copy(src / "web" / "playground.js", project / "web" / "playground.js")
    else:
        copy(src / "bridge.js", data / "bridge.js")


def install_templates(project, adapter):
    """The version templates, if the project hasn't got them (it may have changed them)."""
    for t in (ADAPTERS / adapter / "templates").iterdir():
        write_new(project / "playground" / "templates" / t.name, t.read_text())


def flutter_package(project):
    try:
        m = re.search(r"^name:\s*([\w]+)", (project / "pubspec.yaml").read_text(), re.M)
    except OSError:
        m = None
    if not m:
        sys.exit("No pubspec.yaml with a name: is this the Flutter project's top folder?")
    return m.group(1)


def main():
    ap = argparse.ArgumentParser(description="Put the playground into a project (see the top of this file).")
    ap.add_argument("project", type=Path)
    ap.add_argument("--adapter", choices=["flutter", "web"])
    ap.add_argument("--name")
    ap.add_argument("--data", help="where the explorations live, from the project's top (inside the app's source)")
    ap.add_argument("--port", type=int, default=8820)
    ap.add_argument("--app-port", type=int, default=8821)
    ap.add_argument("--command", help="web: the command that starts the app's dev server, with {port} and {host}")
    ap.add_argument("--update", action="store_true", help="copy the kit and the bridge again, keeping the project's own files")
    args = ap.parse_args()
    project = args.project.expanduser().resolve()
    config_path = project / "playground" / "playground.json"

    if args.update:
        if not config_path.is_file():
            sys.exit(f"{config_path} isn't there: set the playground up first.")
        config = json.loads(config_path.read_text())
        adapter, data = config.get("adapter", "web"), project / config["data"]
        install_kit(project)
        install_bridge(project, adapter, data)
        install_templates(project, adapter)
        subprocess.run([sys.executable, "-c", "import pglib; pglib.write_registry()"], cwd=project / "playground", check=True)
        print(f"Updated the playground in {project} to kit {kit_version()}. Its config, rules, templates and explorations are as they were.")
        return

    if config_path.exists():
        sys.exit(f"{project} has a playground already. Use --update to bring it up to date.")
    if not args.adapter:
        sys.exit("Say which adapter: --adapter flutter (a Flutter app) or --adapter web (anything served by a dev server).")
    adapter = args.adapter
    data_rel = args.data or DEFAULT_DATA[adapter]
    data = project / data_rel
    config = {
        "name": args.name or project.name,
        "key": re.sub(r"[^a-z0-9]+", "-", (args.name or project.name).lower()).strip("-"),
        "adapter": adapter,
        "data": data_rel,
        "port": args.port,
        "app": {"port": args.app_port},
        "sizes": ["1280x800", "1440x900", "1920x1080"],
        "size": "1440x900",
    }
    if adapter == "flutter":
        if not data_rel.startswith("lib/"):
            sys.exit("A Flutter project's playground data must be inside lib/ (lib/playground by default), so the app compiles it.")
        config["flutter"] = {"package": flutter_package(project)}
    else:
        config["app"].update({"command": args.command or "npm run dev -- --port {port} --host {host} --strictPort",
                              "host": "127.0.0.1", "path": "/"})

    install_kit(project)
    config_path.write_text(json.dumps(config, indent=2) + "\n")
    write_new(project / "playground" / "RULES.md", RULES)
    install_templates(project, adapter)
    data.mkdir(parents=True, exist_ok=True)
    write_new(data / "index.json", '{"playgrounds": []}\n')
    write_new(data / "picks.json", "{}\n")
    write_new(data / "screens.json", json.dumps({
        "about": "The app's screens, by id. The playground makes a folder for each. \"file\" is the screen's own "
                 "source file, which duplicate.py copies into a new version" + (
                     "; \"type\" is its widget class and \"build\" builds the copy from the original (o)."
                     if adapter == "flutter" else "; \"export\" is the component's export name in it (\"default\" by default)."),
        "screens": {},
    }, indent=2) + "\n")
    install_bridge(project, adapter, data)
    subprocess.run([sys.executable, "-c", "import pglib; pglib.write_registry()"], cwd=project / "playground", check=True)

    ignore = project / ".gitignore"
    have = ignore.read_text().splitlines() if ignore.is_file() else []
    add = [l for l in GITIGNORE + [f"/{data_rel}/.lock"] if l not in have]
    if add:
        with ignore.open("a") as f:
            f.write(("\n" if have and have[-1].strip() else "") + "# The playground's screenshots, notes and lock (prototype-playground kit)\n" + "\n".join(add) + "\n")

    print(f"Set up the playground in {project} (kit {kit_version()}, {adapter} adapter, explorations in {data_rel}/).")
    print("Still to do: list the app's screens in", f"{data_rel}/screens.json,", "hook the app up (adapters/" + adapter + "/HOOK.md),")
    print("and write the project's rules in playground/RULES.md. Then: python3 playground/serve.py --open")


if __name__ == "__main__":
    main()
