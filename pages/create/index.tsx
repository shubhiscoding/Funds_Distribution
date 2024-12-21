import { Fanout, FanoutClient, MembershipModel } from '@metaplex-foundation/mpl-hydra/dist/src'
import { Wallet } from '@saberhq/solana-contrib'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction } from '@solana/web3.js'
import { AsyncButton } from 'common/Button'
import { Header } from 'common/Header'
import { notify } from 'common/Notification'
import { executeTransaction } from 'common/Transactions'
import { getPriorityFeeIx, tryPublicKey } from 'common/utils'
import { asWallet } from 'common/Wallets'
import type { NextPage } from 'next'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'
import { useState, useRef } from 'react'

const MIN_TOKEN_REQUIREMENT = 100000; // 100k tokens minimum requirement

const Home: NextPage = () => {
  const { connection } = useEnvironmentCtx()
  const wallet = useWallet()
  const [walletName, setWalletName] = useState<undefined | string>(undefined)
  const [totalShares, setTotalShares] = useState<undefined | number>(100)
  const [success, setSuccess] = useState(false)
  const [hydraWalletMembers, setHydraWalletMembers] = useState<
    { memberKey?: string; shares?: number; tokenBalance?: number }[]
  >([{ memberKey: undefined, shares: undefined, tokenBalance: undefined }])
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function checkTokenBalance(walletAddress: PublicKey): Promise<number> {
    const tokenMint = new PublicKey(process.env.NEXT_PUBLIC_TOKEN_MINT!);
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        walletAddress,
        { programId: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") }
      );            
      let amount = 0;
      for (const tokenAccount of tokenAccounts.value) {
        const tokenInfo = tokenAccount.account.data.parsed.info;
        if (tokenInfo.mint === tokenMint.toBase58()) {
          amount += tokenInfo.tokenAmount.uiAmount;
        }
      }
      return amount;
    } catch (error) {
      console.error("Error checking token holdings:", error);
      return 0;
    }
  }

  const calculateShares = (members: typeof hydraWalletMembers) => {
    const totalTokens = members.reduce((sum, member) => sum + (member.tokenBalance || 0), 0);
    return members.map(member => ({
      ...member,
      shares: member.tokenBalance && member.tokenBalance >= MIN_TOKEN_REQUIREMENT
        ? Math.round((member.tokenBalance / totalTokens) * 100)
        : 0
    }));
  }

  const handleMemberKeyChange = async (value: string, index: number) => {
    try {
      const memberPubkey = tryPublicKey(value);
      if (!memberPubkey) {
        throw new Error('Invalid public key');
      }

      const tokenBalance = await checkTokenBalance(memberPubkey);
      const updatedMembers = [...hydraWalletMembers];
      updatedMembers[index] = {
        ...updatedMembers[index],
        memberKey: value,
        tokenBalance
      };

      // Recalculate shares for all members based on token balances
      const membersWithShares = calculateShares(updatedMembers);
      setHydraWalletMembers(membersWithShares);

      if (tokenBalance < MIN_TOKEN_REQUIREMENT) {
        notify({
          message: 'Low Token Balance',
          description: `This wallet has less than ${MIN_TOKEN_REQUIREMENT} tokens. Shares will be set to 0.`,
          type: 'warn',
        });
      }
    } catch (error) {
      notify({
        message: 'Error updating member',
        description: `${error}`,
        type: 'error',
      });
    }
  };

  const validateAndCreateWallet = async () => {
    try {
      if (!wallet.publicKey) {
        throw 'Please connect your wallet'
      }
      if (!walletName) {
        throw 'Specify a wallet name'
      }
      if (walletName.includes(' ')) {
        throw 'Wallet name cannot contain spaces'
      }
      if (!totalShares) {
        throw 'Please specify the total number of shares for distribution'
      }
      if (totalShares <= 0) {
        throw 'Please specify a positive number of shares'
      }

      let shareSum = 0
      for (const member of hydraWalletMembers) {
        if (!member.memberKey) {
          throw 'Please specify all member public keys'
        }
        if (member.shares === undefined) {
          throw 'Share calculation failed for some members'
        }
        const memberPubkey = tryPublicKey(member.memberKey)
        if (!memberPubkey) {
          throw 'Invalid member public key, unable to cast to PublicKey'
        }
        shareSum += member.shares
      }
      
      if (shareSum !== 100) {
        throw `Sum of all shares must equal 100`
      }
      if (!hydraWalletMembers || hydraWalletMembers.length == 0) {
        throw 'Please specify at least one member'
      }
      if (!hydraWalletMembers || hydraWalletMembers.length > 9) {
        throw 'Too many members - submit a PR to https://github.com/metaplex-foundation/hydra-ui/ to increase this maximum'
      }

      const fanoutId = (await FanoutClient.fanoutKey(walletName))[0]
      const [nativeAccountId] = await FanoutClient.nativeAccount(fanoutId)
      const fanoutSdk = new FanoutClient(connection, asWallet(wallet!))
      try {
        let fanoutData = await fanoutSdk.fetch<Fanout>(fanoutId, Fanout)
        if (fanoutData) {
          throw `Wallet '${walletName}' already exists`
        }
      } catch (e) {}
      const transaction = new Transaction()
      transaction.add(
        ...(
          await fanoutSdk.initializeFanoutInstructions({
            totalShares: 100, // Always use 100 as total shares
            name: walletName,
            membershipModel: MembershipModel.Wallet,
          })
        ).instructions
      )
      for (const member of hydraWalletMembers) {
        if (member.shares! > 0) { // Only add members with shares greater than 0
          transaction.add(
            ...(
              await fanoutSdk.addMemberWalletInstructions({
                fanout: fanoutId,
                fanoutNativeAccount: nativeAccountId,
                membershipKey: tryPublicKey(member.memberKey)!,
                shares: member.shares!,
              })
            ).instructions
          )
        }
      }
      transaction.feePayer = wallet.publicKey!
      const priorityFeeIx = await getPriorityFeeIx(connection, transaction)
      transaction.add(priorityFeeIx)
      await executeTransaction(connection, wallet as Wallet, transaction, {})
      setSuccess(true)
    } catch (e) {
      notify({
        message: `Error creating hydra wallet`,
        description: `${e}`,
        type: 'error',
      })
    }
  }

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const addresses = text.split(',').map(address => address.trim())
        .filter(address => address.length > 0) // Filter out empty strings

      // Create a new array of members
      const newMembers: typeof hydraWalletMembers = []

      for (const address of addresses) {
        try {
          const memberPubkey = tryPublicKey(address)
          if (!memberPubkey) {
            notify({
              message: 'Invalid address in CSV',
              description: `Skipping invalid address: ${address}`,
              type: 'warn',
            })
            continue
          }

          const tokenBalance = await checkTokenBalance(memberPubkey)
          newMembers.push({
            memberKey: address,
            tokenBalance,
            shares: undefined
          })
        } catch (error) {
          notify({
            message: 'Error processing address',
            description: `Failed to process address ${address}: ${error}`,
            type: 'warn',
          })
        }
      }

      if (newMembers.length > 0) {
        // Calculate shares for all members
        const membersWithShares = calculateShares(newMembers)
        setHydraWalletMembers(membersWithShares)

        notify({
          message: 'CSV Import Success',
          description: `Imported ${newMembers.length} wallet addresses`,
          type: 'success',
        })
      }
    } catch (error) {
      notify({
        message: 'CSV Import Error',
        description: `Failed to import CSV: ${error}`,
        type: 'error',
      })
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="bg-white h-screen max-h-screen">
      <Header />
      <main className="h-[80%] py-16 flex flex-1 flex-col justify-center items-center">
        {success && (
          <div className="text-gray-700 bg-green-300 w-full max-w-lg text-center py-3 mb-10">
            <p className="font-bold uppercase tracking-wide">
              Hydra Wallet Created
            </p>
            <p>
              {' '}
              Access the wallet at{' '}
              <a
                href={`/${walletName}${window.location.search ?? ''}`}
                className="text-blue-600 hover:text-blue-500"
              >
                {window.location.origin}/{walletName}
                {window.location.search ?? ''}
              </a>
            </p>
          </div>
        )}
        <form className="w-full max-w-lg">
          <div className="w-full mb-6">
            <label
              className="block uppercase tracking-wide text-gray-700 text-xs font-bold mb-2"
              htmlFor="grid-first-name"
            >
              Hydra Wallet Name
            </label>
            <input
              className="appearance-none block w-full bg-gray-200 text-gray-700 border border-gray-200 rounded py-3 px-4 mb-3 leading-tight focus:outline-none focus:bg-white"
              name="grid-first-name"
              type="text"
              placeholder="hydra-wallet"
              onChange={(e) => {
                setWalletName(e.target.value)
                setSuccess(false)
              }}
              value={walletName}
            />
          </div>
          <div className="flex flex-wrap">
            <button
              type="button"
              style={{ backgroundColor: '#000' }}
              className=" text-white hover:bg-green-600 px-4 py-2 rounded-md text-sm mb-6"
              onClick={() => fileInputRef.current?.click()}
            >
              Import from CSV
            </button>
            <div className="w-4/5 pr-3 mb-6 md:mb-0">
            <div className="flex justify-between items-center mb-2">
                <label className="uppercase tracking-wide text-gray-700 text-xs font-bold">
                  Wallet Address
                </label>
                <div>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvImport}
                    className="hidden"
                    ref={fileInputRef}
                  />
                </div>
              </div>
              {hydraWalletMembers &&
                hydraWalletMembers.map((member, i) => {
                  return (
                    <div key={i} className="mb-3">
                      <input
                        name="memberKey"
                        className="appearance-none block w-full bg-gray-200 text-gray-700 border border-gray-200 rounded py-3 px-4 leading-tight focus:outline-none focus:bg-white"
                        type="text"
                        placeholder="Cmw...4xW"
                        onChange={(e) => handleMemberKeyChange(e.target.value, i)}
                        value={member.memberKey}
                      />
                      {member.tokenBalance !== undefined && (
                        <div className="text-sm text-gray-600 mt-1">
                          Token Balance: {member.tokenBalance.toLocaleString()}
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
            <div className="w-1/5">
              <label className="block uppercase tracking-wide text-gray-700 text-xs font-bold mb-2">
                Shares / 100
              </label>
              {hydraWalletMembers.map((member, i) => {
                return (
                  <div className="flex mb-9" key={`share-${i}`}>
                    <input
                      className="appearance-none block w-full bg-gray-200 text-gray-700 border border-gray-200 rounded py-3 px-4 leading-tight focus:outline-none focus:bg-white"
                      type="number"
                      readOnly
                      value={member.shares ?? 0}
                    />
                  </div>
                )
              })}
            </div>
          </div>
          <div className="flex justify-between">
            <div>
              <button
                type="button"
                className="bg-gray-200 text-gray-600 hover:bg-gray-300 px-4 py-3 rounded-md mr-3"
                onClick={() =>
                  setHydraWalletMembers([
                    ...hydraWalletMembers,
                    {
                      memberKey: undefined,
                      shares: undefined,
                      tokenBalance: undefined
                    },
                  ])
                }
              >
                Add Member
              </button>
              <button
                type="button"
                className="bg-gray-200 text-gray-600 hover:bg-gray-300 px-4 py-3 rounded-md"
                onClick={() =>
                  setHydraWalletMembers(
                    hydraWalletMembers.filter(
                      (item, index) => index !== hydraWalletMembers.length - 1
                    )
                  )
                }
              >
                Remove Member
              </button>
            </div>
            <div>
              <AsyncButton
                type="button"
                bgColor="rgb(96 165 250)"
                variant="primary"
                className="bg-blue-400 text-white hover:bg-blue-500 px-4 py-3 rounded-md"
                handleClick={async () => validateAndCreateWallet()}
              >
                Create Hydra Wallet
              </AsyncButton>
            </div>
          </div>
        </form>
      </main>
    </div>
  )
}

export default Home