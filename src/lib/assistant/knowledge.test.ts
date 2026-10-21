import { describe, expect, it } from 'vitest';
import { knowledge } from './knowledge';
import { smallTalk, smallTalkKind } from './smalltalk';
import { parseIntent } from './intent';
import { mapState } from './testMap';

describe('questions about Yet New', () => {
  it.each([
    ['what is a room', 'room'], ["what's a room?", 'room'], ['whats room', 'room'], ['What are rooms?', 'room'], ['explain rooms', 'room'],
    ['tell me what a room is', 'room'], ['how do I add a room?', 'room'],
    ['what is a walkable path', 'paths'], ['what are walking paths?', 'paths'], ['hey, what does walkable path mean', 'paths'], ['what is the route', 'paths'],
    ['how do I publish?', 'publish'], ['how can I make the map live', 'publish'], ['what does publish mean', 'publish'],
    ['how do i import my floor plan', 'import'], ['how to upload a dwg', 'import'], ['can I use a pdf?', 'import'],
    ['what is a layer', 'layer'], ['what are cad layers', 'layer'], ['what is a floor', 'floor'], ['how do I add another floor?', 'floor'],
    ['what is a door', 'door'], ['how do i add a door', 'door'], ['what is fix everything', 'health'], ['how do I fix the problems', 'health'],
    ['how do I undo', 'undo'], ['what is 3d view', '3d'], ['how can i see it in 3d', '3d'], ['what is step free', 'access'],
    ['what are qr codes', 'qr'], ['how do visitors use the map', 'visitors'], ['what is yet new', 'yetnew'], ['what is the world map', 'world'],
    ['what is the path tool', 'pathtool'], ['pls, can you tell me what a place is?', 'place'],
  ])('%s → %s', (q, topic) => expect(knowledge(q)?.topic).toBe(topic));

  it('leaves requests and questions about the map itself to the editor', () => {
    for (const t of ['add a room', 'add a 6 by 4 m room near the lobby', 'connect Room 1 and Room 2', 'what is Room 1', 'where is the lobby',
      'how do I get to the café', 'publish', 'undo', 'fix everything', 'go to the first floor', 'what is this'])
      expect(knowledge(t), t).toBeNull();
    // …and those keep working as before.
    expect(parseIntent('add a 6 by 4 m room')).not.toBeNull();
  });

  it('answers with something to tap', () => {
    expect(knowledge('what is a walkable path')!.chips.map(c => c.label)).toContain('Fix everything');
  });
});

describe('casual conversation', () => {
  it.each([
    ['how are you', 'howareyou'], ['how are you doing?', 'howareyou'], ['hi, how are you', 'howareyou'], ["how's it going", 'howareyou'], ['እንዴት ነህ', 'howareyou'],
    ["I'm confused", 'confused'], ["I don't understand", 'confused'], ['this is hard', 'confused'],
    ["you're great", 'compliment'], ['good job', 'compliment'], ['love it', 'compliment'],
    ["that's wrong", 'complaint'], ['not what I wanted', 'complaint'], ["it's not working", 'complaint'],
    ['who made you?', 'maker'], ["what's your name", 'who'],
  ])('%s → %s', (t, kind) => expect(smallTalkKind(t)).toBe(kind));

  it('answers naturally, and offers Undo after a complaint', () => {
    expect(smallTalk('how are you?', mapState())!.reply).toMatch(/^I'm doing great, thanks for asking!/);
    expect(smallTalk('እንዴት ነህ', mapState())!.reply).toMatch(/^ደህና ነኝ/);
    expect(smallTalk("that's wrong", mapState())!.chips[0]).toEqual({ label: 'Undo', say: 'Undo' });
    expect(smallTalk("I'm confused", mapState())!.chips.length).toBeGreaterThan(0);
  });
});
