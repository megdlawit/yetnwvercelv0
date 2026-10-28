import { describe, expect, it } from 'vitest';
import { parseCoordinates, readLatLng } from './usePlaceSuggestions';

describe('typed coordinates', () => {
  it('reads a pasted pair', () => {
    expect(parseCoordinates('9.0108, 38.7613')).toEqual({ lat: 9.0108, lng: 38.7613 });
    expect(parseCoordinates('Unity Park')).toBeNull();
  });

  it('reads the two boxes, with N/S/E/W', () => {
    expect(readLatLng('9.0108', '38.7613')).toEqual({ lat: 9.0108, lng: 38.7613 });
    expect(readLatLng('9.0108° N', '38.7613 E')).toEqual({ lat: 9.0108, lng: 38.7613 });
    expect(readLatLng('33.9 S', '18.4 e')).toEqual({ lat: -33.9, lng: 18.4 });
  });

  it('takes a whole pair pasted into either box', () => {
    expect(readLatLng('9.0108, 38.7613', '')).toEqual({ lat: 9.0108, lng: 38.7613 });
    expect(readLatLng('', '9.0108 38.7613')).toEqual({ lat: 9.0108, lng: 38.7613 });
  });

  it('says what is wrong', () => {
    expect(readLatLng('95', '38')).toEqual({ error: 'Latitude goes from −90 to 90.' });
    expect(readLatLng('9', '200')).toEqual({ error: 'Longitude goes from −180 to 180.' });
    expect(readLatLng('nine', '38')).toHaveProperty('error');
    expect(readLatLng('9 E', '38')).toHaveProperty('error');
  });
});
