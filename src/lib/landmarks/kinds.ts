// Which 3D landmark a place gets — the light half of landmarks.ts (no three.js),
// so lists and the visitor map can choose without loading the models.

export type LandmarkKind =
  | 'lion' | 'giraffe' | 'throne' | 'crown' | 'flowers' | 'jacaranda' | 'trees' | 'jebena' | 'book' | 'flag' | 'bag' | 'pin';

export const LANDMARK_LABELS: Record<LandmarkKind, string> = {
  lion: 'Lion', giraffe: 'Giraffe', throne: 'Throne', crown: 'Palace crown', flowers: 'Flowers', jacaranda: 'Jacaranda',
  trees: 'Trees', jebena: 'Coffee (jebena)', book: 'Book', flag: 'Flag', bag: 'Shopping bag', pin: 'Pin',
};

/** Which landmark fits a place, from its kind (subcategory / type), category and name. */
export function landmarkFor(p: { category?: string | null; subcategory?: string | null; name?: string | null }): LandmarkKind {
  const t = `${p.subcategory ?? ''} ${p.name ?? ''}`.toLowerCase();
  const c = (p.category ?? '').toLowerCase();
  if (/giraffe/.test(t)) return 'giraffe';
  if (/lion|animal|zoo|wildlife|safari|bird|aviary/.test(t)) return /zoo|giraffe/.test(t) ? 'giraffe' : 'lion';
  if (/palace|landmark|monument|castle|hall of|memorial/.test(t)) return 'crown';
  if (/exhibit|museum|throne|gallery|heritage|history|treasure/.test(t)) return 'throne';
  if (/flower|garden|botanic|fountain/.test(t)) return 'flowers';
  if (/park|tree|forest|nature|lawn|green/.test(t)) return /forest|trees/.test(t) ? 'trees' : 'jacaranda';
  if (/cafe|coffee|restaurant|bakery|food|dining|banquet|bar|tea/.test(t)) return 'jebena';
  if (/shop|boutique|store|market|mall|gift/.test(t)) return 'bag';
  if (/library|book|archive|classroom|lab|auditorium|school|education|lecture/.test(t)) return 'book';
  if (/culture|pavilion|flag|event|stage|info|tour/.test(t)) return 'flag';
  if (c === 'attraction') return 'crown';
  if (c === 'retail') return 'bag';
  if (c === 'education') return 'book';
  return 'pin';
}
