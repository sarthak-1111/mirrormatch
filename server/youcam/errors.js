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
  noFace: "We couldn't find a face. Face the camera with your whole face in the frame.",
  closer: 'Move a little closer so your face fills more of the frame.',
  further: 'Step back slightly so your whole face fits in the frame.',
  straight: 'Look straight at the camera, with your head level.',
  onePerson: 'Make sure only you are in the photo.',
  light: 'Find soft, even light. Face a window and avoid strong light behind you.',
  file: "We couldn't read that photo. Try a JPG or PNG.",
  small: 'That photo is quite small. Try a larger or closer one.',
  body: 'For the dress preview, use a photo from the chest up with your shoulders visible, facing forward.',
};

const MAP = {
  error_no_face: [G.noFace, true],
  error_face_parsing: [G.noFace, true],
  error_face_position_invalid: [G.closer, true],
  error_face_position_too_small: [G.closer, true],
  error_face_position_out_of_boundary: [G.further, true],
  error_face_not_forward_facing: [G.straight, true],
  error_large_face_angle: [G.straight, true],
  error_face_angle_invalid: [G.straight, true],
  error_face_angle_upward: ['Tilt your head down slightly.', true],
  error_face_angle_downward: ['Tilt your head up slightly.', true],
  error_face_angle_leftward: ['Turn your head a little to the right.', true],
  error_face_angle_rightward: ['Turn your head a little to the left.', true],
  error_face_angle_left_tilt: ['Level your head: tilt it gently to the right.', true],
  error_face_angle_right_tilt: ['Level your head: tilt it gently to the left.', true],
  error_multiple_people: [G.onePerson, true],
  error_multi_person: [G.onePerson, true],
  error_below_min_image_size: [G.small, true],
  error_decode_image: [G.file, true],
  error_download_image: [G.file, true],
  exceed_max_filesize: ['That photo is too large. Try a smaller one.', true],
  error_exceed_max_image_size: ['That photo is too large. Try a smaller one.', true],
  error_pose: [G.body, true],
  error_no_shoulder: [G.body, true],
  error_invalid_src: [G.body, true],
  error_apply_region_mismatch: [G.body, true],
  error_nsfw_content_detected: ['We could not use that photo. Please try a different one.', true],
  lighting: [G.light, true],
  CreditInsufficiency: ['Try-on is paused right now. You can still see your matches.', false],
  unit_floor: ['Try-on is paused right now. You can still see your matches.', false],
};

export function guidanceFor(code) {
  const hit = MAP[code];
  if (hit) return { message: hit[0], retake: hit[1] };
  // Unknown / server-side errors are not the shopper's fault: retrying is allowed, but they
  // count toward the analysis-failure limit that triggers a human hand-off.
  return { message: 'Something went wrong on our side. Please try that photo again.', retake: false };
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
