import { describe, expect, it } from 'vitest';
import { OutdoorMapEngine, selectBestOverpassGraph } from './OutdoorMapEngine';

function graphWithEdges(edges = 1) {
  return {
    nodes: [{ id: 'n1', lat: 0, lng: 0, kind: 'intersection' }],
    edges: Array.from({ length: edges }, (_, i) => ({
      id: `e${i}`,
      fromNodeId: 'n1',
      toNodeId: 'n1',
      weight: 10,
      highway: 'residential',
    })),
    bbox: { south: 0, west: 0, north: 0, east: 0 },
    fetchedAt: Date.now(),
  };
}

describe('OutdoorMapEngine', () => {
  it('connects a distant point to the nearest graph node so routing stays on streets', () => {
    const engine = new OutdoorMapEngine();
    engine.setGraph({
      nodes: [
        { id: 'n1', lat: 0, lng: 0, kind: 'intersection' },
        { id: 'n2', lat: 0.01, lng: 0.01, kind: 'intersection' },
      ],
      edges: [{ id: 'e1', fromNodeId: 'n1', toNodeId: 'n2', weight: 1_500, highway: 'residential' }],
      bbox: { south: 0, west: 0, north: 0.01, east: 0.01 },
      fetchedAt: Date.now(),
    });

    const virtualNode = engine.addVirtualNode({ id: 'virtual-a', lat: 0.002, lng: 0.002, kind: 'poi' }, 3_000);

    expect(virtualNode).not.toBeNull();
    const route = engine.findRoute('virtual-a', 'n2');
    expect(route?.path.map(node => node.id)).toContain('virtual-a');
    expect(route?.path.map(node => node.id)).toContain('n2');
  });
});

describe('selectBestOverpassGraph', () => {
  it('prefers the first fulfilled result with routable edges', () => {
    const good = graphWithEdges();
    const result = selectBestOverpassGraph([
      { status: 'fulfilled', value: { ...graphWithEdges(0), edges: [] } },
      { status: 'fulfilled', value: good },
    ]);

    expect(result).toBe(good);
  });

  it('returns null when every endpoint returns no routable edges', () => {
    const result = selectBestOverpassGraph([
      { status: 'fulfilled', value: { ...graphWithEdges(0), edges: [] } },
      { status: 'fulfilled', value: { ...graphWithEdges(0), edges: [] } },
    ]);

    expect(result).toBeNull();
  });
});
