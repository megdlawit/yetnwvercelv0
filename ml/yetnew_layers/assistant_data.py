"""Training and test data for the map-editor assistant — generated, so every
label is correct by construction (the request is written FROM its answer).

Who it is for: venue managers who are not architects and not CAD users. The
requests are written the way they type: casual ("hey can u…"), short, with
typos and lower-case names, "this / it / here", questions about the map, and
requests that are unclear or name places that don't exist (→ no actions, one
question back).

Each example is a request body exactly like the editor sends (text, history,
context with the map "brief" in the editor's format — see brief() in
src/lib/assistant/engine.ts) plus the expected actions and reply. Rows are
built with assistant.training_example(), the same prompt the service uses.

Test split: whole phrasing TEMPLATES are held out (about 1 in 5 per action),
and whole generated venues too, so the score measures new wordings on new
maps — not memorised sentences. English only for now: Amharic examples need a
native speaker to write and check them (see README).
"""

from __future__ import annotations

import json
import random
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable

from .assistant import training_example

# ── Synthetic venues ─────────────────────────────────────────────────────────

VENUE_TYPES: dict[str, dict[str, list[str]]] = {
    "museum": {"rooms": ["Main Hall", "Gallery 1", "Gallery 2", "Gift Shop", "Cafe", "Ticket Office", "Archive", "Lecture Room"],
               "places": ["Main Entrance", "Info Desk", "Coat Check", "Exhibit A", "Exhibit B"]},
    "hospital": {"rooms": ["Reception", "Emergency", "Pharmacy", "Ward A", "Ward B", "X-Ray", "Lab", "Waiting Room"],
                 "places": ["Main Entrance", "Triage Desk", "Ambulance Bay", "Chapel"]},
    "park": {"rooms": ["Visitor Center", "Kiosk", "Playground", "Picnic Area", "Toilets"],
             "places": ["North Gate", "South Gate", "Fountain", "Viewpoint", "Pond"]},
    "campus": {"rooms": ["Library", "Lab 101", "Lab 102", "Auditorium", "Canteen", "Admin Office", "Room 204"],
               "places": ["Main Gate", "Bus Stop", "Notice Board", "Student Desk"]},
    "mall": {"rooms": ["Food Court", "Shop 12", "Shop 14", "Supermarket", "Cinema Lobby", "Pharmacy", "ATM Corner"],
             "places": ["East Entrance", "West Entrance", "Information", "Kids Corner"]},
    "office": {"rooms": ["Lobby", "Meeting Room A", "Meeting Room B", "Open Office", "Kitchen", "Server Room", "Room 1", "Room 2"],
               "places": ["Front Desk", "Main Entrance", "Printer", "Waiting Area"]},
}
KIND_OF = {"Reception": "reception", "Lobby": "reception", "Ticket Office": "reception", "Info Desk": "reception",
           "Meeting Room A": "meeting", "Meeting Room B": "meeting", "Lecture Room": "meeting", "Auditorium": "meeting",
           "Toilets": "restroom", "Server Room": "utility", "Archive": "utility", "Kitchen": "utility"}
FLOOR_SETS = [["Ground"], ["Ground", "First"], ["Ground", "First", "Second"], ["Basement", "Ground", "First"], ["Level 0", "Level 1"]]
OBJECTS = ["bench", "tree", "lamp", "door", "window", "planter", "fountain", "elevator", "stairs"]
NEW_PLACES = ["restroom", "reception", "cafe", "exhibit", "entrance", "info desk", "first aid"]
ROOM_KINDS = ["office", "meeting", "restroom", "reception", "utility", "entrance"]
NEW_NAMES = ["Gift Corner", "Prayer Room", "Staff Room", "Lost and Found", "Baby Care", "VIP Lounge", "Security", "Book Shop"]
HEALTH = ["{a} isn't connected to the walking paths", "{a} has no door", "2 paths cross walls"]


