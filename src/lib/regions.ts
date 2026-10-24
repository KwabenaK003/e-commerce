/** The 16 regions of Ghana. Delivery zones are matched on these exact names. */
export const GH_REGIONS = [
  'Ahafo',
  'Ashanti',
  'Bono',
  'Bono East',
  'Central',
  'Eastern',
  'Greater Accra',
  'North East',
  'Northern',
  'Oti',
  'Savannah',
  'Upper East',
  'Upper West',
  'Volta',
  'Western',
  'Western North',
] as const;

export type GhRegion = (typeof GH_REGIONS)[number];

export function isRegion(v: string): v is GhRegion {
  return (GH_REGIONS as readonly string[]).includes(v);
}
