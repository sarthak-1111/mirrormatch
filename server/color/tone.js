// Builds a "tone profile" from the YouCam skin-tone-analysis colour result.
// YouCam returns hex colours (skin, lip, eye, eyebrow, hair) but no undertone or
// depth label, so both are derived here, deterministically:
//   depth     <- Individual Typology Angle (ITA°) of skin L*, b*  (Chardon et al. 1991)
//   undertone <- CIELAB hue angle h_ab of the skin colour (higher = more golden)
//   contrast  <- |L*(hair) - L*(skin)|, used for clothing colour strength
import { hexToLab, labToLch, ita, round1 } from './color.js';

export const DEPTH_BANDS = [
  // ITA thresholds follow Chardon's six skin categories; labels are neutral descriptors.
  { id: 'fair', label: 'fair', min: 55, group: 'light' },
  { id: 'light', label: 'light', min: 41, group: 'light' },
  { id: 'medium', label: 'medium', min: 28, group: 'medium' },
  { id: 'tan', label: 'tan', min: 10, group: 'medium' },
  { id: 'deep', label: 'deep', min: -30, group: 'deep' },
  { id: 'rich', label: 'rich deep', min: -Infinity, group: 'deep' },
];

// Hue-angle thresholds (degrees) for undertone. Heuristic, tuned on the catalogue shades
// (which are authored in LCh with cool h~47, neutral h~56, warm h~65) and documented in README.
export const UNDERTONE_THRESHOLDS = { coolBelow: 52, warmFrom: 60 };

export function depthFromIta(itaDeg) {
  return DEPTH_BANDS.find((b) => itaDeg > b.min) ?? DEPTH_BANDS[DEPTH_BANDS.length - 1];
}

export function undertoneFromHue(h, L = 60) {
  // Deeper skin measures with a slightly lower hue angle at the same perceived undertone,
  // so thresholds shift down 3 degrees below L*45 to avoid labelling every deep tone "cool".
  const shift = L < 45 ? 3 : 0;
  if (h < UNDERTONE_THRESHOLDS.coolBelow - shift) return 'cool';
  if (h >= UNDERTONE_THRESHOLDS.warmFrom - shift) return 'warm';
  return 'neutral';
}

export function contrastLevel(skinLab, hairLab) {
  if (!hairLab) return 'medium';
  const d = Math.abs(hairLab.L - skinLab.L);
  if (d >= 40) return 'high';
  if (d >= 20) return 'medium';
  return 'low';
}

function lipDescriptor(lipLch) {
  const { h, C, L } = lipLch;
  const depth = L < 40 ? 'deep ' : L > 62 ? 'light ' : '';
  if (C < 18) return `${depth}soft neutral`;
  if (h < 15 || h >= 345) return `${depth}rosy berry`;
  if (h < 30) return `${depth}soft rose`;
  if (h < 45) return `${depth}warm rose`;
  return `${depth}peachy`;
}

const UNDERTONE_COPY = {
  warm: 'warm, golden undertone',
  neutral: 'balanced, neutral undertone',
  cool: 'cool, rosy undertone',
};

/**
 * @param {object} color YouCam `results.color` object:
 *   { skin_color, lip_color, eye_color, eye_color_name, eyebrow_color, hair_color, hair_color_name }
 */
export function buildToneProfile(color) {
  if (!color || !color.skin_color) throw new Error('skin_color missing from analysis result');
  const skinLab = hexToLab(color.skin_color);
  const skinLch = labToLch(skinLab);
  const lipLab = color.lip_color ? hexToLab(color.lip_color) : null;
  const hairLab = color.hair_color ? hexToLab(color.hair_color) : null;
  const itaDeg = ita(skinLab);
  const depth = depthFromIta(itaDeg);
  const undertone = undertoneFromHue(skinLch.h, skinLab.L);
  const contrast = contrastLevel(skinLab, hairLab);
  const lipLch = lipLab ? labToLch(lipLab) : null;

  return {
    skinHex: color.skin_color.toUpperCase(),
    lipHex: color.lip_color ? color.lip_color.toUpperCase() : null,
    hairHex: color.hair_color ? String(color.hair_color).toUpperCase() : null,
    eyeHex: color.eye_color ? color.eye_color.toUpperCase() : null,
    eyeName: color.eye_color_name ?? null,
    hairName: color.hair_color_name ?? null,
    skinLab: { L: round1(skinLab.L), a: round1(skinLab.a), b: round1(skinLab.b) },
    lipLab: lipLab ? { L: round1(lipLab.L), a: round1(lipLab.a), b: round1(lipLab.b) } : null,
    hueAngle: round1(skinLch.h),
    ita: round1(itaDeg),
    depth: depth.id,
    depthLabel: depth.label,
    depthGroup: depth.group,
    undertone,
    contrast,
    lipDescriptor: lipLch ? lipDescriptor(lipLch) : null,
    // Key used by the merchant heatmap: 3 depth groups x 3 undertones.
    profileKey: `${depth.group}-${undertone}`,
    profileLabel: `${capitalize(depth.group)} · ${undertone}`,
  };
}

export function toneSummaryText(p) {
  const parts = [`Your skin reads as ${p.depthLabel} with a ${UNDERTONE_COPY[p.undertone]}.`];
  if (p.lipDescriptor) parts.push(`Your natural lip tone is a ${p.lipDescriptor}.`);
  return parts.join(' ');
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
