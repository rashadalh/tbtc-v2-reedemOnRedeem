/**
 * Makes a p2sh transaction that contains a redeem script with the given public key and inscription.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { Hex } from "../../lib/utils"

/**
 * Creates the commit to the P2SH transaction.
 * @param inscription 
 * @returns 
 */
export async function makeInscriptionBuffer(inscription: string, publicKey: string, isCommit: boolean = false): Promise<Buffer> {
    if (isCommit) {
        return bitcoin.script.fromASM(
        `
            ${Buffer.from(publicKey, 'hex').toString('hex')}
            OP_CHECKSIG
            OP_FALSE
            OP_IF
            ${Buffer.from('ord', 'utf-8').toString('hex')}
            OP_1
            ${Buffer.from('text/plain;charset=utf-8', 'utf-8').toString('hex')}
            OP_0
            ${Buffer.from(inscription, 'utf-8').toString('hex')}
            OP_ENDIF
        `.replace(/\s+/g, ' ').trim(),
        );
        } else {
            // reveal inscription (tx output...)
            return bitcoin.script.fromASM(
                `
                ${Buffer.from('ord', 'utf-8').toString('hex')}
                OP_1
                ${Buffer.from('text/plain;charset=utf-8', 'utf-8').toString('hex')}
                OP_0
                ${Buffer.from(inscription, 'utf-8').toString('hex')}
            `.replace(/\s+/g, ' ').trim(),
            );
        }
}