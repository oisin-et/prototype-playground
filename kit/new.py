"""Start a new exploration of one of the app's screens: the next column.

    python3 playground/new.py <screen> "Name" [--from <version>]

A screen's explorations go across, numbered 1, 2, 3 …, and each one's
iterations go down under it (playground/iterate.py). This makes the next
exploration, v<N>.0, by copying main (the app's own file for the screen,
with a version file from playground/templates/ that draws the copy in its
place), or --from a version (4.2, v4.2) to take that one in a new direction.
The first exploration of a screen starts its <data>/<screen>/versions.json
and adds it to <data>/index.json. Change the copy, and write what it tries
in the version's "note".

Rewrites the registry, so the app picks the new version up at the next
reload (serve.py does one when chat or the panel asks; python3
playground/reload.py does one from a terminal).
"""

import sys

from pglib import find_version, make_version, number, playground_lock, screen_meta


def main(argv):
    source = "default"
    if "--from" in argv:
        i = argv.index("--from")
        if i + 1 >= len(argv):
            sys.exit(__doc__)
        source = argv[i + 1]
        argv = argv[:i] + argv[i + 2:]
    if len(argv) < 2:
        sys.exit(__doc__)
    screen, name = argv[0], argv[1]
    meta_path, meta = screen_meta(screen)
    source = find_version(meta, screen, source)
    n = 1 + max([number(v["id"])[0] for v in meta["versions"] if number(v["id"])] or [0])
    make_version(screen, source, f"v{n}.0", name, meta_path, meta)


if __name__ == "__main__":
    with playground_lock():  # other chats may be making versions too
        main(sys.argv[1:])