@dataclass
class Venue:
    kind: str
    floors: list[str]
    floor: str
    rooms: list[tuple[str, str, float, float, float, float, bool]]  # name, kind, w, d, x, y, reachable
    places: list[tuple[str, float, float, bool]]
    objects: list[tuple[str, str, float, float]]                      # label, kind, x, y
    selection: str | None = None
    last: str | None = None
    click: tuple[float, float] | None = None
    health: list[str] = field(default_factory=list)

    @property
    def names(self) -> list[str]:
        return [r[0] for r in self.rooms] + [p[0] for p in self.places]

    def brief(self) -> str:
        """The map summary in the editor's format (engine.ts brief())."""
        out = [f"Floors (low→high): {'; '.join(f'{f} [level {i}{', OPEN' if f == self.floor else ''}]' for i, f in enumerate(self.floors))}"]
        out.append(f"Rooms on this floor ({len(self.rooms)}) — name | kind | size m | centre x,y m | reachable:")
        out += [f"- {n} | {k} | {w:.1f}×{d:.1f} | {x:.1f},{y:.1f} | {'yes' if r else 'no'}" for n, k, w, d, x, y, r in self.rooms]
        out.append(f"Other places ({len(self.places)}) — name | x,y m | reachable:")
        out += [f"- {n} | {x:.1f},{y:.1f} | {'yes' if r else 'no'}" for n, x, y, r in self.places]
        counts = Counter(k for _, k, _, _ in self.objects)
        out.append(f"Objects ({len(self.objects)}): {', '.join(f'{n} {k}' for k, n in counts.items()) or 'none'}")
        out += [f"- {lbl} | {k} | {x:.1f},{y:.1f}" for lbl, k, x, y in self.objects if k in ("elevator", "stairs", "entrance") or lbl != k]
        out.append(f"Walls: {random.Random(len(self.rooms)).randint(20, 300)}")
        out.append(f"Walking paths: {len(self.rooms) * 3} segments in {1 + sum(not r[6] for r in self.rooms)} network(s); 0 floor links (none)")
        out.append(f"Selected: {self.selection or 'nothing'}")
        out.append(f"Last click (\"here\"): {f'{self.click[0]:.1f},{self.click[1]:.1f} m' if self.click else 'none'}; screen centre 20.0,15.0 m")
        out.append(f"Health: {'; '.join(self.health) if self.health else 'all good'}")
        return "\n".join(out)

    def body(self, text: str, history: list[dict[str, str]] | None = None) -> dict[str, Any]:
        return {"text": text, "history": history or [],
                "context": {"floor": self.floor, "floors": self.floors, "places": self.names, "selection": self.selection,
                            "last": self.last, "brief": self.brief()}}


def make_venue(rng: random.Random) -> Venue:
    vtype = rng.choice(list(VENUE_TYPES))
    pool = VENUE_TYPES[vtype]
    rooms_n = rng.sample(pool["rooms"], k=rng.randint(4, len(pool["rooms"])))
    places_n = rng.sample(pool["places"], k=rng.randint(2, len(pool["places"])))
    rooms = [(n, KIND_OF.get(n, "office"), rng.choice([4, 5, 6, 8, 10, 12]), rng.choice([3, 4, 5, 6, 8]),
              rng.uniform(2, 60), rng.uniform(2, 40), rng.random() > 0.2) for n in rooms_n]
    places = [(n, rng.uniform(2, 60), rng.uniform(2, 40), rng.random() > 0.15) for n in places_n]
    objs = [(k, k, rng.uniform(2, 60), rng.uniform(2, 40)) for k in rng.sample(OBJECTS, k=rng.randint(1, 5))]
    floors = rng.choice(FLOOR_SETS)
    unreachable = [r[0] for r in rooms if not r[6]] + [p[0] for p in places if not p[3]]
    health = [HEALTH[0].format(a=u) for u in unreachable[:3]]
    return Venue(vtype, floors, rng.choice(floors), rooms, places, objs, health=health)


# ── Request templates ────────────────────────────────────────────────────────
# A template: (id, sentence builder, answer builder). Builders get (venue, rng, slots).

Action = dict[str, Any]
Answer = tuple[list[Action], str | None]


@dataclass
class Template:
    id: str
    op: str
    make: Callable[[Venue, random.Random], tuple[str, Answer, dict[str, Any]] | None]


def _two(v: Venue, rng: random.Random) -> tuple[str, str]:
    a, b = rng.sample(v.names, 2)
    return a, b


def _casual(name: str, rng: random.Random) -> str:
    """How a person might type an existing name: often lower case."""
    return name.lower() if rng.random() < 0.5 else name


T: list[Template] = []


def tpl(id: str, op: str):
    def deco(fn: Callable[[Venue, random.Random], tuple[str, Answer, dict[str, Any]] | None]):
        T.append(Template(id, op, fn))
        return fn
    return deco


def simple(id: str, op: str, sentences: list[str], answer: Callable[[dict[str, str]], Answer], slots: Callable[[Venue, random.Random], dict[str, str] | None]):
    """Register one template per sentence (each sentence is its own phrasing family)."""
    for i, sentence in enumerate(sentences):
        def make(v: Venue, rng: random.Random, sentence: str = sentence) -> tuple[str, Answer, dict[str, Any]] | None:
            s = slots(v, rng)
            if s is None:
                return None
            shown = {k: (_casual(val, rng) if k in ("A", "B", "X") else val) for k, val in s.items()}
            return sentence.format(**shown), answer(s), {}
        T.append(Template(f"{id}.{i}", op, make))


def two_places(v: Venue, rng: random.Random) -> dict[str, str]:
    a, b = _two(v, rng)
    return {"A": a, "B": b}


def one_place(v: Venue, rng: random.Random) -> dict[str, str]:
    return {"X": rng.choice(v.names)}


def one_room(v: Venue, rng: random.Random) -> dict[str, str]:
    return {"X": rng.choice(v.rooms)[0]}


