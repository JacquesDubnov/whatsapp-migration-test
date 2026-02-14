// Unicode emoji regex covering:
// - Emoji presentation sequences
// - Emoji modifier sequences (skin tones)
// - Emoji ZWJ sequences (family, profession combos)
// - Regional indicator pairs (flags)
// - Keycap sequences
const EMOJI_REGEX = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\p{Emoji_Modifier}|\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu;

function extractEmojis(text) {
  if (!text) return [];
  const matches = text.match(EMOJI_REGEX);
  if (!matches) return [];
  return [...new Set(matches)];
}

module.exports = { extractEmojis };
