// @ts-ignore
import bcoin from "bcoin"
// @ts-ignore
import hash160 from "bcrypto/lib/hash160"
import { BigNumber } from "ethers"
import {
  createKeyRing,
  decomposeRawTransaction,
  RawTransaction,
  UnspentTransactionOutput,
  Client as BitcoinClient,
} from "./bitcoin"
import { Bridge, Identifier } from "./chain"
import { createTransactionProof } from "./proof"

/**
 * Represents a redemption request.
 */
export interface RedemptionRequest {
  /**
   * On-chain identifier of the redeemer.
   */
  redeemer: Identifier

  /**
   * The output script the redeemed Bitcoin funds are locked to. It is un-prefixed
   * and is not prepended with length.
   */
  redeemerOutputScript: string

  /**
   * The amount of Bitcoins in satoshis that is requested to be redeemed.
   * The actual value of the output in the Bitcoin transaction will be decreased
   * by the sum of the fee share and the treasury fee for this particular output.
   */
  requestedAmount: BigNumber

  /**
   * The amount of Bitcoins in satoshis that is subtracted from the amount of
   * the redemption request and used to pay the treasury fee.
   * The value should be exactly equal to the value of treasury fee in the Bridge
   * on-chain contract at the time the redemption request was made.
   */
  treasuryFee: BigNumber

  /**
   * The maximum amount of Bitcoins in satoshis that can be subtracted from the
   * redemption's `requestedAmount` to pay the transaction network fee.
   */
  txMaxFee: BigNumber

  /**
   * UNIX timestamp the request was created at.
   */
  requestedAt: number
}

/**
 * Handles pending redemption requests by creating a redemption transaction
 * transferring Bitcoins from the wallet's main UTXO to the provided redeemer
 * output scripts and broadcasting it. The change UTXO resulting from the
 * transaction becomes the new main UTXO of the wallet.
 * @dev It is up to the caller to ensure the wallet key and each of the redeemer
 *      output scripts represent a valid pending redemption request in the Bridge.
 *      If this is not the case, an exception will be thrown.
 * @param bitcoinClient - The Bitcoin client used to interact with the network
 * @param bridge - The handle to the Bridge on-chain contract
 * @param walletPrivateKey - The private kay of the wallet in the WIF format
 * @param mainUtxo - The main UTXO of the wallet. Must match the main UTXO
 *        held by the on-chain Bridge contract
 * @param redeemerOutputScripts - The list of output scripts that the redeemed
 *        funds will be locked to. The output scripts must be un-prefixed and
 *        not prepended with length
 * @param witness - The parameter used to decide about the type of the change
 *        output. P2WPKH if `true`, P2PKH if `false`
 * @returns Empty promise.
 */
export async function makeRedemptions(
  bitcoinClient: BitcoinClient,
  bridge: Bridge,
  walletPrivateKey: string,
  mainUtxo: UnspentTransactionOutput,
  redeemerOutputScripts: string[],
  witness: boolean
): Promise<void> {
  const rawTransaction = await bitcoinClient.getRawTransaction(
    mainUtxo.transactionHash
  )

  const mainUtxoWithRaw: UnspentTransactionOutput & RawTransaction = {
    ...mainUtxo,
    transactionHex: rawTransaction.transactionHex,
  }

  const redemptionRequests = await fetchRedemptionRequests(
    bridge,
    walletPrivateKey,
    redeemerOutputScripts
  )

  const transaction = await createRedemptionTransaction(
    walletPrivateKey,
    mainUtxoWithRaw,
    redemptionRequests,
    witness
  )

  // Note that `broadcast` may fail silently (i.e. no error will be returned,
  // even if the transaction is rejected by other nodes and does not enter the
  // mempool, for example due to an UTXO being already spent).
  await bitcoinClient.broadcast(transaction)
}

/**
 * Fetches a list of redemption requests from the provided Bridge on-chain
 * contract handle.
 * @dev It is up to the caller of this function to ensure that each of the
 *      redeemer output scripts represents a valid pending redemption request
 *      in the Bridge on-chain contract. An exception will be thrown if any of
 *      the redeemer output scripts (along with the wallet public key
 *      corresponding to the provided private key) does not represent a valid
 *      pending redemption.
 * @param bridge - The handle to the Bridge on-chain contract
 * @param walletPrivateKey - The private key of the wallet in the WIF format
 * @param redeemerOutputScripts - The list of output scripts that the redeemed
 *        funds are locked to. The output scripts must be un-prefixed and
 *        not prepended with length
 * @returns The list of redemption requests.
 */
async function fetchRedemptionRequests(
  bridge: Bridge,
  walletPrivateKey: string,
  redeemerOutputScripts: string[]
): Promise<RedemptionRequest[]> {
  const walletKeyRing = createKeyRing(walletPrivateKey)
  const walletPublicKey = walletKeyRing.getPublicKey().toString("hex")

  // Calculate un-prefixed wallet public key hash
  const walletPubKeyHash = hash160
    .digest(Buffer.from(walletPublicKey, "hex"))
    .toString("hex")

  const redemptionRequests: RedemptionRequest[] = []

  for (const redeemerOutputScript of redeemerOutputScripts) {
    const pendingRedemption = await bridge.pendingRedemptions(
      walletPubKeyHash,
      redeemerOutputScript
    )

    if (pendingRedemption.requestedAt == 0) {
      // The requested redemption does not exist among `pendingRedemptions`
      // in the Bridge.
      throw new Error(
        "Provided redeemer output script and wallet public key do not identify a pending redemption"
      )
    }

    // Redemption exists in the Bridge. Add it to the list.
    redemptionRequests.push({
      ...pendingRedemption,
      redeemerOutputScript: redeemerOutputScript,
    })
  }

  return redemptionRequests
}