simple("connect", "connect", [
    "connect {A} to {B}", "make a path from {A} to {B}", "people need to walk from {A} to {B}",
    "link {A} and {B}", "can u join {A} with {B}", "add a walkway between {A} and {B}",
    "visitors cant get from {A} to {B}, fix that",
], lambda s: ([{"op": "connect", "from": s["A"], "to": s["B"]}], None), two_places)

simple("connect_acc", "connect", [
    "wheelchair route from {A} to {B}", "make a step free way from {A} to {B}", "accessible path {A} to {B} please",
], lambda s: ([{"op": "connect", "from": s["A"], "to": s["B"], "accessible": True}], None), two_places)

simple("disconnect", "disconnect", [
    "remove the path between {A} and {B}", "{A} and {B} shouldnt be connected", "cut the link between {A} and {B}",
], lambda s: ([{"op": "disconnect", "a": s["A"], "b": s["B"]}], None), two_places)

simple("block", "block", [
    "nobody should walk through {X}", "close {X} for visitors walking", "block {X}", "no paths through {X} pls",
], lambda s: ([{"op": "block", "target": s["X"]}], None), one_room)

simple("walkable", "walkable", [
    "make {X} reachable", "{X} isnt connected, connect it to the paths", "put {X} on the walking routes",
], lambda s: ([{"op": "walkable", "target": s["X"]}], None), one_place)


def add_slots(v: Venue, rng: random.Random) -> dict[str, str]:
    return {"W": rng.choice(OBJECTS + NEW_PLACES), "A": rng.choice(v.names)}


simple("add_near", "add", [
    "put a {W} near {A}", "add a {W} next to {A}", "we need a {W} by {A}", "i want a {W} close to {A}",
], lambda s: ([{"op": "add", "what": s["W"], "near": s["A"]}], None), add_slots)

simple("add_here", "add", [
    "add a {W} here", "put a {W} right here", "{W} here pls",
], lambda s: ([{"op": "add", "what": s["W"], "near": "here"}], None), lambda v, rng: {"W": rng.choice(OBJECTS + NEW_PLACES)})

simple("add_named", "add", [
    "add a cafe called {N} near {A}", "new cafe named {N} next to {A}",
], lambda s: ([{"op": "add", "what": "cafe", "name": s["N"], "near": s["A"]}], None),
    lambda v, rng: {"N": rng.choice(NEW_NAMES), "A": rng.choice(v.names)})


def room_slots(v: Venue, rng: random.Random) -> dict[str, str]:
    return {"K": rng.choice(ROOM_KINDS), "W": str(rng.choice([3, 4, 5, 6, 8])), "D": str(rng.choice([3, 4, 5, 6])),
            "A": rng.choice(v.names), "S": rng.choice(["left", "right", "up", "down"])}


simple("add_room", "add_room", [
    "make a {K} room {W} by {D} next to {A}", "add a {W}x{D} {K} room near {A}", "new {K} room, {W} by {D} metres, beside {A}",
], lambda s: ([{"op": "add_room", "kind": s["K"], "width": float(s["W"]), "depth": float(s["D"]), "near": s["A"]}], None), room_slots)

simple("add_room_side", "add_room", [
    "add a {K} room to the {S} of {A}", "put a {K} room on the {S} side of {A}",
], lambda s: ([{"op": "add_room", "kind": s["K"], "near": s["A"], "side": s["S"]}], None), room_slots)

simple("set_type", "set_type", [
    "{X} is actually a {K}", "change {X} to a {K} room", "{X} should be a {K}",
], lambda s: ([{"op": "set_type", "target": s["X"], "kind": s["K"]}], None),
    lambda v, rng: {"X": rng.choice(v.rooms)[0], "K": rng.choice(ROOM_KINDS)})

simple("move_near", "move", [
    "move {X} next to {A}", "put {X} beside {A}", "{X} should be near {A}",
], lambda s: ([{"op": "move", "target": s["X"], "near": s["A"]}], None), lambda v, rng: dict(zip(("X", "A"), _two(v, rng))))

simple("move_dir", "move", [
    "move {X} a little to the {S}", "shift {X} {S} a bit", "move {X} way {S}",
], lambda s: ([{"op": "move", "target": s["X"], "direction": s["S"], "amount": "lot" if s["L"] else "little"}], None),
    lambda v, rng: {"X": rng.choice(v.names), "S": rng.choice(["left", "right", "up", "down"]), "L": ""})
# "way {S}" means a lot: give that sentence its own answer.
T[-1] = Template("move_dir.2", "move", lambda v, rng: (lambda x, s: (f"move {_casual(x, rng)} way {s}", ([{"op": "move", "target": x, "direction": s, "amount": "lot"}], None), {}))(
    rng.choice(v.names), rng.choice(["left", "right", "up", "down"])))

