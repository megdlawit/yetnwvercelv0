import React from 'react';
import { Building2, ShieldCheck, Smartphone, Code2 } from 'lucide-react';
import DocsShell from '@/components/docs/DocsShell';
import {
  DocsEyebrow, DocsTitle, DocsDescription, DocsH2, DocsP, DocsList, DocsListItem, DocsInlineCode,
  DocsCards, DocsCard, DocsFlow, DocsTable, DocsCallout,
} from '@/components/docs/DocsTypography';

const DocsIntro: React.FC = () => (
  <DocsShell>
    <DocsEyebrow>Yet New documentation</DocsEyebrow>
    <DocsTitle>Indoor and outdoor maps that walk people to the door.</DocsTitle>
    <DocsDescription>
      Yet New turns a museum, park, campus, hospital or mall into a live map: turn-by-turn directions inside and
      outside, in English and Amharic, in 2D and 3D. Institutions build and publish their venue; visitors open it
      from a QR code or a link — no app to install.
    </DocsDescription>

    <DocsCards>
      <DocsCard to="/doc/institutions" icon={Building2} title="For institutions">Create your account, draw or import your floor plans, add places and events, publish, and print QR codes.</DocsCard>
      <DocsCard to="/doc/admin" icon={ShieldCheck} title="For platform admins">Approve institutions and first publishes, manage venues and people, and run the platform tools and map layers.</DocsCard>
      <DocsCard to="/doc/visitors" icon={Smartphone} title="For visitors">Open a venue, search, get directions, walk with live guidance, save places and switch language.</DocsCard>
      <DocsCard to="/doc/api" icon={Code2} title="For developers">Put a venue map on another website or app with an iframe, a script tag or the React component.</DocsCard>
    </DocsCards>

    <DocsH2 id="how-it-works">How it fits together</DocsH2>
    <DocsFlow steps={[
      { title: 'Sign up', text: 'An institution creates an account and its first venue in two short steps.' },
      { title: 'Build the map', text: 'Import CAD drawings or draw floors; add places, paths, events and photos.' },
      { title: 'Publish', text: 'One click sends visitors the current version. A new team’s first publish is checked by Yet New.' },
      { title: 'Share', text: 'Visitors scan a QR code at the gate and get “You are here” and directions.' },
    ]} />
    <DocsP>
      Everything an institution changes stays private until it publishes, so a team can work on the next version of
      its map while visitors keep using the last published one.
    </DocsP>

    <DocsH2 id="concepts">Key ideas</DocsH2>
    <DocsTable
      headers={['Term', 'What it means']}
      rows={[
        ['Institution', 'The organisation that runs a place — a museum, park, university, hospital or mall. It owns venues and a team.'],
        ['Venue', 'One mappable place: a building with floors, or an outdoor site. Each venue has its own map, link and QR codes.'],
        ['Floor', 'One level of a building (sites have one). Floors are joined by stairs, elevators, ramps or escalators.'],
        ['Area (room)', 'A shape on a floor with a kind — office, meeting room, restroom, reception, entrance, stairs, elevator, utility.'],
        ['Place', 'Something visitors can find and navigate to: a room’s door, a café, an exhibit, an entrance, a parking area.'],
        ['Path', 'The walkable network visitors are routed along. The editor keeps paths out of walls and through doors.'],
        ['Entry point', 'Where visitors arrive. Each has a QR code that opens the map with “You are here” set.'],
        ['Publish', 'Copies your current map, places and content to visitors. Until then, edits are drafts.'],
        ['Map layer', 'Platform-wide overlays on the outdoor world map — buildings, parking, walkways, events — drawn by the Yet New team.'],
      ]}
    />

    <DocsH2 id="roles">Who can do what</DocsH2>
    <DocsTable
      headers={['Role', 'Can']}
      rows={[
        ['Visitor', 'Use any published venue. No account needed; saving places works straight away, and adding an email keeps them on every device.'],
        ['Editor', 'Edit their institution’s venues: maps, places, events, photos, QR codes, and publish.'],
        ['Owner', 'Everything an editor can, plus add and remove team members and change institution settings.'],
        ['Platform admin', 'The Yet New team: approvals, every institution and venue, people, activity and platform tools.'],
      ]}
    />
    <DocsCallout tone="info" title="Security is enforced in the database">
      Screens hide what you can’t use, but the real rules live in the database (row-level security): an institution
      can only ever read or change its own venues, and only the Yet New team can change platform-wide data.
    </DocsCallout>

    <DocsH2 id="addresses">Useful addresses</DocsH2>
    <DocsList>
      <DocsListItem><DocsInlineCode>/</DocsInlineCode> — the public home page and venue directory.</DocsListItem>
      <DocsListItem><DocsInlineCode>/venue/&lt;venue&gt;</DocsInlineCode> — a venue’s map for visitors (what QR codes open).</DocsListItem>
      <DocsListItem><DocsInlineCode>/explore</DocsInlineCode> — the city map with GPS to a venue, then indoor navigation.</DocsListItem>
      <DocsListItem><DocsInlineCode>/signup</DocsInlineCode> and <DocsInlineCode>/login</DocsInlineCode> — institution accounts.</DocsListItem>
      <DocsListItem><DocsInlineCode>/dashboard</DocsInlineCode> — an institution’s workspace; <DocsInlineCode>/admin</DocsInlineCode> — the Yet New control center.</DocsListItem>
      <DocsListItem><DocsInlineCode>/embed</DocsInlineCode> and <DocsInlineCode>/embed.js</DocsInlineCode> — partner embeds (see <a className="font-semibold text-moss underline underline-offset-2" href="/doc/api">API &amp; embeds</a>).</DocsListItem>
    </DocsList>
  </DocsShell>
);

export default DocsIntro;
