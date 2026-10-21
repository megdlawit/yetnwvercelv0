import React from 'react';
import DocsShell from '@/components/docs/DocsShell';
import {
  DocsEyebrow, DocsTitle, DocsDescription, DocsH2, DocsH3, DocsP, DocsList, DocsListItem,
  DocsSteps, DocsStep, DocsCallout, DocsTable, DocsFaq,
} from '@/components/docs/DocsTypography';

const DocsVisitors: React.FC = () => (
  <DocsShell>
    <DocsEyebrow>Guide · Visitors</DocsEyebrow>
    <DocsTitle>Find your way with Yet New</DocsTitle>
    <DocsDescription>
      How to open a venue, find what you’re looking for and get walked there — indoors and out, in English or Amharic.
      Nothing to install: it runs in your phone’s browser.
    </DocsDescription>

    <DocsH2 id="open">Opening a venue</DocsH2>
    <DocsList>
      <DocsListItem><b>Scan a QR code</b> at a gate, entrance or exhibit. The map opens with “You are here” already set to that spot.</DocsListItem>
      <DocsListItem><b>Tap a link</b> the venue shared — it can open straight to a place, an event or directions.</DocsListItem>
      <DocsListItem><b>Browse the home page</b> and pick a venue from the directory.</DocsListItem>
    </DocsList>
    <DocsP>Already inside the app? The QR button in the search bar scans a code too.</DocsP>

    <DocsH2 id="home">The map screen</DocsH2>
    <DocsP>The map takes most of the screen, with everything you need in reach of one thumb.</DocsP>
    <DocsTable
      headers={['Where', 'What it does']}
      rows={[
        ['Search bar (top)', 'Search the venue’s places, rooms and spots — and nearby streets and places outside. The circle on the right opens your profile.'],
        ['Layers (right)', 'Change the map style, show or hide map layers (buildings, parking, walkways, events) and indoor details like room names.'],
        ['My location', 'Sits on the edge of the bottom sheet. Centres the map on you (it asks for location access the first time).'],
        ['Bottom sheet', 'The venue’s name, Directions, your saved places, categories — All, Events, Places, Photo Spots — and a few recommended places. Drag it up or down; it tucks away while you move the map.'],
        ['View switch', 'In a venue: Outdoor, 2D and 3D, plus the floor buttons. In 3D you can also pick a camera.'],
      ]}
    />

    <DocsH2 id="directions">Getting directions</DocsH2>
    <DocsSteps>
      <DocsStep title="Choose where to go">Tap <b>Directions</b> and search, tap a place on the map, or tap the arrow next to a recommended place.</DocsStep>
      <DocsStep title="Check the route">The route is drawn on the map with the distance and walking time. Outside, you can switch between walking and driving and change your starting point (your location, a place, or a spot you tap on the map).</DocsStep>
      <DocsStep title="Start walking">The card at the top shows the next turn, how far it is, and the time left. It changes floor for you when the route takes the stairs or the elevator.</DocsStep>
      <DocsStep title="Arrive">You’ll see when you’ve arrived. The place is added to your visited list.</DocsStep>
    </DocsSteps>

    <DocsH3>While you walk</DocsH3>
    <DocsList>
      <DocsListItem><b>Voice guidance</b> reads each turn aloud; tap the speaker to turn it on or off.</DocsListItem>
      <DocsListItem><b>English or Amharic</b> — switch language from the navigation card; place names and directions follow.</DocsListItem>
      <DocsListItem><b>Indoors without GPS</b>, your phone’s motion sensors count your steps to keep the blue dot moving. Allow motion access when asked.</DocsListItem>
      <DocsListItem>Looked around and lost your place? Tap <b>Back to me</b>. Wandered off the route? It finds a new one.</DocsListItem>
      <DocsListItem><b>Show steps</b> lists every turn of the route.</DocsListItem>
    </DocsList>
    <DocsCallout tone="info" title="Step-free routes">
      Where a venue has linked its floors with elevators or ramps, step-free routes avoid stairs. Turn on <b>Step-free
      route</b> when it’s offered, and look for the accessibility details on each place.
    </DocsCallout>

    <DocsH2 id="saved">Saved places, history and profile</DocsH2>
    <DocsP>
      Tap the bookmark on the bottom sheet or a place card to save it — no account needed. Your <b>Saved</b> and{' '}
      <b>Visited</b> lists live under the bookmark. Your profile (the circle in the search bar) shows places visited, steps
      walked and badges. Add your email in the profile to keep your saved places on every device.
    </DocsP>

    <DocsH2 id="privacy">Privacy and permissions</DocsH2>
    <DocsTable
      headers={['Permission', 'Why', 'If you say no']}
      rows={[
        ['Location', 'To show where you are outside and route you to the venue.', 'Pick your starting point by hand, or scan a QR code.'],
        ['Motion sensors', 'To count steps indoors, where GPS doesn’t reach.', 'The map still works; set your spot by scanning a code or choosing it in “Where are you?”.'],
        ['Camera', 'Only to scan QR codes.', 'Open the link printed under the code instead.'],
      ]}
    />

    <DocsH2 id="faq">Questions</DocsH2>
    <DocsFaq q="The blue dot is in the wrong place indoors.">
      <p>Scan the nearest QR code (the most accurate fix), or set your spot by hand in “Where are you?”. Holding your phone in front of you while walking helps the step counter.</p>
    </DocsFaq>
    <DocsFaq q="It says “Offline — using cached data”.">
      <p>You lost your connection. The map, places and directions you already loaded keep working; new searches outside the venue need a connection.</p>
    </DocsFaq>
    <DocsFaq q="I can’t find a place.">
      <p>Try another word (“toilet”, “restroom”, “WC”), check the floor buttons, or browse the categories on the bottom sheet. If it’s really missing, tell the venue’s staff.</p>
    </DocsFaq>
    <DocsFaq q="Voice guidance is silent.">
      <p>Check the speaker icon on the navigation card is on, and that your phone isn’t on silent.</p>
    </DocsFaq>
  </DocsShell>
);

export default DocsVisitors;