simple("rename", "rename", [
    "rename {X} to {N}", "call {X} {N} instead", "{X} should be named {N}", "change the name of {X} to {N}",
    "let's call {X} {N}", "{X} is now called {N}", "{X} should be called {N}", "name {X} {N}", "change {X}'s name to {N}",
    "i want {X} to be called {N}", "{X} has a new name: {N}", "give {X} the name {N}",
], lambda s: ([{"op": "rename", "target": s["X"], "name": s["N"]}], None),
    lambda v, rng: {"X": rng.choice(v.names), "N": rng.choice(NEW_NAMES)})

simple("remove", "remove", [
    "delete {X}", "get rid of {X}", "remove {X} from the map", "{X} doesnt exist anymore, take it out",
], lambda s: ([{"op": "remove", "target": s["X"]}], None), one_place)

simple("show", "show", [
    "where is {X}", "find {X}", "show me {X}", "wheres {X}??",
], lambda s: ([{"op": "show", "target": s["X"]}], None), one_place)

simple("describe", "describe", [
    "tell me about {X}", "what do you know about {X}", "details of {X}",
], lambda s: ([{"op": "describe", "target": s["X"]}], None), one_place)

simple("measure", "measure", [
    "how far is {A} from {B}", "distance between {A} and {B}", "how long does it take to walk from {A} to {B}",
], lambda s: ([{"op": "measure", "from": s["A"], "to": s["B"]}], None), two_places)

simple("resize_scale", "resize", [
    "make {X} bigger", "{X} is too small, enlarge it", "make {X} a bit larger",
    "increase the size of {X}", "{X} should be bigger", "can {X} be a little bigger", "{X} needs more space",
    "make {X} larger", "make {X} a bit bigger", "{X} needs to be bigger", "enlarge {X}", "{X} bigger please", "grow {X} a little",
], lambda s: ([{"op": "resize", "target": s["X"], "scale": 1.25}], None), one_room)

simple("resize_small", "resize", [
    "make {X} smaller", "shrink {X} a bit", "{X} is too big", "{X} should be a bit smaller",
], lambda s: ([{"op": "resize", "target": s["X"], "scale": 0.8}], None), one_room)

simple("resize_size", "resize", [
    "make {X} {W} by {D}", "{X} should be {W}x{D} metres",
], lambda s: ([{"op": "resize", "target": s["X"], "width": float(s["W"]), "depth": float(s["D"])}], None),
    lambda v, rng: {"X": rng.choice(v.rooms)[0], "W": str(rng.choice([4, 5, 6, 8, 10])), "D": str(rng.choice([3, 4, 5, 6]))})

simple("rotate", "rotate", [
    "turn {X} {G} degrees", "rotate {X} by {G}",
], lambda s: ([{"op": "rotate", "target": s["X"], "degrees": float(s["G"])}], None),
    lambda v, rng: {"X": rng.choice(v.names), "G": str(rng.choice([15, 30, 45, 90, 180]))})

simple("duplicate", "duplicate", [
    "copy {X}", "make another one like {X}", "duplicate {X}",
], lambda s: ([{"op": "duplicate", "target": s["X"]}], None), one_place)

simple("walls_height", "set_3d", [
    "walls should be {H} meters high", "make all the walls {H}m tall", "wall height {H}",
    "change the height of the walls to {H}", "raise all walls to {H}m", "walls need to be {H} metres", "set the walls to {H} m high",
    "all walls {H} meters", "{H} m walls everywhere", "wall heights should be {H}", "every wall {H}m high",
], lambda s: ([{"op": "set_3d", "target": "walls", "field": "height", "value": s["H"]}], None),
    lambda v, rng: {"H": rng.choice(["2.5", "3", "3.5", "4"])})

simple("room_floor", "set_3d", [
    "the floor of {X} is {M}", "make {X} floor {M}",
], lambda s: ([{"op": "set_3d", "target": s["X"], "field": "floor_material", "value": s["M"]}], None),
    lambda v, rng: {"X": rng.choice(v.rooms)[0], "M": rng.choice(["tile", "wood", "carpet", "marble", "concrete"])})

