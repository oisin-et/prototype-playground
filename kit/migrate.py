"""Move a playground's explorations to columns and iterations, once.

    python3 playground/migrate.py            # shows what it would do
    python3 playground/migrate.py --apply    # does it

Before, each screen had explorations by topic (<data>/<screen>/<topic>/v1,
v2 …), each a flat list of versions. Now each screen's explorations go
across and their iterations down: <data>/<screen>/v4.0 is exploration 4,
and v4.1, v4.2 … are its iterations. This renumbers every version by what
it was copied from ("from" in versions.json):

- a version copied from main (or from nothing) starts a column, in the
  order the topics are listed in <data>/index.json and the versions in
  each topic's versions.json;
- a version copied from another is the next iteration of that one's column.

Folders move to their new names, paths inside them that point out of their
folder are fixed for the new depth, and picks.json, the notes under
playground/notes/ and the old numbers in versions' names and notes follow.
Each version keeps where it was in "was". A screen whose topics had picks
on more than one version keeps the last (it was laid over the others).
"""

import json
import os
import re
import shutil
import sys
from pathlib import Path

from pglib import (DATA, HERE, INDEX, PICKS, ROOT, playground_lock, read_json, rel,
                   screens, write_json, write_registry)

TEXT = (".js", ".mjs", ".jsx", ".ts", ".tsx", ".dart", ".json", ".css", ".py", ".vue", ".svelte", ".html", ".md")
REL_PATH = re.compile(r"""(['"`])(\.\.?/[^'"`\n]*)\1""")


def plan():
    """[(screen, [(old pg, old id, new id, entry)]), …] and the screens' order."""
    order = read_json(INDEX, {"playgrounds": []}).get("playgrounds", [])
    old = [pg for pg in order if "/" in pg]
    if not old:
        return [], order
    by_screen = {}
    for pg in old:
        by_screen.setdefault(pg.split("/")[0], []).append(pg)
    out = []
    for screen, pgs in by_screen.items():
        cols, moves, col_of = 0, [], {}
        steps = {}
        for pg in pgs:
            meta = read_json(DATA / pg / "versions.json", {"versions": []})
            ids = {v["id"] for v in meta["versions"]}
            for v in meta["versions"]:
                if v["id"] == "default":
                    continue
                src = v.get("from")
                if src and src != "default" and src in ids and (pg, src) in col_of:
                    col = col_of[(pg, src)]
                    steps[col] += 1
                    new = f"v{col}.{steps[col]}"
                else:
                    cols += 1
                    col, steps[cols] = cols, 0
                    new = f"v{col}.0"
                col_of[(pg, v["id"])] = col
                moves.append((pg, v["id"], new, v, meta))
        out.append((screen, pgs, moves))
    return out, order


def show(screens_plan):
    for screen, pgs, moves in screens_plan:
        print(f"\n{screen}: {len(pgs)} topic{'s' if len(pgs) != 1 else ''} → {len({m[2].split('.')[0] for m in moves})} explorations")
        for pg, vid, new, v, meta in moves:
            src = v.get("from") or "main"
            print(f"  {pg.split('/', 1)[1]:<28} {vid:<8} → {new[1:]:<6} {v.get('name', '')}  (from {src})")


def fix_paths(text, old_dir, new_dir, folder_map):
    """Relative paths in a moved file, pointed at the same files from its new
    folder (or at a moved version's new folder)."""
    def fix(m):
        target = (old_dir / m.group(2)).resolve()
        for o, n in folder_map.items():
            try:
                target = n / target.relative_to(o)
                break
            except ValueError:
                continue
        path = Path(os.path.relpath(target, new_dir)).as_posix()
        if not path.startswith("."):
            path = "./" + path
        if m.group(2).endswith("/") and not path.endswith("/"):
            path += "/"
        return f"{m.group(1)}{path}{m.group(1)}"
    return REL_PATH.sub(fix, text)


