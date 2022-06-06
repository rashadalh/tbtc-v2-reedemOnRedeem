import fs from "fs"
import { helpers, network } from "hardhat"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { KeyPair as BitcoinKeyPair, keyPairFromPrivateWif } from "./bitcoin"

// TODO: For now, the context and its setup is global and identical for each
//       scenario. Once more scenarios is added, this should be probably
//       split into the global common context and specialized per-scenario addons.

/**
 * Represents a context of the given system tests scenario.
 */
export interface SystemTestsContext {
  /**
   * Electrum instance connection URL.
   */
  electrumUrl: string
  /**
   * Handle to the contracts' deployment info.
   */
  contractsDeploymentInfo: ContractsDeploymentInfo
  /**
   * Ethereum signer representing the contract governance.
   */
  governance: SignerWithAddress
  /**
   * Ethereum signer representing the system maintainer.
   */
  maintainer: SignerWithAddress
  /**
   * Ethereum signer representing the depositor.
   */
  depositor: SignerWithAddress
  /**
   * Bitcoin key pair of the depositor.
   */
  depositorBitcoinKeyPair: BitcoinKeyPair
  /**
   * Bitcoin key pair of the wallet.
   */
  walletBitcoinKeyPair: BitcoinKeyPair
}

/**
 * Contracts deployment info that contains deployed contracts' addresses and ABIs.
 */
interface ContractsDeploymentInfo {
  contracts: {
    [key: string]: {
      address: string
      abi: any
    }
  }
}

/**
 * Sets up the system tests context.
 * @returns System tests context.
 */
export async function setupSystemTestsContext(): Promise<SystemTestsContext> {
  const electrumUrl = process.env.ELECTRUM_URL
  if (!electrumUrl) {
    throw new Error(`ELECTRUM_URL is not set`)
  }

  if (network.name === "hardhat") {
    throw new Error("Built-in Hardhat network is not supported")
  }

  const contractsDeploymentInfo = readContractsDeploymentExportFile()

  const { governance, maintainer, depositor } =
    await helpers.signers.getNamedSigners()

  const depositorBitcoinKeyPair = readBitcoinPrivateKeyWif(
    "DEPOSITOR_BITCOIN_PRIVATE_KEY_WIF"
  )

  const walletBitcoinKeyPair = readBitcoinPrivateKeyWif(
    "WALLET_BITCOIN_PRIVATE_KEY_WIF"
  )

  console.log(`
    System tests context:
    - Electrum URL: ${electrumUrl}
    - Ethereum network: ${network.name}
    - Bridge address ${contractsDeploymentInfo.contracts["Bridge"].address}
    - Governance Ethereum address ${governance.address}
    - Maintainer Ethereum address ${maintainer.address}
    - Depositor Ethereum address ${depositor.address}
    - Depositor Bitcoin public key ${depositorBitcoinKeyPair.compressedPublicKey}
    - Wallet Bitcoin public key ${walletBitcoinKeyPair.compressedPublicKey}
  `)

  return {
    electrumUrl,
    contractsDeploymentInfo,
    governance,
    maintainer,
    depositor,
    depositorBitcoinKeyPair,
    walletBitcoinKeyPair,
  }
}

/**
 * Reads the contract deployment export file. The file path is supposed to be
 * passed as CONTRACTS_DEPLOYMENT_EXPORT_FILE_PATH env variable. The file should
 * contain a JSON representing the deployment info.
 * @returns Deployment export file.
 */
function readContractsDeploymentExportFile(): ContractsDeploymentInfo {
  const contractsDeploymentExportFilePath =
    process.env.CONTRACTS_DEPLOYMENT_EXPORT_FILE_PATH
  if (contractsDeploymentExportFilePath) {
    const contractsDeploymentExportFile = fs.readFileSync(
      contractsDeploymentExportFilePath
    )
    return JSON.parse(contractsDeploymentExportFile)
  }

  throw new Error(`"CONTRACTS_DEPLOYMENT_EXPORT_FILE_PATH is not set`)
}

/**
 * Reads a Bitcoin private key WIF from an environment variable and
 * creates a key pair based on it. Throws if the environment variable
 * is not set.
 * @param privateKeyWifEnvName Name of the environment variable that contains
 *        the private key WIF.
 * @returns Bitcoin key pair corresponding to the private key WIF.
 */
function readBitcoinPrivateKeyWif(
  privateKeyWifEnvName: string
): BitcoinKeyPair {
  const privateKeyWif = process.env[privateKeyWifEnvName] as string

  if (!privateKeyWif) {
    throw new Error(`${privateKeyWifEnvName} is not set`)
  }

  return keyPairFromPrivateWif(privateKeyWif)
}