FIXED: list[tuple[str, str, list[str], Answer]] = [
    ("fix_all", "fix_all", ["fix everything", "just fix all the problems", "can you clean up the map", "fix what u can"], ([{"op": "fix_all"}], None)),
    ("health", "health", ["whats wrong with my map", "any problems?", "is my map ready", "check the map for me"], ([{"op": "health"}], None)),
    ("undo", "undo", ["undo", "oops undo that", "go back", "no no revert that"], ([{"op": "undo"}], None)),
    ("redo", "redo", ["redo", "bring that back", "redo what i undid", "undo the undo", "actually i want that change again"], ([{"op": "redo"}], None)),
    ("view3d", "view", ["show it in 3d", "3d view", "can i see it in 3D"], ([{"op": "view", "mode": "3d"}], None)),
    ("view2d", "view", ["back to 2d", "flat view please", "2d"], ([{"op": "view", "mode": "2d"}], None)),
    ("fit", "fit", ["show everything", "zoom to fit", "i cant see the whole map"], ([{"op": "fit"}], None)),
    ("grid_on", "setting", ["turn on the grid", "show grid"], ([{"op": "setting", "setting": "grid", "on": True}], None)),
    ("snap_off", "setting", ["turn snapping off", "stop snapping"], ([{"op": "setting", "setting": "snap", "on": False}], None)),
    ("tool_wall", "tool", ["i want to draw walls", "wall tool", "let me draw a wall"], ([{"op": "tool", "tool": "wall"}], None)),
    ("tool_path", "tool", ["let me draw a path", "path tool", "i want to draw walking paths", "give me the path drawing tool", "draw walkways",
                           "use the path tool", "switch to the path tool", "open the path tool", "paths tool please", "i want the tool for paths", "path drawing"], ([{"op": "tool", "tool": "add-edge"}], None)),
    ("select_all", "select", ["select everything", "select all"], ([{"op": "select", "target": "all"}], None)),
    ("publish", "publish", ["publish it", "make it live for visitors", "im done, publish the map", "go live", "share the map with visitors now",
                          "make the map live", "put it live", "make it public", "let visitors see it", "release the map", "publish my map please"], ([{"op": "publish"}], None)),
    ("open_import", "open", ["import my floor plan", "i have a dwg file, upload it", "bring in my cad drawing"], ([{"op": "open", "panel": "import"}], None)),
    ("open_floor", "open", ["add a new floor", "i need another level", "create another floor", "new floor please", "we need one more level",
                           "add another storey", "make a new level", "i want to add a floor", "one more floor"], ([{"op": "open", "panel": "add_floor"}], None)),
    ("open_world", "open", ["put the venue on the world map", "where is my building on the real map"], ([{"op": "open", "panel": "world_map"}], None)),
    ("access_check", "accessible", ["check wheelchair access", "is the map step free?"], ([{"op": "accessible"}], None)),
    ("list_rooms", "list", ["list all rooms", "what rooms do i have", "how many rooms are there"], ([{"op": "list", "what": "rooms"}], None)),
    ("list_restrooms", "list", ["how many restrooms are there", "where are the toilets", "where are the restrooms", "where can i find a toilet",
                                "show me the toilets", "list the bathrooms", "any wc on this floor"], ([{"op": "list", "what": "restrooms"}], None)),
]
for _id, _op, _sentences, _answer in FIXED:
    for _i, _s in enumerate(_sentences):
        T.append(Template(f"{_id}.{_i}", _op, lambda v, rng, s=_s, a=_answer: (s, (json.loads(json.dumps(a[0])), a[1]), {})))


def floors_slots(v: Venue, rng: random.Random) -> dict[str, str] | None:
    return {"V": rng.choice(["elevator", "stairs"])} if len(v.floors) > 1 else None


simple("connect_floors", "connect_floors", [
    "link the floors with the {V}", "the {V} goes between the floors", "connect floors using the {V}",
], lambda s: ([{"op": "connect_floors", "via": s["V"]}], None), floors_slots)


def go_floor_slots(v: Venue, rng: random.Random) -> dict[str, str] | None:
    others = [f for f in v.floors if f != v.floor]
    return {"F": rng.choice(others)} if others else None


simple("go_floor", "go_floor", ["go to {F}", "show me the {F} floor", "switch to {F}"],
       lambda s: ([{"op": "go_floor", "floor": s["F"]}], None), go_floor_slots)


# References: "this" (selected), "it" (just talked about).
@tpl("this_rename", "rename")
def _this_rename(v: Venue, rng: random.Random):
    v.selection = rng.choice(v.rooms)[0]
    n = rng.choice(NEW_NAMES)
    s = rng.choice(["rename this to {N}", "call this one {N}", "this is the {N}"]).format(N=n)
    return s, ([{"op": "rename", "target": "this", "name": n}], None), {}


@tpl("it_move", "move")
def _it_move(v: Venue, rng: random.Random):
    v.last = rng.choice(v.names)
    a = rng.choice([n for n in v.names if n != v.last])
    return f"move it next to {_casual(a, rng)}", ([{"op": "move", "target": "it", "near": a}], None), {
        "history": [{"who": "me", "text": f"where is {v.last}"}, {"who": "map", "text": f"Here's {v.last}."}]}


# Several requests in one sentence.
@tpl("multi_connect", "connect")
def _multi(v: Venue, rng: random.Random):
    a, b, c, d = rng.sample(v.names, 4) if len(v.names) >= 4 else (None,) * 4
    if a is None:
        return None
    return (f"connect {_casual(a, rng)} to {_casual(b, rng)} and {_casual(c, rng)} to {_casual(d, rng)}",
            ([{"op": "connect", "from": a, "to": b}, {"op": "connect", "from": c, "to": d}], None), {})


