import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import * as spl from "@solana/spl-token";
import * as web3 from '@solana/web3.js';
import { Tbtc } from "../target/types/tbtc";
import { expect } from 'chai';
import { ASSOCIATED_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/utils/token";

function maybeAuthorityAnd(
  signer,
  signers
) {
  return signers.concat(signer instanceof (anchor.Wallet as any) ? [] : [signer]);
}

async function setup(
  program: Program<Tbtc>,
  authority
) {
  const [config,] = getConfigPDA(program);
  const [tbtcMintPDA, _] = getTokenPDA(program);

  await program.methods
    .initialize()
    .accounts({
      mint: tbtcMintPDA,
      config,
      authority: authority.publicKey
    })
    .rpc();
}

async function checkState(
  program: Program<Tbtc>,
  expectedAuthority,
  expectedMinters,
  expectedGuardians,
  expectedTokensSupply
) {
  const [config,] = getConfigPDA(program);
  let configState = await program.account.config.fetch(config);

  expect(configState.authority).to.eql(expectedAuthority.publicKey);
  expect(configState.numMinters).to.equal(expectedMinters);
  expect(configState.numGuardians).to.equal(expectedGuardians);

  let tbtcMint = configState.mint;

  let mintState = await spl.getMint(program.provider.connection, tbtcMint);

  expect(mintState.supply).to.equal(BigInt(expectedTokensSupply));
}

async function changeAuthority(
  program: Program<Tbtc>,
  authority,
  newAuthority,
) {
  const [config,] = getConfigPDA(program);
  await program.methods
    .changeAuthority()
    .accounts({
      config,
      authority: authority.publicKey,
      newAuthority: newAuthority.publicKey,
    })
    .signers(maybeAuthorityAnd(authority, [newAuthority]))
    .rpc();
}

async function checkPaused(
  program: Program<Tbtc>,
  paused: boolean
) {
  const [config,] = getConfigPDA(program);
  let configState = await program.account.config.fetch(config);
  expect(configState.paused).to.equal(paused);
}


function getConfigPDA(
  program: Program<Tbtc>,
): [anchor.web3.PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from('config'),
    ],
    program.programId
  );
}

function getTokenPDA(
  program: Program<Tbtc>,
): [anchor.web3.PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from('tbtc-mint'),
    ],
    program.programId
  );
}

function getMinterPDA(
  program: Program<Tbtc>,
  minter
): [anchor.web3.PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from('minter-info'),
      minter.publicKey.toBuffer(),
    ],
    program.programId
  );
}

function getMinterIndexPDA(
  program: Program<Tbtc>,
  index
): [anchor.web3.PublicKey, number] {
  let indexArr = new Uint8Array(1);
  indexArr[0] = index;
  return web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from('minter-index'),
      indexArr,
    ],
    program.programId
  );
}

async function addMinter(
  program: Program<Tbtc>,
  authority,
  minter
): Promise<anchor.web3.PublicKey> {
  const [config,] = getConfigPDA(program);
  const [minterInfoPDA, _] = getMinterPDA(program, minter);

  let configState = await program.account.config.fetch(config);

  const [minterIndexPDA, __] = getMinterIndexPDA(program, configState.numMinters);

  await program.methods
    .addMinter()
    .accounts({
      config,
      authority: authority.publicKey,
      minterInfo: minterInfoPDA,
      minterIndex: minterIndexPDA,
      minter: minter.publicKey,
    })
    .signers(maybeAuthorityAnd(authority, []))
    .rpc();
  return minterInfoPDA;
}

async function checkMinter(
  program: Program<Tbtc>,
  minter,
  expectedIndex
) {
  const [minterInfoPDA, bump] = getMinterPDA(program, minter);
  let minterInfo = await program.account.minterInfo.fetch(minterInfoPDA);

  const [minterIndexPDA, indexBump] = getMinterIndexPDA(program, minterInfo.index);
  let minterIndex = await program.account.minterIndex.fetch(minterIndexPDA);

  expect(minterInfo.minter).to.eql(minter.publicKey);
  expect(minterInfo.bump).to.equal(bump);

  expect(minterIndex.minterInfo).to.eql(minterInfoPDA);
  expect(minterIndex.bump).to.equal(indexBump);

  expect(minterInfo.index).to.equal(expectedIndex);
}

async function removeMinter(
  program: Program<Tbtc>,
  authority,
  minter,
  minterInfo
) {
  const [config,] = getConfigPDA(program);
  const configState = await program.account.config.fetch(config);
  const minterInfoState = await program.account.minterInfo.fetch(minterInfo);

  const [lastIndex,] = getMinterIndexPDA(program, configState.numMinters - 1);
  const [swapIndex,] = getMinterIndexPDA(program, minterInfoState.index);

  const lastIndexState = await program.account.minterIndex.fetch(lastIndex);
  const swapInfo = lastIndexState.minterInfo;

  await program.methods
    .removeMinter()
    .accounts({
      config,
      authority: authority.publicKey,
      minterInfo: minterInfo,
      minterInfoSwap: swapInfo,
      minterIndexSwap: swapIndex,
      minterIndexTail: lastIndex,
      minter: minter.publicKey
    })
    .signers(maybeAuthorityAnd(authority, []))
    .rpc();
}

