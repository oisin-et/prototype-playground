"""Start a new version of an exploration from one of its versions.

    python3 playground/duplicate.py <screen>/<exploration> <from-version> "Name" [--id v2b]

Copies <data>/<screen>/<exploration>/<from-version>/ to the next free number
(v1, v2, …, or --id) and adds it to the exploration's versions.json with
today's date. Copying "default" copies the app's own file for the screen
(its "file" in <data>/screens.json) into the new version, with its imports
fixed to work from there, and writes the version file from
playground/templates/ so the copy is drawn in place of the screen. Change
the copy, and write what it changes in the version's "note".

Rewrites the registry, so the app picks the new version up at the next
reload (serve.py does one when chat or the panel asks; python3
playground/reload.py does one from a terminal).
"""

import shutil
import sys
import time
from pathlib import Path

import pglib
from pglib import (ADAPTER, DATA, HERE, ROOT, VERSION_FILE, VERSION_ID, playground_lock,
                   read_json, rel, relocated, screens, write_json, write_registry)


def version_from_default(pg, new, name, meta, dest):
    screen = pg.split("/")[0]
    s = screens()[screen]
    if not s.get("file"):
        sys.exit(f"The {screen} screen has no \"file\" in screens.json, so there's nothing to copy: "
                 f"duplicate.py can't start from default. Write the version's {VERSION_FILE} by hand.")
    orig = ROOT / s["file"]
    template = HERE / "templates" / VERSION_FILE
    if not template.is_file():
        sys.exit(f"No {rel(template)}: run the skill's setup again to put it back.")
    dest.mkdir()
    copy = orig.name
    # A header comment, where the file's language has // comments.
    head = f"// A copy of {s['file']} for {pg} {new}; change it freely.\n" if orig.suffix in (
        ".dart", ".js", ".jsx", ".ts", ".tsx", ".mjs") else ""
    (dest / copy).write_text(head + relocated(orig.read_text(), orig, dest))
    lib_path = Path(s["file"]).relative_to("lib").as_posix() if ADAPTER == "flutter" and s["file"].startswith("lib/") else s["file"]
    (dest / VERSION_FILE).write_text(template.read_text().format(
        title=meta["title"], name=name or new, id=new, pg=pg, screen=screen,
        package=getattr(pglib, "PACKAGE", ""), orig_path=lib_path, copy=copy, copy_stem=Path(copy).stem,
        type=s.get("type", ""), build=s.get("build", ""), export=s.get("export", "default"),
    ))


def main(argv):
    explicit = None
    if "--id" in argv:
        i = argv.index("--id")
        explicit = argv[i + 1] if i + 1 < len(argv) else None
        argv = argv[:i] + argv[i + 2:]
    if len(argv) < 2:
        sys.exit(__doc__)
    pg, source = argv[0], argv[1]
    name = argv[2] if len(argv) > 2 else ""
    here = DATA / pg
    meta_path = here / "versions.json"
    if not meta_path.exists():
        sys.exit(f"No exploration called {pg} ({rel(DATA)}/{pg}/versions.json). Start one with playground/new.py.")
    meta = read_json(meta_path)
    ids = [v["id"] for v in meta["versions"]]
    if source not in ids:
        sys.exit(f"{pg} has no version {source!r}. It has: {', '.join(ids)}")
    if explicit:
        if not VERSION_ID.match(explicit) or explicit in ids or explicit == "default":
            sys.exit(f"Can't use {explicit!r} as the id: it must be new, and lowercase letters and numbers.")
        new = explicit
    else:
        n = 1
        while f"v{n}" in ids:
            n += 1
        new = f"v{n}"
    dest = here / new
    if dest.exists():
        sys.exit(f"{rel(dest)} exists already.")

    if source == "default":
        version_from_default(pg, new, name, meta, dest)
    else:
        shutil.copytree(here / source, dest)
        top = dest / VERSION_FILE
        if top.exists():
            lines = top.read_text().split("\n", 1)
            if lines[0].startswith("// ") and f"({source})." in lines[0]:
                lines[0] = f"// {meta['title']}: {name or new} ({new})." + lines[0].split(f"({source}).", 1)[1]
                top.write_text("\n".join(lines))
        # A copy's own lines that name the version it came from.
        data = rel(DATA)
        for f in dest.rglob("*"):
            if not f.is_file() or f.suffix not in (".dart", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".vue", ".svelte", ".css"):
                continue
            text = f.read_text()
            fixed = text.replace(f"{pg} {source};", f"{pg} {new};").replace(f"{data}/{pg}/{source}/", f"{data}/{pg}/{new}/")
            if ADAPTER == "flutter":
                fixed = fixed.replace(f"playground/{pg}/{source}/", f"playground/{pg}/{new}/")
            if fixed != text:
                f.write_text(fixed)

    entry = {"id": new, "name": name or new, "date": time.strftime("%Y-%m-%d"), "note": ""}
    if source != "default":
        entry["from"] = source
    meta["versions"].append(entry)
    write_json(meta_path, meta)
    write_registry()
    print(f"Made {pg} {new} from {source}: {rel(dest)}/. Write what it changes in its note in versions.json.")


if __name__ == "__main__":
    with playground_lock():  # other chats may be making versions too
        main(sys.argv[1:])