@tpl("multi_remove", "remove")
def _multi_remove(v: Venue, rng: random.Random):
    a, b = _two(v, rng)
    return f"delete {_casual(a, rng)} and {_casual(b, rng)}", ([{"op": "remove", "target": a}, {"op": "remove", "target": b}], None), {}


# Questions answered from the summary (no actions, a reply).
@tpl("q_unreachable", "reply")
def _q_unreachable(v: Venue, rng: random.Random):
    bad = [r[0] for r in v.rooms if not r[6]] + [p[0] for p in v.places if not p[3]]
    q = rng.choice(["which rooms arent connected?", "is everything reachable?", "what places cant visitors get to"])
    reply = (f"These aren't connected to the walking paths yet: {', '.join(bad)}." if bad else "Everything is connected to the walking paths.")
    return q, ([], reply), {}


# Unclear, or a place that isn't on the map → no actions, one question back.
@tpl("unclear", "reply")
def _unclear(v: Venue, rng: random.Random):
    q = rng.choice(["connect them", "move that thing", "fix the room", "make it nicer"])
    return q, ([], "Which place do you mean? Tell me its name, or select it on the map first."), {}


@tpl("missing_place", "reply")
def _missing(v: Venue, rng: random.Random):
    ghost = rng.choice([n for n in ("Cinema", "Swimming Pool", "Rooftop Bar", "Helipad", "Zoo") if n not in v.names])
    a = rng.choice(v.names)
    return (f"connect {_casual(a, rng)} to the {ghost.lower()}",
            ([], f"I can't find {ghost} on this floor. Which place did you mean, or should I add it first?"), {})


# ── More phrasings (2026-10-19) ──────────────────────────────────────────────
# The first fine-tuned model never asked back and never wrote "it": the only
# template for each was held out for testing. These are training-only (the
# held-out set is frozen, HELD_OUT), different wordings of the same behaviours.

UNCLEAR_REPLY = "Which place do you mean? Tell me its name, or select it on the map first."
TALKED_ABOUT = [("where is {x}", "Here's {x}."), ("tell me about {x}", "{x} is on this floor."), ("find {x}", "Here's {x}.")]


def _talked_about(v: Venue, rng: random.Random) -> list[dict[str, str]]:
    v.last = rng.choice(v.names)
    q, a = rng.choice(TALKED_ABOUT)
    return [{"who": "me", "text": q.format(x=_casual(v.last, rng))}, {"who": "map", "text": a.format(x=v.last)}]


def ask_back(id: str, sentences: list[str]) -> None:
    """Nothing selected, nothing talked about: "it", "them", "the room" point at nothing → ask."""
    for i, sentence in enumerate(sentences):
        T.append(Template(f"{id}.{i}", "reply", lambda v, rng, s=sentence: (s, ([], UNCLEAR_REPLY), {})))


ask_back("ask_back", ["connect those", "join them up", "fix that room", "sort out the room", "move the thing over there",
                      "make that place better", "change it", "delete that one", "put that somewhere else", "make it bigger",
                      "rename it", "can you improve this area"])


def it_family(id: str, op: str, sentences: list[str], answer: Callable[[dict[str, str]], list[Action]]) -> None:
    """ "it" = what the conversation just talked about: the target is written "it"."""
    for i, sentence in enumerate(sentences):
        def make(v: Venue, rng: random.Random, sentence: str = sentence):
            history = _talked_about(v, rng)
            slots = {"A": rng.choice([n for n in v.names if n != v.last]), "N": rng.choice(NEW_NAMES)}
            return sentence.format(A=_casual(slots["A"], rng), N=slots["N"]), (answer(slots), None), {"history": history}
        T.append(Template(f"{id}.{i}", op, make))


def this_family(id: str, op: str, sentences: list[str], answer: Callable[[dict[str, str]], list[Action]]) -> None:
    """ "this" = what's selected: the target is written "this"."""
    for i, sentence in enumerate(sentences):
        def make(v: Venue, rng: random.Random, sentence: str = sentence):
            v.selection = rng.choice(v.rooms)[0]
            slots = {"A": rng.choice([n for n in v.names if n != v.selection]), "N": rng.choice(NEW_NAMES)}
            return sentence.format(A=_casual(slots["A"], rng), N=slots["N"]), (answer(slots), None), {}
        T.append(Template(f"{id}.{i}", op, make))


it_family("it_near", "move", ["put it beside {A}", "it should go near {A}", "can you move it close to {A}"],
          lambda s: [{"op": "move", "target": "it", "near": s["A"]}])
it_family("it_remove", "remove", ["delete it", "get rid of it", "remove it please"], lambda s: [{"op": "remove", "target": "it"}])
it_family("it_bigger", "resize", ["make it bigger", "make it a bit larger"], lambda s: [{"op": "resize", "target": "it", "scale": 1.25}])
it_family("it_rename", "rename", ["rename it to {N}", "call it {N}"], lambda s: [{"op": "rename", "target": "it", "name": s["N"]}])
it_family("it_connect", "connect", ["connect it to {A}", "make a path from it to {A}"],
          lambda s: [{"op": "connect", "from": "it", "to": s["A"]}])
