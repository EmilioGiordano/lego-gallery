export const TAU = Math.PI * 2;

export const clamp = (value, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

export function smoothstep(value) {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

export function hash(index, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}