function getGuardianPDA(
  program: Program<Tbtc>,
  guardian
): [anchor.web3.PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from('guardian-info'),
      guardian.publicKey.toBuffer(),
    ],
    program.programId
  );
}

function getGuardianIndexPDA(
  program: Program<Tbtc>,
  index
): [anchor.web3.PublicKey, number] {
  let indexArr = new Uint8Array(1);
  indexArr[0] = index;
  return web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from('guardian-index'),
      indexArr,
    ],
    program.programId
  );
}

async function addGuardian(
  program: Program<Tbtc>,
  authority,
  guardian
): Promise<anchor.web3.PublicKey> {
  const [config,] = getConfigPDA(program);
  const [guardianInfoPDA, _] = getGuardianPDA(program, guardian);

  let configState = await program.account.config.fetch(config);

  const [guardianIndexPDA, __] = getGuardianIndexPDA(program, configState.numGuardians);
  await program.methods
    .addGuardian()
    .accounts({
      config,
      authority: authority.publicKey,
      guardianInfo: guardianInfoPDA,
      guardianIndex: guardianIndexPDA,
      guardian: guardian.publicKey,
    })
    .signers(maybeAuthorityAnd(authority, []))
    .rpc();
  return guardianInfoPDA;
}

async function checkGuardian(
  program: Program<Tbtc>,
  guardian,
  expectedIndex
) {
  const [guardianInfoPDA, bump] = getGuardianPDA(program, guardian);
  let guardianInfo = await program.account.guardianInfo.fetch(guardianInfoPDA);

  const [guardianIndexPDA, indexBump] = getGuardianIndexPDA(program, guardianInfo.index);
  let guardianIndex = await program.account.guardianIndex.fetch(guardianIndexPDA);

  expect(guardianInfo.guardian).to.eql(guardian.publicKey);
  expect(guardianInfo.bump).to.equal(bump);

  expect(guardianIndex.guardianInfo).to.eql(guardianInfoPDA);
  expect(guardianIndex.bump).to.equal(indexBump);

  expect(guardianInfo.index).to.equal(expectedIndex);
}

async function removeGuardian(
  program: Program<Tbtc>,
  authority,
  guardian,
  guardianInfo
) {
  const [config,] = getConfigPDA(program);
  const configState = await program.account.config.fetch(config);
  const guardianInfoState = await program.account.guardianInfo.fetch(guardianInfo);

  const [lastIndex,] = getGuardianIndexPDA(program, configState.numGuardians - 1);
  const [swapIndex,] = getGuardianIndexPDA(program, guardianInfoState.index);

  const lastIndexState = await program.account.guardianIndex.fetch(lastIndex);
  const swapInfo = lastIndexState.guardianInfo;

  await program.methods
    .removeGuardian()
    .accounts({
      config,
      authority: authority.publicKey,
      guardianInfo: guardianInfo,
      guardianInfoSwap: swapInfo,
      guardianIndexSwap: swapIndex,
      guardianIndexTail: lastIndex,
      guardian: guardian.publicKey
    })
    .signers(maybeAuthorityAnd(authority, []))
    .rpc();
}

async function pause(
  program: Program<Tbtc>,
  guardian
) {
  const [config,] = getConfigPDA(program);
  const [guardianInfoPDA, _] = getGuardianPDA(program, guardian);
  await program.methods
    .pause()
    .accounts({
      config,
      guardianInfo: guardianInfoPDA,
      guardian: guardian.publicKey
    })
    .signers([guardian])
    .rpc();
}

async function unpause(
  program: Program<Tbtc>,
  authority
) {
  const [config,] = getConfigPDA(program);
  await program.methods
    .unpause()
    .accounts({
      config,
      authority: authority.publicKey
    })
    .signers(maybeAuthorityAnd(authority, []))
    .rpc();
}

