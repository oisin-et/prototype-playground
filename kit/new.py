"""Start an exploration of one of the app's screens.

    python3 playground/new.py <screen> <exploration> "Title" "What it tries, in one sentence"

Makes <data>/<screen>/<exploration>/versions.json with its default version
(the app as it is), and adds the exploration to <data>/index.json, so it
shows in that screen's folder in the Explorations panel. <data> is "data" in
playground/playground.json; <screen> is an id from <data>/screens.json;
<exploration> is lowercase letters, numbers and hyphens. Then start its first
version:

    python3 playground/duplicate.py <screen>/<exploration> default "Name"
"""

import sys
import time

from pglib import DATA, INDEX, NAME, playground_lock, read_json, rel, screens, write_json, write_registry


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__)
    screen, name, title = argv[0], argv[1], argv[2]
    about = argv[3] if len(argv) > 3 else ""
    if screen not in screens():
        sys.exit(f"No screen called {screen!r}. The screens are: {', '.join(screens())}")
    if not NAME.match(name):
        sys.exit("The exploration's name is lowercase letters, numbers and hyphens, like compact-list.")
    pg = f"{screen}/{name}"
    folder = DATA / pg
    if (folder / "versions.json").exists():
        sys.exit(f"{pg} exists already.")
    folder.mkdir(parents=True)
    write_json(folder / "versions.json", {
        "title": title,
        "about": about,
        "start": screen,
        "versions": [{
            "id": "default", "name": "As it is", "date": time.strftime("%Y-%m-%d"),
            "note": f"The {screens()[screen]['title']} screen as the app has it.",
        }],
    })
    index = read_json(INDEX, {"playgrounds": []})
    index.setdefault("playgrounds", []).append(pg)
    write_json(INDEX, index)
    write_registry()
    print(f"Started {pg} in {rel(folder)}/. Next: python3 playground/duplicate.py {pg} default \"Name\"")


if __name__ == "__main__":
    with playground_lock():  # other chats may be making versions too
        main(sys.argv[1:])
