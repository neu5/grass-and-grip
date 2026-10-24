import { themeOf, type Surface, type Theme, type TrackDef } from '../sim';

export type TreeStyle = 'pine' | 'round' | 'broadleaf' | 'palm' | 'cactus' | 'bush';
export type BarrierStyle = 'redwhite' | 'concrete' | 'tyrewall' | 'fence' | 'logs';
/** How the road edge is painted. */
export type EdgeStyle = 'curbs' | 'kerbs' | 'lines';
export type GroundPattern = 'stripes' | 'speckle' | 'tiles' | 'ripples' | 'leaves';

export interface ThemeLook {
  sky: string;
  /** Hemisphere light: sky and ground tint. */
  hemiSky: string;
  hemiGround: string;
  /** Ground beyond the boundary wall. */
  outside: string;
  /** Painted ground inside the map, per ground surface (falls back to the shared looks). */
  ground: Partial<Record<Surface, { base: string; stripe: string }>>;
  pattern: GroundPattern;
  /** Styles for tree obstacles, picked in turn. */
  trees: TreeStyle[];
  /** What grows (or stands) outside the wall. */
  outsideScenery: (TreeStyle | 'rock' | 'building' | 'mesa')[];
  barrier: BarrierStyle;
  wall: string;
  edge: EdgeStyle;
  rock: string;
}

const MEADOW: ThemeLook = {
  sky: '#9fd3f0',
  hemiSky: '#dff1ff',
  hemiGround: '#3d5a2a',
  outside: '#4b9c40',
  ground: {},
  pattern: 'stripes',
  trees: ['pine'],
  outsideScenery: ['pine'],
  barrier: 'redwhite',
  wall: '#cfcac0',
  edge: 'curbs',
  rock: '#8d8a85',
};

export const THEME_LOOKS: Record<Theme, ThemeLook> = {
  meadow: MEADOW,
  winter: { ...MEADOW, outside: '#e3eaef', hemiGround: '#8a9aa8', rock: '#9aa3ab' },
  jungle: {
    sky: '#b7dccb',
    hemiSky: '#e8fff0',
    hemiGround: '#24401f',
    outside: '#2c5e26',
    ground: { grass: { base: '#2f6a2b', stripe: '#346f2e' } },
    pattern: 'leaves',
    trees: ['broadleaf', 'palm', 'broadleaf'],
    outsideScenery: ['broadleaf', 'palm', 'broadleaf', 'bush'],
    barrier: 'logs',
    wall: '#7d7462',
    edge: 'lines',
    rock: '#6f7a5e',
  },
  desert: {
    sky: '#f2d9a8',
    hemiSky: '#fff1d6',
    hemiGround: '#8a5a32',
    outside: '#d2a66a',
    ground: { sand: { base: '#d6ad6c', stripe: '#dbb577' } },
    pattern: 'ripples',
    trees: ['cactus'],
    outsideScenery: ['mesa', 'rock', 'cactus', 'rock'],
    barrier: 'tyrewall',
    wall: '#c08a58',
    edge: 'lines',
    rock: '#b0603a',
  },
  city: {
    sky: '#b9cfe0',
    hemiSky: '#eef4fb',
    hemiGround: '#555a60',
    outside: '#8e9196',
    ground: { asphalt: { base: '#a3a5a8', stripe: '#9a9ca0' } },
    pattern: 'tiles',
    trees: ['round'],
    outsideScenery: ['building'],
    barrier: 'concrete',
    wall: '#b9b6ae',
    edge: 'lines',
    rock: '#8d8a85',
  },
  farm: {
    sky: '#a7d6f2',
    hemiSky: '#fff6e0',
    hemiGround: '#4d5a2a',
    outside: '#6aa443',
    ground: { grass: { base: '#5fa843', stripe: '#66ae4a' } },
    pattern: 'speckle',
    trees: ['round', 'round', 'pine'],
    outsideScenery: ['round', 'pine', 'round'],
    barrier: 'fence',
    wall: '#a88a5c',
    edge: 'lines',
    rock: '#8d8a85',
  },
  circuit: {
    ...MEADOW,
    ground: { grass: { base: '#4fa443', stripe: '#59ad4b' } },
    trees: ['round', 'pine'],
    outsideScenery: ['round', 'pine'],
    barrier: 'tyrewall',
    edge: 'kerbs',
  },
};

export function themeLook(def: Pick<TrackDef, 'theme' | 'ground'>): ThemeLook {
  return THEME_LOOKS[themeOf(def)];
}