it_family("it_describe", "describe", ["tell me more about it", "what else do you know about it"],
          lambda s: [{"op": "describe", "target": "it"}])

this_family("this_near", "move", ["move this next to {A}", "put this beside {A}"], lambda s: [{"op": "move", "target": "this", "near": s["A"]}])
this_family("this_remove", "remove", ["delete this", "remove this one"], lambda s: [{"op": "remove", "target": "this"}])
this_family("this_bigger", "resize", ["make this bigger", "this is too small"], lambda s: [{"op": "resize", "target": "this", "scale": 1.25}])
this_family("this_connect", "connect", ["connect this to {A}"], lambda s: [{"op": "connect", "from": "this", "to": s["A"]}])
this_family("this_copy", "duplicate", ["copy this", "duplicate this one"], lambda s: [{"op": "duplicate", "target": "this"}])


# ── v3 (2026-10-20): what v2 still got wrong, and what the chat answers itself ──

def _the(name: str, rng: random.Random) -> str:
    """ "the café", "the lobby": how people often name a place (new families only)."""
    return "the " + name.lower() if rng.random() < 0.5 else _casual(name, rng)


@tpl("bigger_the", "resize")
def _bigger_the(v: Venue, rng: random.Random):
    x = rng.choice(v.rooms)[0]
    s = rng.choice(["make {X} bigger please", "i think {X} should be bigger", "{X} is too small", "can you make {X} bigger"]).format(X=_the(x, rng))
    return s, ([{"op": "resize", "target": x, "scale": 1.25}], None), {}


@tpl("smaller_the", "resize")
def _smaller_the(v: Venue, rng: random.Random):
    x = rng.choice(v.rooms)[0]
    s = rng.choice(["make {X} smaller", "{X} is too big", "can you shrink {X}"]).format(X=_the(x, rng))
    return s, ([{"op": "resize", "target": x, "scale": 0.8}], None), {}


@tpl("rename_kindlike", "rename")
def _rename_kindlike(v: Venue, rng: random.Random):
    # New names that look like room kinds ("Staff Room", "Prayer Room") are still names: rename, not set_type.
    x = rng.choice(v.names)
    n = rng.choice(["Staff Room", "Prayer Room", "Meeting Room", "Store Room", "Office 3", "Reception Desk"])
    s = rng.choice(["call {X} {N}", "{X} should be called {N}", "rename {X} as {N}", "name it {N} instead, i mean {X}"]).format(X=_casual(x, rng), N=n)
    return s, ([{"op": "rename", "target": x, "name": n}], None), {}


# Small talk and questions about Yet New: the editor answers these itself (smalltalk.ts,
# knowledge.ts); when one slips through to the model it answers in words, never with an action.
CASUAL = [
    ("how are u today", "I'm doing great, thanks for asking! What would you like to change on the map?"),
    ("hows your day going", "I'm doing great, thanks for asking! What would you like to change on the map?"),
    ("hope you're doing well", "I'm doing great, thanks! What would you like to change on the map?"),
    ("im a bit lost here", "No problem — tell me what you want on the map in your own words, like “add a restroom near the lobby”, or ask me what something is."),
    ("i have no idea what to do", "No problem — tell me what you want on the map in your own words, like “add a restroom near the lobby”, or ask me what something is."),
    ("you are really helpful", "Thank you! What shall we do next?"),
    ("nice, you did it well", "Thank you! What shall we do next?"),
    ("this is not what i asked for", "Sorry about that! Say “undo” to take back my last change, then tell me again in other words."),
    ("you got it wrong", "Sorry about that! Say “undo” to take back my last change, then tell me again in other words."),
]
KNOWN = [
    ("what does a room mean here", "A room is an enclosed space on a floor — an office, a shop, a restroom. Visitors search for rooms by name and get directions to them."),
    ("whats the point of walking paths", "Walkable paths are the lines visitors’ directions follow, along corridors and through doors. Every place must be connected to them."),
    ("so how does publishing work", "Publishing puts your map live for visitors — say “publish”. A new institution’s first publish is checked by the Yet New team."),
    ("what file types can i import", "Import CAD takes DWG, DXF, PDF, IFC or a 3D model; a sheet with several floor plans becomes several floors."),
    ("whats a cad layer", "CAD drawings keep different things on different layers — walls, doors, furniture. Yet New suggests what each layer is when you import."),
    ("what happens when i fix everything", "“Fix everything” repairs what would stop visitors being guided — places off the paths, paths through walls — and tells you what's left."),
    ("what is yet new for", "Yet New makes indoor and outdoor maps that walk people to the door: you build your venue's map here, visitors use it to find their way."),
]
for _i, (_q, _a) in enumerate(CASUAL):
    T.append(Template(f"casual.{_i}", "reply", lambda v, rng, q=_q, a=_a: (q, ([], a), {})))