def apply(screens_plan, order):
    data = rel(DATA)
    titles = screens()
    picks = read_json(PICKS, {})
    new_picks, new_order, renames = {}, [], {}  # renames: (old pg, old id) → (screen, new id)
    for screen, pgs, moves in screens_plan:
        for pg, vid, new, _, _ in moves:
            renames[(pg, vid)] = (screen, new)
    folder_map = {(DATA / pg / vid).resolve(): (DATA / s / n).resolve() for (pg, vid), (s, n) in renames.items()}

    for screen, pgs, moves in screens_plan:
        label = {(pg, vid): new[1:] for pg, vid, new, _, _ in moves}
        first = read_json(DATA / pgs[0] / "versions.json", {"versions": []})
        main = next((v for v in first["versions"] if v["id"] == "default"),
                    {"id": "default", "name": "As it is", "date": "", "note": ""})
        versions = [main]
        for pg, vid, new, v, meta in moves:
            entry = dict(v)
            entry["id"] = new
            if v.get("from") and (pg, v["from"]) in renames:
                entry["from"] = renames[(pg, v["from"])][1]
            else:
                entry.pop("from", None)
            if meta.get("starred") and new.endswith(".0") and not any(
                    x.get("was", "").startswith(pg + "/") for x in versions):
                entry["starred"] = True  # the topic's star, on its first exploration
            # "v7 with …" in a name or note means the topic's own v7.
            for k in ("name", "note"):
                if isinstance(entry.get(k), str):
                    entry[k] = re.sub(r"\bv(\d+)\b", lambda m: label.get((pg, m.group(0)), m.group(0)), entry[k])
            entry["was"] = f"{pg}/{vid}"
            versions.append(entry)
            # The folder, and the paths inside it.
            src, dest = DATA / pg / vid, DATA / screen / new
            if src.is_dir():
                shutil.move(str(src), str(dest))
                # A relative link points one folder shallower now.
                for link in [p for p in dest.rglob("*") if p.is_symlink()]:
                    target = os.readlink(link)
                    if not os.path.isabs(target):
                        old_dir = (src / link.relative_to(dest)).parent
                        link.unlink()
                        link.symlink_to(os.path.relpath(os.path.normpath(old_dir / target), link.parent))
                for f in dest.rglob("*"):
                    if f.is_symlink() or not f.is_file() or f.suffix not in TEXT:
                        continue
                    try:
                        text = f.read_text()
                    except UnicodeDecodeError:
                        continue
                    old_dir = (src / f.relative_to(dest)).parent.resolve()
                    fixed = fix_paths(text, old_dir, f.parent.resolve(), folder_map)
                    fixed = (fixed.replace(f"{pg} {vid};", f"{screen} {new};")
                             .replace(f"{data}/{pg}/{vid}/", f"{data}/{screen}/{new}/")
                             .replace(f"playground/{pg}/{vid}/", f"playground/{screen}/{new}/"))
                    if fixed != text:
                        f.write_text(fixed)
        for pg in pgs:
            # What's left of the topic (its versions.json, anything else) goes to the trash.
            rest = DATA / pg
            if rest.exists():
                trash = HERE / "trash" / "migrated" / pg
                trash.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(rest), str(trash))
            if picks.get(pg, "default") != "default" and (pg, picks[pg]) in renames:
                new_picks[screen] = renames[(pg, picks[pg])][1]
        write_json(DATA / screen / "versions.json", {
            "title": titles.get(screen, {}).get("title", screen), "start": screen, "versions": versions,
        })
        new_order.append(screen)

    for pg in order:  # anything already in the new form stays, in its place
        if "/" not in pg and pg not in new_order:
            new_order.append(pg)
            if pg in picks:
                new_picks[pg] = picks[pg]
    write_json(INDEX, {**read_json(INDEX, {}), "playgrounds": new_order})
    write_json(PICKS, dict(sorted(new_picks.items())))

    # Notes made on the old versions.
    for f in (HERE / "notes").glob("*/notes.json"):
        doc = read_json(f, {})
        changed = False
        for n in doc.get("notes", []):
            key = (n.get("playground"), n.get("version"))
            if key in renames:
                n["playground"], n["version"] = renames[key]
                changed = True
            elif n.get("playground") and "/" in n["playground"] and n.get("version") in (None, "default"):
                n["playground"] = n["playground"].split("/")[0]
                changed = True
            for i, path in enumerate(n.get("files") or []):
                for (pg, vid), (s, new) in renames.items():
                    if path.startswith(f"{data}/{pg}/{vid}/"):
                        n["files"][i] = path.replace(f"{data}/{pg}/{vid}/", f"{data}/{s}/{new}/", 1)
                        changed = True
        if changed:
            f.write_text(json.dumps(doc, indent=2) + "\n")
    write_registry()


def main(argv):
    screens_plan, order = plan()
    if not screens_plan:
        print("Nothing to move: every screen's explorations are in columns already.")
        return
    show(screens_plan)
    picks = read_json(PICKS, {})
    for screen, pgs, _ in screens_plan:
        many = [pg for pg in pgs if picks.get(pg, "default") != "default"]
        if len(many) > 1:
            print(f"\n{screen} has picks in {len(many)} topics ({', '.join(many)}): the last, {many[-1]} {picks[many[-1]]}, is kept.")
    if "--apply" not in argv:
        print("\nNothing has moved yet. Run it again with --apply to do it.")
        return
    apply(screens_plan, order)
    print(f"\nDone. The old topics' versions.json files are in {rel(HERE / 'trash' / 'migrated')}/.")


if __name__ == "__main__":
    with playground_lock():
        main(sys.argv[1:])
