"""Iterate on a version: the next one down its exploration's column.

    python3 playground/iterate.py <screen> <version> "Name"

<version> is the one to build on (4.2, v4.2, or 4 for v4.0). The copy is
the next iteration of its exploration: after v4.0, v4.1 and v4.2 comes v4.3,
whichever of them it's copied from ("from" in versions.json says which).
Change the copy, and write what it changes in the version's "note".

Rewrites the registry, so the app picks the new version up at the next
reload (serve.py does one when chat or the panel asks; python3
playground/reload.py does one from a terminal).
"""

import sys

from pglib import find_version, make_version, number, playground_lock, screen_meta


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__)
    screen, which, name = argv[0], argv[1], argv[2]
    meta_path, meta = screen_meta(screen)
    source = find_version(meta, screen, which)
    if not number(source):
        sys.exit(f"{'main' if source == 'default' else source} isn't in an exploration's column, so there's nothing to iterate on: "
                 f"start an exploration from it with python3 playground/new.py {screen} \"Name\""
                 + ("" if source == "default" else f" --from {source}"))
    col = number(source)[0]
    step = 1 + max(number(v["id"])[1] for v in meta["versions"] if number(v["id"]) and number(v["id"])[0] == col)
    make_version(screen, source, f"v{col}.{step}", name, meta_path, meta)


if __name__ == "__main__":
    with playground_lock():  # other chats may be making versions too
        main(sys.argv[1:])
