import { describe, expect, it } from 'vitest';
import { addKind, parseIntent } from './intent';

describe('understanding what someone wants done to their map', () => {
  it('connects places, however it is phrased', () => {
    expect(parseIntent('Connect Room 1 and Room 2.')).toEqual([{ op: 'connect', from: 'Room 1', to: 'Room 2', accessible: false }]);
    expect(parseIntent('connect the reception to the main entrance')).toEqual([{ op: 'connect', from: 'reception', to: 'main entrance', accessible: false }]);
    expect(parseIntent('Create a path from the elevator to the stairs')).toEqual([{ op: 'connect', from: 'elevator', to: 'stairs', accessible: false }]);
    expect(parseIntent('There should be a connection between these two rooms')).toBeTruthy();
    expect(parseIntent('Connect this to Room 4')).toEqual([{ op: 'connect', from: 'this', to: 'Room 4', accessible: false }]);
    expect(parseIntent('now connect it to Room 1')?.[0]).toMatchObject({ op: 'connect', from: 'it', to: 'Room 1' });
  });

  it('adds places, entrances and objects where asked', () => {
    expect(parseIntent('Add a reception here')).toEqual([{ op: 'add', what: 'reception', name: null, near: 'here', side: null }]);
    expect(parseIntent('Add a restroom next to Room 3')).toEqual([{ op: 'add', what: 'restroom', name: null, near: 'Room 3', side: null }]);
    expect(parseIntent('add another entrance here')?.[0]).toMatchObject({ op: 'add', what: 'entrance', near: 'here' });
    expect(parseIntent('Add a cafe to the right of the museum')?.[0]).toMatchObject({ op: 'add', what: 'cafe', near: 'museum', side: 'right' });
    expect(addKind('restroom')).toEqual({ type: 'place', name: 'Restroom', placeType: 'restroom' });
    expect(addKind('main entrance')).toMatchObject({ type: 'entrance', name: 'Main Entrance' });
    expect(addKind('elevator')).toMatchObject({ type: 'feature', feature: 'elevator' });
  });

  it('moves, renames and removes', () => {
    expect(parseIntent('Move it a little to the right')).toEqual([{ op: 'move', target: 'it', direction: 'right', amount: 'little' }]);
    expect(parseIntent('Move the cafe closer to the entrance')).toEqual([{ op: 'move', target: 'cafe', near: 'entrance' }]);
    expect(parseIntent('The entrance is actually over here')).toEqual([{ op: 'move', target: 'entrance', near: 'here' }]);
    expect(parseIntent('Rename this room to Conference Room')).toEqual([{ op: 'rename', target: 'this', name: 'Conference Room' }]);
    expect(parseIntent('Remove this room')).toEqual([{ op: 'remove', target: 'this' }]);
  });

  it('understands paths to take away and areas to keep clear', () => {
    expect(parseIntent('There should be no walking path through this room')).toEqual([{ op: 'block', target: 'this' }]);
    expect(parseIntent('Remove the path through the museum')).toEqual([{ op: 'block', target: 'museum' }]);
    expect(parseIntent('delete the connection between room 1 and room 2')).toEqual([{ op: 'disconnect', a: 'room 1', b: 'room 2' }]);
    expect(parseIntent('This path is wrong')).toEqual([{ op: 'disconnect', a: 'this', b: null }]);
    expect(parseIntent('Make this hallway walkable')).toEqual([{ op: 'walkable', target: 'this' }]);
  });

  it('knows floors, accessibility, fixing and undo', () => {
    expect(parseIntent('Connect Floor 1 to Floor 2 using the elevator')).toEqual([{ op: 'connect_floors', floor: '2', via: 'elevator' }]);
    expect(parseIntent('The elevator is here on both floors')).toEqual([{ op: 'connect_floors', via: 'elevator', floor: null }]);
    expect(parseIntent('Make the route wheelchair accessible')).toEqual([{ op: 'accessible', target: 'route' }]);
    expect(parseIntent('Avoid stairs')).toEqual([{ op: 'accessible', target: 'it' }]);
    expect(parseIntent('Fix everything')).toEqual([{ op: 'fix_all' }]);
    expect(parseIntent("What's wrong?")).toEqual([{ op: 'health' }]);
    expect(parseIntent('Undo that')).toEqual([{ op: 'undo' }]);
    expect(parseIntent('Actually, remove the connection we just created')).toEqual([{ op: 'undo' }]);
  });

  it('does several things in one go, and admits what it does not know', () => {
    expect(parseIntent('Add a reception near the entrance and connect it to Room 1')).toEqual([
      { op: 'add', what: 'reception', name: null, near: 'entrance', side: null },
      { op: 'connect', from: 'it', to: 'Room 1', accessible: false },
    ]);
    expect(parseIntent('what a lovely day')).toBeNull();
  });
});
