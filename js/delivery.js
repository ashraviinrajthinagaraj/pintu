// How a line is meant to be said. A line can carry marks like "[tease]": the human
// voices act on them, and anything else, such as the phone's own voice or the
// screen, gets the words without them.
//
// "[plain]" goes back to a normal voice, so a direction after a joke isn't whispered.
export const MOODS = ['plain', 'warm', 'tease', 'deadpan', 'excited', 'worried', 'whisper', 'sigh', 'stern', 'shock'];

const MARK = new RegExp(`\\s*\\[(?:${MOODS.join('|')})\\]\\s*`, 'g');

export const plainSpeech = (text) => (text || '').replace(MARK, ' ').trim();

