import { Fanout, FanoutClient, MembershipModel } from '@metaplex-foundation/mpl-hydra/dist/src'
import { Wallet } from '@saberhq/solana-contrib'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction, Connection, VersionedTransaction, TransactionMessage } from '@solana/web3.js'
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
  const { environment } = useEnvironmentCtx()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [customConnection, setCustomConnection] = useState<Connection | null>(null)
  const wallet = useWallet()
  const [walletName, setWalletName] = useState<undefined | string>(undefined)
  const [success, setSuccess] = useState(false)
  const [maxShares, setMaxShares] = useState(0)
  const [hydraWalletMembers, setHydraWalletMembers] = useState<
    { memberKey?: string; balance?: number; shares?: number }[]
  >([{ memberKey: undefined, balance: undefined, shares: undefined }])
  const fileInputRef = useRef<HTMLInputElement>(null)

  
  // Initialize connection based on environment
  useEffect(() => {
    const rpcUrl = environment.label === 'mainnet-beta' 
      ? process.env.NEXT_PUBLIC_RPC_URL 
      : process.env.NEXT_PUBLIC_RPC_DEVNET
      
    if (rpcUrl) {
      setConnection(new Connection(rpcUrl))
    }
  }, [environment.label])

  // Use the appropriate connection
  const getConnection = () => {
    if (!connection) {
      throw new Error('Connection not initialized')
    }
    return connection
  }
  
  const calculateShares = (members: typeof hydraWalletMembers) => {
    // Filter members with balance >= MIN_TOKEN_REQUIREMENT and calculate total eligible balance
    const eligibleMembers = members.filter(member => (member.balance || 0) >= MIN_TOKEN_REQUIREMENT);
    const totalEligibleBalance = eligibleMembers.reduce((sum, member) => sum + (member.balance || 0), 0);
  
    // Calculate shares with 9 decimal places precision
    const calculatedMembers = eligibleMembers.map(member => {
      const balance = member.balance || 0;
      let sharePercentage = 0;
      
      if (balance >= MIN_TOKEN_REQUIREMENT && totalEligibleBalance > 0) {
        // Calculate share percentage with 9 decimal places
        sharePercentage = parseFloat(((balance / totalEligibleBalance) * 100).toFixed(9));
      }
  
      return {
        ...member,
        shares: Math.floor(balance)
      };
    });

    setMaxShares(totalEligibleBalance);
  
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
        const trimmedAddress = address?.trim() || '';
        const trimmedBalance = balance ? parseFloat(balance.trim()) : 0;
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
          type: 'warn',
        });
      }
    } catch (error) {
      notify({
        message: 'CSV Import Error',
        description: `Failed to import CSV: ${(error as any).message || error}`,
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
        shareSum += Math.floor(member.shares);
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
  
      // Get initialize instructions
      const initializeInstructions = (
        await fanoutSdk.initializeFanoutInstructions({
          totalShares: shareSum,
          name: walletName,
          membershipModel: MembershipModel.Wallet,
        })
      ).instructions
  
      // First, prepare all member instructions
      const allMemberInstructions = await Promise.all(
        hydraWalletMembers
          .filter(member => member.shares! > 0)
          .map(member => 
            fanoutSdk.addMemberWalletInstructions({
              fanout: fanoutId,
              fanoutNativeAccount: nativeAccountId,
              membershipKey: tryPublicKey(member.memberKey)!,
              shares: member.shares!,
            })
          )
      );
  
      // Flatten instructions array
      const memberInstructions = allMemberInstructions.map(ix => ix.instructions).flat();
  
      // Create smaller batches of instructions
      const MAX_INSTRUCTIONS_PER_BATCH = 9;
      const instructionBatches = [initializeInstructions];
      
      for (let i = 0; i < memberInstructions.length; i += MAX_INSTRUCTIONS_PER_BATCH) {
        instructionBatches.push(
          memberInstructions.slice(i, i + MAX_INSTRUCTIONS_PER_BATCH)
        );
      }
  
      const connection = getConnection();
      
      // Process batches in smaller chunks to avoid blockhash expiration
      const BATCHES_PER_SIGNING = 10; // Number of batches to process in one signing session
      
      for (let i = 0; i < instructionBatches.length; i += BATCHES_PER_SIGNING) {
        const currentBatches = instructionBatches.slice(i, i + BATCHES_PER_SIGNING);
        
        // Get fresh blockhash for each chunk of batches
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        
        // Create transactions for current batches
        const transactions = currentBatches.map(instructions => {
          const messageV0 = new TransactionMessage({
            payerKey: wallet.publicKey!,
            recentBlockhash: blockhash,
            instructions,
          }).compileToV0Message();
          
          return new VersionedTransaction(messageV0);
        });
  
        // Sign all transactions in this chunk
        if (wallet.signAllTransactions) {
          const signedTransactions = await wallet.signAllTransactions(transactions);
          
          // Send and confirm transactions sequentially with retry logic
          for (const signedTx of signedTransactions) {
            let confirmed = false;
            let retries = 3;
            
            while (!confirmed && retries > 0) {
              try {
                const signature = await connection.sendRawTransaction(signedTx.serialize(), {
                  skipPreflight: true,
                  maxRetries: 3
                });
                
                await connection.confirmTransaction({
                  signature,
                  blockhash,
                  lastValidBlockHeight
                }, 'confirmed');
                
                notify({
                  message: 'Batch processed successfully',
                  description: `Processed batch ${Math.floor(i / BATCHES_PER_SIGNING) + 1}`,
                  type: 'success',
                });
                
                confirmed = true;
              } catch (error) {
                retries--;
                if (retries === 0) {
                  throw error;
                }
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }
        }
      }
  
      setSuccess(true);
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
                  Total Shares ({maxShares.toFixed(2)})
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