/**
 * Creates a Bitcoin redemption transaction.
 * The transaction will have a single input (main UTXO of the wallet making
 * the redemption), an output for each redemption request provided, and a change
 * output if the redemption requests do not consume the entire amount of the
 * single input.
 * @dev The caller is responsible for ensuring the redemption request list is
 *      correctly formed:
 *        - there is at least one redemption
 *        - the `requestedAmount` in each redemption request is greater than
 *          the sum of its `txFee` and `treasuryFee`
 * @param walletPrivateKey - The private key of the wallet in the WIF format
 * @param mainUtxo - The main UTXO of the wallet. Must match the main UTXO held
 *        by the on-chain Bridge contract
 * @param redemptionRequests - The list of redemption requests
 * @param witness - The parameter used to decide the type of the change output.
 *        P2WPKH if `true`, P2PKH if `false`
 * @returns Bitcoin redemption transaction in the raw format.
 */
export async function createRedemptionTransaction(
  walletPrivateKey: string,
  mainUtxo: UnspentTransactionOutput & RawTransaction,
  redemptionRequests: RedemptionRequest[],
  witness: boolean
): Promise<RawTransaction> {
  if (redemptionRequests.length < 1) {
    throw new Error("There must be at least one request to redeem")
  }

  const walletKeyRing = createKeyRing(walletPrivateKey, witness)
  const walletAddress = walletKeyRing.getAddress("string")

  // Use the main UTXO as the single transaction input
  const inputCoins = [
    bcoin.Coin.fromTX(
      bcoin.MTX.fromRaw(mainUtxo.transactionHex, "hex"),
      mainUtxo.outputIndex,
      -1
    ),
  ]

  const transaction = new bcoin.MTX()

  let txTotalFee = 0
  let totalOutputsValue = 0

  // Process the requests
  for (const request of redemptionRequests) {
    // Calculate the value of the output by subtracting tx fee and treasury
    // fee for this particular output from the requested amount
    const outputValue = request.requestedAmount
      .sub(request.txMaxFee)
      .sub(request.treasuryFee)

    // Add the output value to the total output value
    totalOutputsValue += outputValue.toNumber()

    // Add the fee for this particular request to the overall transaction fee
    txTotalFee += request.txMaxFee.toNumber()
    // TODO: Use the value of fee that was set in the Bridge (`txMaxFee`) as the
    // transaction fee for now.
    // In the future allow the caller to propose the value of transaction fee.
    // If the proposed transaction fee is smaller than the sum of fee shares from
    // all the outputs then use the proposed fee and add the difference to outputs
    // proportionally.

    transaction.addOutput({
      script: bcoin.Script.fromRaw(
        Buffer.from(request.redeemerOutputScript, "hex")
      ),
      value: outputValue.toNumber(),
    })
  }

  // If there is a change output, add it explicitly to the transaction.
  // If we did not add this output explicitly, the bcoin library would add it
  // anyway during funding, but if the value of the change output was very low,
  // the library would consider it "dust" and add it to the fee rather than
  // create a new output.
  const changeOutputValue = mainUtxo.value - totalOutputsValue - txTotalFee
  if (changeOutputValue > 0) {
    transaction.addOutput({
      script: bcoin.Script.fromAddress(walletAddress),
      value: changeOutputValue,
    })
  }

  await transaction.fund(inputCoins, {
    changeAddress: walletAddress,
    hardFee: txTotalFee,
    subtractFee: false,
  })

  transaction.sign(walletKeyRing)

  return {
    transactionHex: transaction.toRaw().toString("hex"),
  }
}

/**
 * Prepares the proof of a redemption transaction and submits it to the
 * Bridge on-chain contract.
 * @param transactionHash - Hash of the transaction being proven.
 * @param mainUtxo - Recent main UTXO of the wallet as currently known on-chain.
 * @param walletPubKeyHash - 20-byte public key hash of the wallet
 * @param bridge - Handle to the Bridge on-chain contract.
 * @param bitcoinClient - Bitcoin client used to interact with the network.
 * @returns Empty promise.
 */
export async function proveRedemption(
  transactionHash: string,
  mainUtxo: UnspentTransactionOutput,
  walletPubKeyHash: string,
  bridge: Bridge,
  bitcoinClient: BitcoinClient
): Promise<void> {
  const confirmations = await bridge.txProofDifficultyFactor()
  const proof = await createTransactionProof(
    transactionHash,
    confirmations,
    bitcoinClient
  )
  // TODO: instead of getting rawTransaction, use transaction part of proof and
  // convert it to raw transaction.
  const rawTransaction = await bitcoinClient.getRawTransaction(transactionHash)
  const decomposedRawTransaction = decomposeRawTransaction(rawTransaction)
  await bridge.submitRedemptionProof(
    decomposedRawTransaction,
    proof,
    mainUtxo,
    walletPubKeyHash
  )
}
