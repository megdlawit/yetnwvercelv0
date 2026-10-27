import React from 'react';
import DocsShell from '@/components/docs/DocsShell';
import {
  DocsEyebrow, DocsTitle, DocsDescription, DocsH2, DocsH3, DocsP, DocsList, DocsListItem, DocsInlineCode, DocsKbd,
  DocsSteps, DocsStep, DocsCallout, DocsTable, DocsFaq,
} from '@/components/docs/DocsTypography';

const DocsInstitutions: React.FC = () => (
  <DocsShell>
    <DocsEyebrow>Guide · Institutions</DocsEyebrow>
    <DocsTitle>Build, publish and share your venue map</DocsTitle>
    <DocsDescription>
      Everything a museum, park, campus, hospital or mall team needs: from creating the account to the first visitor
      scanning a QR code at your gate.
    </DocsDescription>

    <DocsH2 id="get-started">Get started in six steps</DocsH2>
    <DocsSteps>
      <DocsStep title="Create your institution account">
        Go to <DocsInlineCode>/signup</DocsInlineCode>. Give your institution’s name and pick what kind of place you run —
        park or garden, museum or gallery, heritage site, university or campus, hospital, mall or other. The kind sets
        your first venue’s starting layout (a building with floors, or an outdoor site) and its look. Then choose a
        username and password (at least 8 characters, letters and numbers).
      </DocsStep>
      <DocsStep title="Build your map">
        Open the <b>Map Editor</b>. Import your architect’s drawings, trace over a photo of
        your plan, or draw walls and rooms by hand. Then let the map assistant connect everything (“Fix everything”).
      </DocsStep>
      <DocsStep title="Place it on the world map">
        As soon as the plan is drawn, click <b>Place on world map</b> in the editor (or follow the dashboard’s next step).
        Drag the satellite map until your plan lines up with the real site, turn it, fine-tune its size and save. Visitors then
        see your venue on the real map, their GPS position works with it, and outdoor directions lead them to your door.
      </DocsStep>
      <DocsStep title="Add what visitors look for">
        Under <b>Places</b>, give the important places a description, photos, opening hours and accessibility details.
        Add events, tours and stories under <b>What’s on</b>.
      </DocsStep>
      <DocsStep title="Publish">
        Click <b>Publish</b> (top of the dashboard or the editor). The first publish of a new institution goes to the
        Yet New team for a quick check — usually within a day — then goes live by itself.
      </DocsStep>
      <DocsStep title="Share it">
        Print the QR codes from <b>Share → QR codes</b> for each gate, entrance and attraction, and share your venue
        link. Scanning a code opens your map with “You are here” already set.
      </DocsStep>
    </DocsSteps>
    <DocsCallout tone="tip" title="The dashboard guides you">
      The <b>Home</b> page always shows your next step, a checklist of what’s ready, and recent changes by your team.
      A guided tour is available the first time you open the dashboard and the editor.
    </DocsCallout>

    <DocsH2 id="dashboard">Your dashboard</DocsH2>
    <DocsP>The dashboard (<DocsInlineCode>/dashboard</DocsInlineCode>) has six sections. Related pages are tabs inside each one.</DocsP>
    <DocsTable
      headers={['Section', 'Tabs', 'What it is for']}
      rows={[
        ['Home', 'Home', 'How your venue is doing, your next step, and recent changes.'],
        ['Map', 'Your map · Floors · Areas', 'See your map in 2D/3D, open the editor, add and order floors, name rooms and areas.'],
        ['Places', 'All places · Attractions · Accessibility', 'Everything visitors can find, the highlights shown first, and what each place offers for access.'],
        ['What’s on', 'Events · Tours · Stories · Visitor guides · Announcements · Photos', 'Dated happenings, guided routes, stories about your collection, practical guides, notices, and every photo.'],
        ['Share', 'QR codes · Entrances · Publishing', 'Printable codes, where visitors arrive, and what’s live.'],
        ['Settings', 'Venue · Team', 'Name, description, location, look and 3D map defaults; your team.'],
      ]}
    />
    <DocsP>Use the search box at the top of the dashboard to jump to any place, page or setting.</DocsP>

    <DocsH2 id="map-editor">The map editor</DocsH2>
    <DocsP>
      The editor is where your floors are drawn. Open the <b>Map Editor</b> from the dashboard sidebar or from <b>Map → Your map</b>. Every change saves at
      once and can be undone (<DocsKbd>Ctrl</DocsKbd> <DocsKbd>Z</DocsKbd>); visitors only see it after you publish.
    </DocsP>

    <DocsH3 id="import">Start from a drawing</DocsH3>
    <DocsP>Click <b>Import</b> and drop in a file. Walls, rooms, doors, stairs and lifts are recognised automatically.</DocsP>
    <DocsTable
      headers={['File', 'Notes']}
      rows={[
        ['DWG, DXF', 'AutoCAD drawings. Layers named like walls, doors and rooms are picked up; room labels become names.'],
        ['SVG, PDF', 'Vector floor plans exported from other tools.'],
        ['IFC', 'BIM models — each storey becomes a floor.'],
        ['OBJ, GLB, glTF', '3D models; they are sliced at standing height into a floor plan.'],
        ['Image or scanned PDF', 'Use it as an underlay to trace over: upload, fade, move and lock it, then calibrate by clicking two points and typing their real distance.'],
      ]}
    />
    <DocsP>A drawing with several storeys can be split into floors in one go (<b>Add floors</b>). After an import, the assistant tells you what it found and what to fix first.</DocsP>

    <DocsH3 id="tools">Drawing tools</DocsH3>
    <DocsTable
      headers={['Tool', 'Key', 'How']}
      rows={[
        ['Select', <DocsKbd>V</DocsKbd>, 'Click to select, Shift-click to add, drag on empty space to box-select, drag a selection to move it.'],
        ['Pan', <DocsKbd>H</DocsKbd>, 'Drag the plan (or hold Space with any tool).'],
        ['Wall', <DocsKbd>W</DocsKbd>, 'Click to start, click to end; it keeps going from there. Esc stops.'],
        ['Door', <DocsKbd>O</DocsKbd>, 'Click on a wall to cut a door into it.'],
        ['Room', <DocsKbd>R</DocsKbd>, 'Click the corners; click the first corner or press Enter to finish.'],
        ['Path', <DocsKbd>E</DocsKbd>, 'Click two places to join them with a walkable path.'],
        ['Place (POI)', <DocsKbd>N</DocsKbd>, 'Click to add a place visitors can navigate to.'],
        ['Object', <DocsKbd>B</DocsKbd>, 'Doors, windows, stairs, elevators, entrances, furniture, landmarks.'],
        ['Scenery', <DocsKbd>G</DocsKbd>, 'Trees, palms, shrubs, flowers, lawns, water, rocks, lamps, fountains, planters.'],
        ['Text', <DocsKbd>T</DocsKbd>, 'Click to add a label.'],
        ['Measure · Area', <><DocsKbd>M</DocsKbd> · <DocsKbd>A</DocsKbd></>, 'Measure a distance, or the size of an area.'],
        ['Trim · Extend · Split · Join · Offset', '—', 'CAD-style wall clean-up.'],
        ['Delete', <DocsKbd>D</DocsKbd>, 'Click anything to delete it.'],
      ]}
    />
    <DocsP>
      Other shortcuts: <DocsKbd>Ctrl</DocsKbd> <DocsKbd>D</DocsKbd> duplicate, <DocsKbd>Ctrl</DocsKbd> <DocsKbd>A</DocsKbd> select all,
      <DocsKbd>Del</DocsKbd> delete, <DocsKbd>F</DocsKbd> fit the plan, <DocsKbd>1</DocsKbd> <DocsKbd>2</DocsKbd> <DocsKbd>3</DocsKbd> for 2D, 3D and split view,
      <DocsKbd>G</DocsKbd> grid, <DocsKbd>S</DocsKbd> snapping (hold <DocsKbd>Alt</DocsKbd> to skip it), <DocsKbd>/</DocsKbd> to talk to the assistant.
    </DocsP>

    <DocsH3 id="details-3d">3D details</DocsH3>
    <DocsP>
      Select something and the right-hand panel shows what the 3D world and turn-by-turn guidance need: wall thickness,
      height and material; door, arch and window sizes; which floors stairs and lifts connect, their steps and whether
      they are step-free; a room’s floor finish, ceiling and Amharic name; and the floor’s height above ground and
      ceiling height. Blank fields use sensible defaults.
    </DocsP>

    <DocsH2 id="assistant">The map assistant</DocsH2>
    <DocsP>
      At the bottom of the editor is a conversation bar. Say what you want in plain words; the map does it. Bigger
      changes are shown on the map first with <b>Apply</b> and <b>Cancel</b>, and every change has <b>Undo</b>.
      The badge on the left shows the map’s health — click it to see what needs attention.
    </DocsP>
    <DocsTable
      headers={['You can say', 'What happens']}
      rows={[
        ['“Connect Room 1 and Room 2”', 'Draws a walking route between them, around walls and through doors.'],
        ['“Fix everything”', 'Re-routes paths that cross walls, gives rooms a navigable place, and joins cut-off places to the paths.'],
        ['“Add a 6 by 4 m meeting room called Board Room next to reception”', 'Draws the room, names it, and connects it.'],
        ['“Add a restroom here” · “Put an elevator next to the lobby”', 'Adds a place or object where you last clicked, or beside something.'],
        ['“Make room 3 a restroom” · “Rename it to Gallery 2”', 'Changes a room’s kind or name.'],
        ['“Make room 2 bigger” · “Make it 10 x 5 m” · “Rotate this 90 degrees”', 'Resizes and turns rooms and objects.'],
        ['“Make the walls 3.2 m high” · “Make all walls glass” · “Set the ceiling to 3.5 m”', 'Sets 3D details across the floor in one step.'],
        ['“Connect floor 1 to floor 2 via the elevator”', 'Links the floors so routes can change level.'],
        ['“Check accessibility”', 'Finds floors that can only be reached by stairs.'],
        ['“How far from the entrance to the café?” · “How many restrooms?” · “What’s on this floor?”', 'Answers from your map: distances, walking time, counts and lists.'],
        ['“Show it in 3D” · “Go upstairs” · “Turn off the grid” · “I want to draw walls”', 'Drives the editor itself.'],
        ['“Import a DWG” · “Add another floor” · “Publish”', 'Opens the importer or floor wizard, or publishes.'],
      ]}
    />
    <DocsP>
      Use <b>this</b> for what you’ve selected, <b>it</b> for what you just talked about, and <b>here</b> for where you
      last clicked. Everything is understood right here on your device by Yet New’s own assistant — nothing you type
      is sent to any outside service. Typos are fine (“conect rom 1 and rom 2”): it says what it read. You can write
      in English or Amharic.
    </DocsP>

    <DocsH2 id="places">Places, events and content</DocsH2>
    <DocsH3>Places</DocsH3>
    <DocsP>
      Named rooms and places on your map appear under <b>Places</b> automatically. For each one you can set what
      visitors see: its type, a description and photos (in English and Amharic), opening hours, and whether to
      <b> promote</b> it. Featured and open places are recommended first on your visitors’ home screen.
    </DocsP>
    <DocsH3>Accessibility</DocsH3>
    <DocsP>
      Under <b>Places → Accessibility</b>, tell visitors what each place offers (step-free entry, accessible restrooms
      and so on). It shows on every place, and step-free directions avoid stairs automatically when elevators or ramps
      link your floors.
    </DocsP>
    <DocsH3>What’s on</DocsH3>
    <DocsList>
      <DocsListItem><b>Events</b> and <b>announcements</b> have dates; they show while they’re current and disappear after.</DocsListItem>
      <DocsListItem><b>Tours</b> are ordered stops through your venue that visitors can follow.</DocsListItem>
      <DocsListItem><b>Stories</b>, <b>visitor guides</b> and <b>educational</b> pieces add depth to places and collections.</DocsListItem>
      <DocsListItem><b>Photos</b> collects every image you’ve added to places and stories.</DocsListItem>
    </DocsList>

    <DocsH2 id="sharing">QR codes, entrances and links</DocsH2>
    <DocsP>
      Add an <b>entry point</b> for every gate, door and parking area under <b>Share → Entrances</b>, then print its QR
      code from <b>Share → QR codes</b>. Visitors who scan it start with “You are here” at that spot. Codes can also
      open a single attraction.
    </DocsP>
    <DocsTable
      headers={['Link', 'Opens']}
      rows={[
        [<DocsInlineCode>/venue/&lt;id&gt;</DocsInlineCode>, 'Your venue’s map.'],
        [<DocsInlineCode>?entry=&lt;place&gt;</DocsInlineCode>, '“You are here” at an entry point (what QR codes use).'],
        [<DocsInlineCode>?place=&lt;place&gt;</DocsInlineCode>, 'The map focused on one place; add ?navigate=1 to start directions to it.'],
        [<DocsInlineCode>?view=outdoor</DocsInlineCode>, 'The outdoor map; ?directions=1 gives directions to your venue from where the visitor is.'],
        [<DocsInlineCode>?view=2d</DocsInlineCode>, 'The indoor map in 2D (or 3d).'],
        [<DocsInlineCode>?events=1</DocsInlineCode>, 'What’s on; ?collection= or ?content= opens a specific one.'],
        [<DocsInlineCode>?preview=1</DocsInlineCode>, 'Your unpublished changes (team members only).'],
      ]}
    />

    <DocsH2 id="publishing">Publishing</DocsH2>
    <DocsP>
      <b>Share → Publishing</b> shows whether your venue is live, a checklist of what visitors get, and how many changes
      are waiting. <b>Publish changes</b> sends visitors the current version; <b>Preview</b> shows it first as visitors
      will see it. <b>Take offline</b> hides the venue until you publish again.
    </DocsP>
    <DocsCallout tone="info" title="First publish review">
      To keep the directory trustworthy, the Yet New team approves new institutions, and a new institution’s first
      publish waits for that approval. You’ll see “Sent to Yet New for review”; it goes live by itself once approved.
      Later publishes are instant.
    </DocsCallout>

    <DocsH2 id="settings">Venue settings and team</DocsH2>
    <DocsList>
      <DocsListItem><b>Venue details</b> — name, the description visitors read, and layout (a building with floors or an outdoor site).</DocsListItem>
      <DocsListItem><b>Location</b> — place and turn your venue on the world map, so outdoor directions lead to the right door.</DocsListItem>
      <DocsListItem><b>Indoor 3D map</b> — which view visitors start in, wall height and other defaults, with a live preview.</DocsListItem>
      <DocsListItem><b>Visitor home page</b> and <b>theme</b> — the hero image, highlighted places and colours.</DocsListItem>
      <DocsListItem><b>Institution profile</b> — your organisation’s public details.</DocsListItem>
      <DocsListItem><b>Danger zone</b> — deleting a venue removes its map, places, content and QR codes for good.</DocsListItem>
    </DocsList>
    <DocsP>
      Under <b>Settings → Team</b>, owners add people with a username and a starting password and choose their role:
      <b> editor</b> (can change and publish venues) or <b>owner</b> (also manages the team). Share the password with them
      privately; they can change it any time from the account menu (<b>Change password</b>).
    </DocsP>

    <DocsH2 id="faq">Questions</DocsH2>
    <DocsFaq q="Visitors can’t find a place I added.">
      <p>Check it has a name, that it’s connected to the paths (the assistant’s health badge lists places without a walkable connection — say “Fix everything”), and that you’ve published since adding it.</p>
    </DocsFaq>
    <DocsFaq q="Directions go through a wall.">
      <p>Say “What’s wrong?” in the editor. Paths through walls are re-routed through the nearest door by “Fix everything”; if there’s no door, add one (Door tool, or “add a door here”).</p>
    </DocsFaq>
    <DocsFaq q="Wheelchair users get sent up the stairs.">
      <p>Add the elevator or ramp on each floor, then say “Connect the floors via the elevator”. “Check accessibility” confirms every floor is reachable step-free.</p>
    </DocsFaq>
    <DocsFaq q="My publish is waiting for review.">
      <p>That’s normal for a new institution’s first publish. You can keep editing; the version you publish last is what goes live when it’s approved.</p>
    </DocsFaq>
    <DocsFaq q="The assistant says it didn’t understand.">
      <p>Try naming things exactly as they appear on the map, or select it and say “this”. Questions about Yet New itself (“what’s a room?”, “how do I publish?”) are answered right away. Typos are fine: the assistant reads past them and tells you what it understood, and when it isn’t sure it offers the closest things it can do.</p>
    </DocsFaq>
  </DocsShell>
);

export default DocsInstitutions;
