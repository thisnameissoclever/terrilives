/** Browser entropy enters the simulation once, before household creation. */
export function newGameSeed(source: Pick<Crypto, 'getRandomValues'> = crypto): Uint32Array {
  return source.getRandomValues(new Uint32Array(2));
}