async function mint(
  program: Program<Tbtc>,
  minter,
  minterInfoPDA,
  recipient,
  amount,
  payer,
) {
  const connection = program.provider.connection;

  const [config,] = getConfigPDA(program);
  const [tbtcMintPDA, _] = getTokenPDA(program);
  const recipientToken = spl.getAssociatedTokenAddressSync(tbtcMintPDA, recipient.publicKey);

  const tokenData = await spl.getAccount(connection, recipientToken).catch((err) => {
    if (err instanceof spl.TokenAccountNotFoundError) {
      return null;
    } else {
      throw err;
    };
  });

  if (tokenData === null) {
    const tx = await web3.sendAndConfirmTransaction(
      connection,
      new web3.Transaction().add(
        spl.createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          recipientToken,
          recipient.publicKey,
          tbtcMintPDA,
        )
      ),
      [payer.payer]
    );
  }


  await program.methods
    .mint(new anchor.BN(amount))
    .accounts({
      mint: tbtcMintPDA,
      config,
      minterInfo: minterInfoPDA,
      minter: minter.publicKey,
      recipientToken,
    })
    .signers(maybeAuthorityAnd(payer, [minter]))
    .rpc();
}

describe("tbtc", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Tbtc as Program<Tbtc>;

  const authority = (program.provider as anchor.AnchorProvider).wallet as anchor.Wallet;
  const newAuthority = anchor.web3.Keypair.generate();
  const minterKeys = anchor.web3.Keypair.generate();
  const minter2Keys = anchor.web3.Keypair.generate();
  const impostorKeys = anchor.web3.Keypair.generate();
  const guardianKeys = anchor.web3.Keypair.generate();
  const guardian2Keys = anchor.web3.Keypair.generate();

  const recipientKeys = anchor.web3.Keypair.generate();

  it('setup', async () => {
    await setup(program, authority);
    await checkState(program, authority, 0, 0, 0);
  });

  it('change authority', async () => {
    await checkState(program, authority, 0, 0, 0);
    await changeAuthority(program, authority, newAuthority);
    await checkState(program, newAuthority, 0, 0, 0);
    await changeAuthority(program, newAuthority, authority.payer);
    await checkState(program, authority, 0, 0, 0);
  })

  it('add minter', async () => {
    await checkState(program, authority, 0, 0, 0);
    await addMinter(program, authority, minterKeys);
    await checkMinter(program, minterKeys, 0);
    await checkState(program, authority, 1, 0, 0);

    // Transfer lamports to imposter.
    await web3.sendAndConfirmTransaction(
      program.provider.connection,
      new web3.Transaction().add(
        web3.SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: impostorKeys.publicKey,
          lamports: 1000000000,
        })
      ),
      [authority.payer]
    );

    try {
      await addMinter(program, impostorKeys, minter2Keys);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('IsNotAuthority');
      expect(err.program.equals(program.programId)).is.true;
    }
  });

  it('mint', async () => {
    await checkState(program, authority, 1, 0, 0);
    const [minterInfoPDA, _] = getMinterPDA(program, minterKeys);
    await checkMinter(program, minterKeys, 0);

    // await setupMint(program, authority, recipientKeys);
    await mint(program, minterKeys, minterInfoPDA, recipientKeys, 1000, authority);

    await checkState(program, authority, 1, 0, 1000);

    // // Burn for next test.
    // const ix = spl.createBurnCheckedInstruction(
    //   account, // PublicKey of Owner's Associated Token Account
    //   new PublicKey(MINT_ADDRESS), // Public Key of the Token Mint Address
    //   WALLET.publicKey, // Public Key of Owner's Wallet
    //   BURN_QUANTITY * (10**MINT_DECIMALS), // Number of tokens to burn
    //   MINT_DECIMALS // Number of Decimals of the Token Mint
    // )

  });

  it('won\'t mint', async () => {
    await checkState(program, authority, 1, 0, 1000);
    const [minterInfoPDA, _] = getMinterPDA(program, minterKeys);
    await checkMinter(program, minterKeys, 0);

    // await setupMint(program, authority, recipientKeys);

    try {
      await mint(program, impostorKeys, minterInfoPDA, recipientKeys, 1000, authority);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('ConstraintSeeds');
      expect(err.program.equals(program.programId)).is.true;
    }
  });

  it('use two minters', async () => {
    await checkState(program, authority, 1, 0, 1000);
    const [minterInfoPDA, _] = getMinterPDA(program, minterKeys);
    await checkMinter(program, minterKeys, 0);
    const minter2InfoPDA = await addMinter(program, authority, minter2Keys);
    await checkMinter(program, minter2Keys, 1);
    await checkState(program, authority, 2, 0, 1000);
    // await setupMint(program, authority, recipientKeys);

    // cannot mint with wrong keys
    try {
      await mint(program, minter2Keys, minterInfoPDA, recipientKeys, 1000, authority);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('ConstraintSeeds');
      expect(err.program.equals(program.programId)).is.true;
    }

    // cannot remove minter with wrong keys
    try {
      await removeMinter(program, authority, minter2Keys, minterInfoPDA);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('ConstraintSeeds');
      expect(err.program.equals(program.programId)).is.true;
    }

    await mint(program, minterKeys, minterInfoPDA, recipientKeys, 500, authority);
    await checkState(program, authority, 2, 0, 1500);
  });

  it('remove minter', async () => {
    await checkState(program, authority, 2, 0, 1500);
    const [minter2InfoPDA, _] = getMinterPDA(program, minter2Keys);
    await checkMinter(program, minter2Keys, 1);
    await removeMinter(program, authority, minter2Keys, minter2InfoPDA);
    await checkState(program, authority, 1, 0, 1500);
  });

  it('won\'t remove minter', async () => {
    await checkState(program, authority, 1, 0, 1500);
    const [minterInfoPDA, _] = getMinterPDA(program, minterKeys);
    await checkMinter(program, minterKeys, 0);

    try {
      await removeMinter(program, impostorKeys, minterKeys, minterInfoPDA);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('IsNotAuthority');
      expect(err.program.equals(program.programId)).is.true;
    }

    await removeMinter(program, authority, minterKeys, minterInfoPDA);
    await checkState(program, authority, 0, 0, 1500);

    try {
      await removeMinter(program, authority, minterKeys, minterInfoPDA);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err.message).to.include('Account does not exist or has no data');
    }
  });

  it('add guardian', async () => {
    await checkState(program, authority, 0, 0, 1500);
    await addGuardian(program, authority, guardianKeys);
    await checkGuardian(program, guardianKeys, 0);
    await checkState(program, authority, 0, 1, 1500);

    try {
      await addGuardian(program, impostorKeys, guardian2Keys);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('IsNotAuthority');
      expect(err.program.equals(program.programId)).is.true;
    }
  });

  it('remove guardian', async () => {
    await checkState(program, authority, 0, 1, 1500);
    const [guardianInfoPDA,] = getGuardianPDA(program, guardianKeys);
    await checkGuardian(program, guardianKeys, 0);

    try {
      await removeGuardian(program, impostorKeys, guardianKeys, guardianInfoPDA);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('IsNotAuthority');
      expect(err.program.equals(program.programId)).is.true;
    }

    await removeGuardian(program, authority, guardianKeys, guardianInfoPDA);
    await checkState(program, authority, 0, 0, 1500);

    try {
      await removeGuardian(program, authority, guardianKeys, guardianInfoPDA);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err.message).to.include('Account does not exist or has no data');
    }

    await addGuardian(program, authority, guardian2Keys);
    await addGuardian(program, authority, guardianKeys);
    await checkGuardian(program, guardian2Keys, 0);
    await checkGuardian(program, guardianKeys, 1);

    const [guardian2InfoPDA,] = getGuardianPDA(program, guardian2Keys);
    await removeGuardian(program, authority, guardian2Keys, guardian2InfoPDA);

    await checkGuardian(program, guardianKeys, 0);

    await removeGuardian(program, authority, guardianKeys, guardianInfoPDA);
  });

  it('pause', async () => {
    await checkState(program, authority, 0, 0, 1500);
    await addGuardian(program, authority, guardianKeys);
    await checkPaused(program, false);
    await pause(program, guardianKeys);
    await checkPaused(program, true);
  });

  it('unpause', async () => {
    await checkState(program, authority, 0, 1, 1500);
    await checkPaused(program, true);
    await unpause(program, authority);
    await checkPaused(program, false);

    try {
      await unpause(program, authority);

      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('IsNotPaused');
      expect(err.program.equals(program.programId)).is.true;
    }
  });

  it('won\'t mint when paused', async () => {
    await checkState(program, authority, 0, 1, 1500);
    const minterInfoPDA = await addMinter(program, authority, minterKeys);
    await pause(program, guardianKeys);
    // await setupMint(program, authority, recipientKeys);

    try {
      await mint(program, minterKeys, minterInfoPDA, recipientKeys, 1000, authority);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('IsPaused');
      expect(err.program.equals(program.programId)).is.true;
    }

    await unpause(program, authority);
    await checkPaused(program, false);
  })

  it('use two guardians', async () => {
    await checkState(program, authority, 1, 1, 1500);
    const [guardianInfoPDA, _] = getGuardianPDA(program, guardianKeys);
    await checkGuardian(program, guardianKeys, 0);
    await addGuardian(program, authority, guardian2Keys);
    await checkGuardian(program, guardian2Keys, 1);

    await pause(program, guardianKeys);

    try {
      await pause(program, guardian2Keys);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('IsPaused');
      expect(err.program.equals(program.programId)).is.true;
    }

    await unpause(program, authority);
    await pause(program, guardian2Keys);
    await checkPaused(program, true);
    await unpause(program, authority);

    // cannot remove guardian with wrong keys
    try {
      await removeGuardian(program, authority, guardian2Keys, guardianInfoPDA);
      chai.assert(false, "should've failed but didn't");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal('ConstraintSeeds');
      expect(err.program.equals(program.programId)).is.true;
    }
  });
});
