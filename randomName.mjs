import crypto from 'crypto';

const ADJECTIVES = [
  'Sleepy', 'Curious', 'Fluffy', 'Sneaky', 'Cozy', 'Sassy', 'Whiskery', 'Playful',
  'Mellow', 'Dapper', 'Speedy', 'Grumpy', 'Snuggly', 'Clever', 'Mischievous', 'Plucky',
];

const CAT_WORDS = [
  'Tabby', 'Calico', 'Siamese', 'Tuxedo', 'Kitten', 'Mittens', 'Biscuit', 'Noodle',
  'Pumpkin', 'Whiskers', 'Marmalade', 'Pouncer', 'Sphynx', 'Bengal', 'Mochi', 'Cricket',
];

const pickRandom = (items) => items[crypto.randomInt(items.length)];

export function generateRandomName() {
  const suffix = crypto.randomInt(10, 100);
  return `${pickRandom(ADJECTIVES)} ${pickRandom(CAT_WORDS)} ${suffix}`;
}