for _i, (_q, _a) in enumerate(KNOWN):
    T.append(Template(f"known.{_i}", "reply", lambda v, rng, q=_q, a=_a: (q, ([], a), {})))


# ── Noise: how people type ───────────────────────────────────────────────────

PREFIXES = ["", "", "", "hey ", "pls ", "can you ", "ok ", "hi, ", "quick one: "]


def typo(text: str, rng: random.Random, protected: list[str]) -> str:
    """One small typo in a word that isn't a place name (names must stay findable)."""
    words = text.split(" ")
    safe = [i for i, w in enumerate(words) if len(w) > 3 and w.isalpha() and not any(w.lower() in p.lower() for p in protected)]
    if not safe:
        return text
    i = rng.choice(safe)
    w = words[i]
    j = rng.randrange(1, len(w) - 1)
    words[i] = w[:j] + w[j + 1:] if rng.random() < 0.5 else w[:j] + w[j + 1] + w[j] + w[j + 2:]
    return " ".join(words)


# ── Building the set ─────────────────────────────────────────────────────────

#: The held-out phrasings, frozen 2026-10-19 (spec 2): the 32 that split_templates() chose
#: before more phrasings were added. Templates added later always go to training, so
#: test.jsonl and test_fresh*.jsonl stay the same requests and scores stay comparable.
HELD_OUT = frozenset({
    "add_here.1", "add_named.0", "add_room.1", "block.2", "connect.0", "connect_floors.1", "describe.0", "disconnect.1",
    "duplicate.0", "fit.1", "fix_all.3", "go_floor.1", "grid_on.0", "health.3", "it_move", "list_restrooms.1",
    "measure.1", "multi_connect", "open_floor.0", "publish.1", "redo.1", "remove.2", "rename.1", "resize_scale.0",
    "set_type.0", "show.1", "tool_path.1", "unclear", "undo.2", "view2d.0", "walkable.2", "walls_height.2",
})


def held_out(templates: list[Template], seed: str) -> set[str]:
    """HELD_OUT for the standard seed; another seed gets its own split (a different experiment)."""
    if seed == "yetnew-assistant":
        missing = HELD_OUT - {t.id for t in templates}
        assert not missing, f"held-out templates were removed or renumbered: {sorted(missing)}"
        return set(HELD_OUT)
    return split_templates(templates, seed)


def split_templates(templates: list[Template], seed: str, test_share: float = 0.2) -> set[str]:
    """Template ids held out for testing: ~test_share per action (at least one when it has 3+)."""
    by_op: dict[str, list[str]] = {}
    for t in templates:
        by_op.setdefault(t.op, []).append(t.id)
    held: set[str] = set()
    for op, ids in sorted(by_op.items()):
        if len(ids) < 3:
            continue
        rng = random.Random(f"{seed}:{op}")
        k = max(1, round(len(ids) * test_share))
        held |= set(rng.sample(sorted(ids), k))
    return held


def generate(n_train: int = 2500, n_test: int = 300, seed: str = "yetnew-assistant", num_ctx: int = 8192,
             test_draw: str = "") -> tuple[list[dict], list[dict], dict]:
    """test_draw: a different, fresh draw of test requests — the same held-out phrasings,
    new maps, names and typos (for a clean re-measurement after looking at results)."""
    held = held_out(T, seed)
    train_t = [t for t in T if t.id not in held]
    test_t = [t for t in T if t.id in held]
    rows: dict[str, list[dict]] = {"train": [], "test": []}
    for part, templates, n in (("train", train_t, n_train), ("test", test_t, n_test)):
        rng = random.Random(f"{seed}:{part}{test_draw if part == 'test' else ''}")
        while len(rows[part]) < n:
            v = make_venue(rng)
            t = rng.choice(templates)
            made = t.make(v, rng)
            if made is None:
                continue
            text, (actions, reply), extra = made
            prefix = rng.choice(PREFIXES)
            noisy = rng.random() < 0.25
            text = prefix + text
            if noisy:
                text = typo(text, rng, v.names)
            body = v.body(text, extra.get("history"))
            rows[part].append({**training_example(body, actions, reply, num_ctx), "template": t.id, "op": t.op,
                               "venue_type": v.kind, "body": body, "actions": actions, "reply": reply,
                               "clean": not prefix and not noisy})
    manifest = {
        "synthetic": True,  # generated — labels correct by construction; no customer data
        "seed": seed, "templates": len(T), "held_out_templates": sorted(held),
        "examples": {k: len(v) for k, v in rows.items()},
        "ops": {k: dict(Counter(r["op"] for r in v)) for k, v in rows.items()},
    }
    return rows["train"], rows["test"], manifest
