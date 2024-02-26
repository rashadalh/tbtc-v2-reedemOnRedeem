/**
 * Makes a BRC-20 string given some parameters.
 */
export function makeBRC20(
  op: string,
  tick: string,
  amt: string,
  max: string | undefined = undefined,
  lim: string | undefined = undefined,
): string {


    // perform some basic checks
    // op must be deplopy, mint, or transfer
    if (op !== 'deploy' && op !== 'mint' && op !== 'transfer') {
        throw new Error('Invalid operation');
    }

    // amt can't have a decimal point
    if (amt.includes('.')) {
        throw new Error('Invalid amount');
    }

    // amount must > 0 when converted to number
    if (Number(amt) <= 0) {
        throw new Error('Invalid amount');
    }

    // length of tick must be at least 1
    if (tick.length < 1) {
        throw new Error('Invalid ticker');
    }

    if (op !== "deploy") {
        return `{ "p": "brc-20", "op": "${op}", "tick": "${tick}", "amt": ${amt} }`.replace(/\s+/g, ' ').trim();
    } else {
        if (max !== undefined && lim !== undefined) {
            return `{ "p": "brc-20", "op": "${op}", "tick": "${tick}", "amt": ${amt}, "max": ${max}, "lim": ${lim} }`.replace(/\s+/g, ' ').trim();
        } else {
            throw new Error('Invalid max or limit on deploy operation');
        }
    }
}