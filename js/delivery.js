// How a line is meant to be said. A line can carry marks like "[tease]": the human
// voices act on them, and anything else, such as the phone's own voice or the
// screen, gets the words without them.
//
// "[plain]" goes back to a normal voice, so a direction after a joke isn't whispered.
export const MOODS = ['plain', 'warm', 'tease', 'deadpan', 'excited', 'worried', 'whisper', 'sigh', 'stern', 'shock'];

const MARK = new RegExp(`\\s*\\[(?:${MOODS.join('|')})\\]\\s*`, 'g');

export const plainSpeech = (text) => (text || '').replace(MARK, ' ').trim();

// A line as separate recordings, split wherever the delivery changes. A joke is then
// only ever recorded once, and a direction can be reused without it.
export const clipsOf = (text) => (text || '')
  .split(/\s*(?=\[[a-z]+\])/)
  .map((part) => part.replace(/^\[plain\]\s*/, '').trim())
  .filter(Boolean);

// A clip with no delivery mark is a plain direction, and has to be said.
export const isDirection = (clip) => !clip.startsWith('[');
