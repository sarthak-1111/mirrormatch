// Maps YouCam error codes to kind, actionable guidance for the shopper.
// `retake: true` means a new photo will probably fix it; otherwise we degrade or escalate.

export class YouCamError extends Error {
  constructor(message, { status = 0, code = 'unknown', feature = '', retryable = false } = {}) {
    super(message);
    this.name = 'YouCamError';
    this.status = status;
    this.code = code;
    this.feature = feature;
    this.retryable = retryable;
  }
}

const G = {
  noFace: "Face the camera with your whole face in the frame.",
  closer: 'Move closer, or crop the photo so your face fills most of the frame.',
  further: 'Step back slightly so your whole face fits in the frame.',
  straight: 'Look straight at the camera, with your head level.',
  onePerson: 'Use a photo with only you in it.',
  light: 'Find soft, even light. Face a window and avoid strong light behind you.',
  file: 'Try a JPG or PNG photo.',
  small: 'Use a larger photo, at least 480 pixels on the short side.',
  body: 'For the dress preview, use a photo from the waist up with your shoulders and arms visible, facing forward.',
};

// What went wrong, in plain words (shown above the "what to do" line).
const WHY = {
  noFace: "We couldn't find a face in this photo.",
  small: 'Your face is too small in this photo.',
  cut: 'Part of your face is cut off at the edge.',
  angle: 'Your head is turned or tilted.',
  up: 'Your head is tilted up.',
  down: 'Your head is tilted down.',
  people: 'There is more than one person in this photo.',
  light: 'The light is too dark or uneven to read your skin tone.',
  lowres: 'This photo is too small (too few pixels).',
  file: "We couldn't open this photo file.",
  big: 'This photo file is too large.',
  body: "We couldn't see your shoulders and arms, which the dress preview needs.",
  blocked: "This photo can't be used.",
};

// code → [what to do, retake?, why]
const MAP = {
  error_no_face: [G.noFace, true, WHY.noFace],
  error_face_parsing: [G.noFace, true, WHY.noFace],
  error_face_position_invalid: [G.closer, true, WHY.small],
  error_face_position_too_small: [G.closer, true, WHY.small],
  error_face_position_out_of_boundary: [G.further, true, WHY.cut],
  error_face_not_forward_facing: [G.straight, true, WHY.angle],
  error_large_face_angle: [G.straight, true, WHY.angle],
  error_face_angle_invalid: [G.straight, true, WHY.angle],
  error_face_angle_upward: ['Tilt your head down slightly.', true, WHY.up],
  error_face_angle_downward: ['Tilt your head up slightly.', true, WHY.down],
  error_face_angle_leftward: ['Turn your head a little to the right.', true, WHY.angle],
  error_face_angle_rightward: ['Turn your head a little to the left.', true, WHY.angle],
  error_face_angle_left_tilt: ['Level your head: tilt it gently to the right.', true, WHY.angle],
  error_face_angle_right_tilt: ['Level your head: tilt it gently to the left.', true, WHY.angle],
  error_multiple_people: [G.onePerson, true, WHY.people],
  error_multi_person: [G.onePerson, true, WHY.people],
  error_below_min_image_size: [G.small, true, WHY.lowres],
  error_decode_image: [G.file, true, WHY.file],
  error_download_image: [G.file, true, WHY.file],
  exceed_max_filesize: ['Try a smaller photo (under 10 MB).', true, WHY.big],
  error_exceed_max_image_size: ['Try a smaller photo.', true, WHY.big],
  error_pose: [G.body, true, WHY.body],
  error_no_shoulder: [G.body, true, WHY.body],
  error_invalid_src: [G.body, true, WHY.body],
  error_apply_region_mismatch: [G.body, true, WHY.body],
  error_nsfw_content_detected: ['Please try a different photo.', true, WHY.blocked],
  lighting: [G.light, true, WHY.light],
  CreditInsufficiency: ['Try-on is paused right now. You can still see your matches.', false, null],
  unit_floor: ['Try-on is paused right now. You can still see your matches.', false, null],
};

export function guidanceFor(code) {
  const hit = MAP[code];
  if (hit) return { message: hit[0], retake: hit[1], why: hit[2] };
  // Unknown / server-side errors are not the shopper's fault: retrying is allowed, but they
  // count toward the analysis-failure limit that triggers a human hand-off.
  return { message: 'Please try that photo again, or another one.', retake: false, why: 'Something went wrong on our side, not with your photo.' };
}

/** Checks the `face_quality` block that skin-tone-analysis returns with its colours. */
export function qualityIssues(faceQuality) {
  if (!faceQuality) return [];
  const issues = [];
  if (faceQuality.has_face === false) issues.push('error_no_face');
  if (faceQuality.lighting && faceQuality.lighting !== 'good' && faceQuality.lighting !== 'ok') issues.push('lighting');
  if (faceQuality.frontal && !['good', 'ok'].includes(faceQuality.frontal)) issues.push('error_face_not_forward_facing');
  if (faceQuality.faceangle && !['good', 'ok'].includes(faceQuality.faceangle)) issues.push('error_large_face_angle');
  if (faceQuality.area && !['good', 'ok'].includes(faceQuality.area)) issues.push('error_face_position_too_small');
  return issues;
}
