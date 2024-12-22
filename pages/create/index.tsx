import { TOKEN_PROGRAM_ID } from '@coral-xyz/anchor/dist/cjs/utils/token'
import { Fanout, FanoutClient, MembershipModel } from '@metaplex-foundation/mpl-hydra/dist/src'
import { Wallet } from '@saberhq/solana-contrib'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction, Connection } from '@solana/web3.js'
import { AsyncButton } from 'common/Button'
import { Header } from 'common/Header'
import { notify } from 'common/Notification'
import { executeTransaction } from 'common/Transactions'
import { getPriorityFeeIx, tryPublicKey } from 'common/utils'
import { asWallet } from 'common/Wallets'
import type { NextPage } from 'next'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'
import { useState, useRef, useEffect } from 'react'

const MIN_TOKEN_REQUIREMENT = 100000; // 100k tokens minimum requirement

const Home: NextPage = () => {
  const { connection, environment } = useEnvironmentCtx()
  const [customConnection, setCustomConnection] = useState<Connection | null>(null)
  const wallet = useWallet()
  const [walletName, setWalletName] = useState<undefined | string>(undefined)
  const [success, setSuccess] = useState(false)
  const [hydraWalletMembers, setHydraWalletMembers] = useState<
    { memberKey?: string; balance?: number; shares?: number }[]
  >([{ memberKey: undefined, balance: undefined, shares: undefined }])
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Initialize custom connection for mainnet-beta
  useEffect(() => {
    if (environment.label == 'mainnet-beta') {
      const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL
      if (rpcUrl) {
        setCustomConnection(new Connection(rpcUrl))
      }
    }
  }, [environment.label])

  // Use the appropriate connection
  const getConnection = () => {
    return environment.label === 'mainnet-beta' && customConnection ? customConnection : connection
  }

  const calculateShares = (members: typeof hydraWalletMembers) => {
    // Filter members with balance >= MIN_TOKEN_REQUIREMENT and calculate total eligible balance
    const eligibleMembers = members.filter(member => (member.balance || 0) >= MIN_TOKEN_REQUIREMENT);
    const totalEligibleBalance = eligibleMembers.reduce((sum, member) => sum + (member.balance || 0), 0);
  
    // Calculate shares with 9 decimal places precision
    const calculatedMembers = members.map(member => {
      const balance = member.balance || 0;
      let sharePercentage = 0;
      
      if (balance >= MIN_TOKEN_REQUIREMENT && totalEligibleBalance > 0) {
        // Calculate share percentage with 9 decimal places
        sharePercentage = parseFloat(((balance / totalEligibleBalance) * 100).toFixed(9));
      }
  
      return {
        ...member,
        shares: sharePercentage
      };
    });
  
    // Ensure total shares sum to exactly 100
    const totalShares = calculatedMembers.reduce((sum, member) => sum + (member.shares || 0), 0);
    if (totalShares !== 100 && totalShares !== 0) {
      // Add any remaining difference to the member with the highest balance
      const difference = 100 - totalShares;
      const highestBalanceMember = calculatedMembers
        .filter(member => (member.balance || 0) >= MIN_TOKEN_REQUIREMENT)
        .reduce((prev, current) => 
          (prev.balance || 0) > (current.balance || 0) ? prev : current
        );
      
      const indexToAdjust = calculatedMembers.findIndex(
        member => member.memberKey === highestBalanceMember.memberKey
      );
      
      if (indexToAdjust !== -1) {
        calculatedMembers[indexToAdjust] = {
          ...calculatedMembers[indexToAdjust],
          shares: parseFloat((calculatedMembers[indexToAdjust].shares! + difference).toFixed(9))
        };
      }
    }
  
    return calculatedMembers;
  };

  const isDuplicateWalletAddress = (members: { memberKey?: string; balance?: number; shares?: number }[], address: string) => {
    return members.some(member => member.memberKey === address);
  };

  const handleMemberKeyChange = (value: string, index: number) => {
    if (isDuplicateWalletAddress(hydraWalletMembers.filter((_, i) => i !== index), value)) {
      notify({
        message: 'Duplicate Address',
        description: 'This wallet address has already been added.',
        type: 'warn',
      });
      removeMember(index);
      return;
    }

    const updatedMembers = [...hydraWalletMembers];
    updatedMembers[index] = {
      ...updatedMembers[index],
      memberKey: value
    };
    setHydraWalletMembers(calculateShares(updatedMembers));
  };

  const handleBalanceChange = (value: string, index: number) => {
    const balance = parseFloat(value) || 0;
    const updatedMembers = [...hydraWalletMembers];
    updatedMembers[index] = {
      ...updatedMembers[index],
      balance
    };

    setHydraWalletMembers(calculateShares(updatedMembers));

    if (balance < MIN_TOKEN_REQUIREMENT) {
      notify({
        message: 'Low Token Balance',
        description: `This wallet has less than ${MIN_TOKEN_REQUIREMENT} tokens. Shares will be set to 0.`,
        type: 'warn',
      });
    }
  };

  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
  
    try {
      const text = await file.text();
      const rows = text
        .split('\n')
        .map(row => row.trim())
        .filter(row => row.length > 0)
        .map(row => row.split(','));
  
      // Use a Set to track unique wallet addresses
      const uniqueMembers = new Map<string, { balance: number }>();
  
      rows.forEach(([address, balance]) => {
        const trimmedAddress = address.trim();
        const trimmedBalance = parseFloat(balance.trim());
        if (trimmedAddress && !isNaN(trimmedBalance) && !uniqueMembers.has(trimmedAddress)) {
          uniqueMembers.set(trimmedAddress, { balance: trimmedBalance });
        }
      });
  
      // Create an array of unique members
      const newMembers = Array.from(uniqueMembers.entries()).map(([memberKey, { balance }]) => ({
        memberKey,
        balance,
        shares: undefined,
      }));
  
      if (newMembers.length > 0) {
        // Calculate shares for all members
        const membersWithShares = calculateShares(newMembers);
        setHydraWalletMembers(membersWithShares);
  
        notify({
          message: 'CSV Import Success',
          description: `Imported ${newMembers.length} unique wallet addresses`,
          type: 'success',
        });
      } else {
        notify({
          message: 'CSV Import Warning',
          description: 'No valid wallet addresses were found in the CSV file.',
          type: 'warning',
        });
      }
    } catch (error) {
      notify({
        message: 'CSV Import Error',
        description: `Failed to import CSV: ${error.message || error}`,
        type: 'error',
      });
    }
  
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };  

  const addMember = () => {
    const updatedMembers = [
      ...hydraWalletMembers,
      { memberKey: undefined, balance: undefined, shares: undefined },
    ];
    setHydraWalletMembers(calculateShares(updatedMembers));
  };

  const removeMember = (index: number) => {
    const updatedMembers = hydraWalletMembers.filter((_, i) => i !== index);
    setHydraWalletMembers(calculateShares(updatedMembers));
  };

  // Rest of the validation and wallet creation logic remains the same
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
      
      if (Math.abs(shareSum - 100) > 0.000000001) {
        throw `Sum of all shares must equal 100 (current sum: ${shareSum.toFixed(9)})`
      }
      if (!hydraWalletMembers || hydraWalletMembers.length == 0) {
        throw 'Please specify at least one member'
      }

      const fanoutId = (await FanoutClient.fanoutKey(walletName))[0]
      const [nativeAccountId] = await FanoutClient.nativeAccount(fanoutId)
      const fanoutSdk = new FanoutClient(getConnection(), asWallet(wallet!))
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
            totalShares: 100,
            name: walletName,
            membershipModel: MembershipModel.Wallet,
          })
        ).instructions
      )
      for (const member of hydraWalletMembers) {
        if (member.shares! > 0) {
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
      const priorityFeeIx = await getPriorityFeeIx(getConnection(), transaction)
      transaction.add(priorityFeeIx)
      await executeTransaction(getConnection(), wallet as Wallet, transaction, {})
      setSuccess(true)
    } catch (e) {
      notify({
        message: `Error creating hydra wallet`,
        description: `${e}`,
        type: 'error',
      })
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
        <form className="w-full max-w-lg flex flex-col h-full">
          {/* Fixed header section */}
          <div className="flex-none">
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

            <button
              type="button"
              style={{backgroundColor: '#000'}}
              className="bg-black text-white hover:bg-gray-800 px-4 py-2 rounded-md text-sm mb-6"
              onClick={() => fileInputRef.current?.click()}
            >
              Import from CSV
            </button>

            <div className="grid grid-cols-12 gap-4 w-full mb-2">
              <div className="col-span-5">
                <label className="uppercase tracking-wide text-gray-700 text-xs font-bold">
                  Wallet Address
                </label>
              </div>
              <div className="col-span-4">
                <label className="uppercase tracking-wide text-gray-700 text-xs font-bold">
                  Balance
                </label>
              </div>
              <div className="col-span-3">
                <label className="uppercase tracking-wide text-gray-700 text-xs font-bold">
                  Shares / 100
                </label>
              </div>
            </div>
          </div>

          {/* Scrollable members list */}
          <div className="flex-grow overflow-auto w-full max-h-[400px] mb-6 border border-gray-200 rounded">
            <div className="p-4">
              {hydraWalletMembers.map((member, i) => (
                <div key={i} className="grid grid-cols-12 gap-4 mb-3 w-full">
                  <div className="col-span-5">
                    <input
                      name="memberKey"
                      className="appearance-none block w-full bg-gray-200 text-gray-700 border border-gray-200 rounded py-3 px-4 leading-tight focus:outline-none focus:bg-white"
                      type="text"
                      placeholder="Cmw...4xW"
                      onChange={(e) => handleMemberKeyChange(e.target.value, i)}
                      value={member.memberKey}
                    />
                  </div>
                  <div className="col-span-4">
                    <input
                      name="balance"
                      className="appearance-none block w-full bg-gray-200 text-gray-700 border border-gray-200 rounded py-3 px-4 leading-tight focus:outline-none focus:bg-white"
                      type="number"
                      step="0.0001"
                      placeholder="Token Balance"
                      onChange={(e) => handleBalanceChange(e.target.value, i)}
                      value={member.balance}
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      className="appearance-none block w-28 bg-gray-200 text-gray-700 border border-gray-200 rounded py-3 px-4 leading-tight focus:outline-none focus:bg-white"
                      type="number"
                      step="0.000000001"
                      readOnly
                      value={member.shares ? member.shares.toFixed(9) : '0'}
                    />
                  </div>
                  <div className="col-span-1">
                    <button
                      type="button"
                      className="bg-red-500 text-red-600 hover:bg-red-600 hover:text-white px-3 py-3 rounded-md"
                      onClick={() => removeMember(i)}
                    >
                      X
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Fixed footer section */}
          <div className="flex-none">
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvImport}
              className="hidden"
              ref={fileInputRef}
            />
            
            <div className="flex justify-between">
              <div>
                <button
                  type="button"
                  className="bg-gray-200 text-gray-600 hover:bg-gray-300 px-4 py-3 rounded-md mr-3"
                  onClick={addMember}
                >
                  Add Member
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
          </div>
        </form>
      </main>
    </div>
  );
};

export default Home;