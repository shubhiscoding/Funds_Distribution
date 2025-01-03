import { DisplayAddress } from 'common/DisplayAddress'
import { executeTransaction } from 'common/Transactions'
import { FanoutClient } from '@metaplex-foundation/mpl-hydra/dist/src'
import { Wallet } from '@coral-xyz/anchor/dist/cjs/provider'
import { useWallet } from '@solana/wallet-adapter-react'
import { PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { AsyncButton } from 'common/Button'
import { Header } from 'common/Header'
import { notify } from 'common/Notification'
import { Copy, Check } from 'lucide-react';
import {
  getMintNaturalAmountFromDecimal,
  getPriorityFeeIx,
  pubKeyUrl,
  shortPubKey,
  tryPublicKey,
} from 'common/utils'
import { asWallet } from 'common/Wallets'
import { paymentMintConfig } from 'config/paymentMintConfig'
import { FanoutData, useFanoutData } from 'hooks/useFanoutData'
import { useFanoutMembershipMintVouchers } from 'hooks/useFanoutMembershipMintVouchers'
import { useFanoutMembershipVouchers } from 'hooks/useFanoutMembershipVouchers'
import { useFanoutMints } from 'hooks/useFanoutMints'
import type { NextPage } from 'next'
import { useRouter } from 'next/router'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'
import { useEffect, useState } from 'react'
import { Connection } from '@solana/web3.js'

const Home: NextPage = () => {
  const router = useRouter()
  const [mintId, setMintId] = useState<string | undefined>()
  const fanoutMembershipVouchers = useFanoutMembershipVouchers()
  const fanoutMints = useFanoutMints()
  const wallet = useWallet()
  const fanoutData = useFanoutData()
  const { environment } = useEnvironmentCtx()
  const [connection, setConnection] = useState(
    environment.label == "mainnet-beta"? new Connection(process.env.NEXT_PUBLIC_RPC_URL!, 'confirmed') :
    new Connection(process.env.NEXT_PUBLIC_RPC_DEVNET!, 'confirmed')
  )
  const [copied, setCopied] = useState(false);
  const [copiedFan, setFanCopied] = useState(false);
  let selectedFanoutMint =
    mintId && fanoutMints.data
      ? fanoutMints.data.find((mint) => mint.data.mint.toString() === mintId)
      : undefined
  const fanoutMembershipMintVouchers = useFanoutMembershipMintVouchers(mintId)
  const [voucherMapping, setVoucherMapping] = useState<{
    [key: string]: string
  }>({})


  // Initialize connection based on environment
  useEffect(() => {
    const rpcUrl = environment.label === 'mainnet-beta' 
      ? process.env.NEXT_PUBLIC_RPC_URL 
      : process.env.NEXT_PUBLIC_RPC_DEVNET
      
    if (rpcUrl) {
      setConnection(new Connection(rpcUrl))
    }
  }, [environment.label])

  useEffect(() => {
    const anchor = router.asPath.split('#')[1]
    const fanoutMint = fanoutMints.data?.find(
      (fanoutMint) =>
        fanoutMint.config.symbol === anchor ||
        fanoutMint.id.toString() === anchor
    )
    if (fanoutMint?.data.mint && fanoutMint?.data.mint.toString() !== mintId) {
      selectSplToken(fanoutMint?.data.mint.toString())
    }
  }, [
    router,
    fanoutMints.data?.map((fanoutMint) => fanoutMint.id.toString()).join(','),
  ])

  useEffect(() => {
    const setMapping = async () => {
      if (fanoutMembershipVouchers.data && selectedFanoutMint) {
        let mapping: { [key: string]: string } = {}
        for (const voucher of fanoutMembershipVouchers.data!) {
          const [mintMembershipVoucher] =
            await FanoutClient.mintMembershipVoucher(
              selectedFanoutMint.id,
              voucher.parsed.membershipKey,
              new PublicKey(mintId!)
            )
          mapping[voucher.pubkey.toString()] = mintMembershipVoucher.toString()
        }
        setVoucherMapping(mapping)
      } else {
        setVoucherMapping({})
      }
    }
    setMapping()
  }, [fanoutMembershipVouchers.data, selectedFanoutMint, mintId])

  const selectSplToken = (mintId: string) => {
    setMintId(mintId === 'default' ? undefined : mintId)
    const fanoutMint = fanoutMints.data?.find(
      (fanoutMint) => fanoutMint.data.mint.toString() === mintId
    )
    if (environment.label === 'mainnet-beta') {
      router.push(`${location.pathname}#${fanoutMint?.config.symbol ?? ''}`)
    }
  }


  const [distributionDetails, setDistributionDetails] = useState<{
    walletAddress: string;
    transactionHash: string;
    amount: string;
  }[]>([]);
  const [showDownloadButton, setShowDownloadButton] = useState(false);

  const downloadDistributionCSV = () => {
    const csvContent = [
      ['Wallet Address', 'Transaction Hash', 'Amount'],
      ...distributionDetails.map(detail => [
        detail.walletAddress,
        detail.transactionHash,
        detail.amount
      ])
    ]
      .map(row => row.join(','))
      .join('\n');
  
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `distribution_details_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const distributeShare = async (
    fanoutData: FanoutData,
    addAllMembers: boolean
  ) => {
    try {
      if (wallet && wallet.publicKey && fanoutData.fanoutId) {
        const fanoutSdk = new FanoutClient(connection, asWallet(wallet!))

        console.log(fanoutData)

        const newDistributionDetails: {
          walletAddress: string;
          transactionHash: string;
          share: string;
          amount: string;
        }[] = [];
        
        if (addAllMembers) {
          if (fanoutMembershipVouchers.data) {
            const MEMBERS_PER_BATCH = 5 // Increased from 5 to 12
            const BATCHES_PER_SIGNING = 20 // Number of batches to process in one signing session
            const vouchers = fanoutMembershipVouchers.data
            
            // Create all distribution instructions first
            const allInstructions = await Promise.all(
              vouchers.map(voucher => 
                fanoutSdk.distributeWalletMemberInstructions({
                  fanoutMint: selectedFanoutMint
                    ? selectedFanoutMint?.data.mint
                    : undefined,
                  distributeForMint: selectedFanoutMint ? true : false,
                  member: voucher.parsed.membershipKey,
                  fanout: fanoutData.fanoutId,
                  payer: wallet.publicKey!,
                })
              )
            )
  
            // Group instructions into batches
            const instructionBatches: TransactionInstruction[][] = []
            for (let i = 0; i < allInstructions.length; i += MEMBERS_PER_BATCH) {
              const batchInstructions: TransactionInstruction[] = []
              const batch = allInstructions.slice(i, i + MEMBERS_PER_BATCH)
              
              for (const instructions of batch) {
                batchInstructions.push(...instructions.instructions)
              }
              
              // Add priority fee instruction to each batch
              const priorityFeeIx = await getPriorityFeeIx(connection, new Transaction().add(...batchInstructions))
              batchInstructions.push(priorityFeeIx)
              
              instructionBatches.push(batchInstructions)
            }
  
            // Process batches in chunks
            for (let i = 0; i < instructionBatches.length; i += BATCHES_PER_SIGNING) {
              const currentBatches = instructionBatches.slice(i, i + BATCHES_PER_SIGNING)
              
              const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

              // Create versioned transactions for current batches
              const transactions = currentBatches.map(instructions => {
                const messageV0 = new TransactionMessage({
                  payerKey: wallet.publicKey!,
                  recentBlockhash: blockhash,
                  instructions,
                }).compileToV0Message()
                
                return new VersionedTransaction(messageV0)
              })
  
              // Sign all transactions in this chunk
              if (wallet.signAllTransactions) {
                const signedTransactions = await wallet.signAllTransactions(transactions)
                
                // Send and confirm transactions sequentially with retry logic
                for (let j = 0; j < signedTransactions.length; j++) {
                  const signedTx = signedTransactions[j]
                  let confirmed = false
                  let retries = 3
                  
                  while (!confirmed && retries > 0) {
                    try {
                      if (!signedTx) {
                        throw new Error('Transaction signing failed');
                      }
                      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
                        skipPreflight: true,
                        maxRetries: 3
                      })
                      
                      await connection.confirmTransaction({
                        signature,
                        blockhash,
                        lastValidBlockHeight
                      }, 'confirmed')
  
                      const batchStartIndex = i * MEMBERS_PER_BATCH + j * MEMBERS_PER_BATCH;
                      const batchMembers = vouchers.slice(batchStartIndex, batchStartIndex + MEMBERS_PER_BATCH);
                      
                      for (const member of batchMembers) {
                        const memberShare = Number(member.parsed.shares) / fanoutData.fanout?.totalShares.toString();
                        const totalAmount =`${(Number(fanoutData?.balance) * memberShare).toFixed(6)}◎`;
                        
                        newDistributionDetails.push({
                          walletAddress: member.parsed.membershipKey.toString(),
                          transactionHash: signature,
                          share: memberShare.toString(),
                          amount: totalAmount,
                        });
                      }
  
                      confirmed = true;
                    } catch (error) {
                      retries--
                      if (retries === 0) {
                        throw error
                      }
                      // Wait before retry
                      await new Promise(resolve => setTimeout(resolve, 1000))
                    }
                  }
                }
              }
            }
            setDistributionDetails(newDistributionDetails);
            setShowDownloadButton(true);
            
            notify({
              message: 'Distribution complete',
              description: 'All shares have been distributed. You can now download the distribution details.',
              type: 'success',
            });
          } else {
            throw 'No membership data found'
          }
        } else {
          // Single member distribution stays the same
          let transaction = new Transaction()
          let distMember = await fanoutSdk.distributeWalletMemberInstructions({
            distributeForMint: false,
            member: wallet.publicKey,
            fanout: fanoutData.fanoutId,
            payer: wallet.publicKey,
          })
          transaction.instructions = [...distMember.instructions]
          await executeTransaction(connection, asWallet(wallet), transaction, {
            confirmOptions: { commitment: 'confirmed', maxRetries: 3 },
            signers: [],
          })
          notify({
            message: `Claim successful`,
            description: `Successfully claimed ${
              addAllMembers ? "everyone's" : 'your'
            } share from ${fanoutData.fanout.name}`,
            type: 'success',
          })
        }
      }
    } catch (e) {
      notify({
        message: `Error claiming your share: ${e}`,
        type: 'error',
      })
    }
  }

  const handleCopy = async (text: string, setCopied: (isCopied:boolean)=>void) => {
    try {
      await navigator.clipboard.writeText(text ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="bg-white h-screen max-h-screen">
      <Header />
      <main className="h-[80%] py-16 flex flex-1 flex-col justify-center items-center">
        <div className="text-gray-700 w-full max-w-xl py-3 md:px-0 px-10 mb-10">
          {fanoutData.error && (
            <div className="text-gray-700 bg-red-300 w-full text-center py-3 mb-10">
              <div className="font-bold uppercase tracking-wide">
                Hydra Wallet not found
              </div>
              <div
                className="cursor-pointer"
                onClick={() =>
                  router.push(
                    `/${
                      environment.label !== 'mainnet-beta'
                        ? `?cluster=${environment.label}`
                        : ''
                    }`,
                    undefined,
                    { shallow: true }
                  )
                }
              >
                Retry
              </div>
            </div>
          )}

          <div className="mb-5 border-b-2">
            <div className="font-bold uppercase tracking-wide text-2xl mb-1">
              {fanoutData.data?.fanout.name ? (
                fanoutData.data?.fanout.name
              ) : (
                <div className="animate h-6 w-24 animate-pulse bg-gray-200 rounded-md"></div>
              )}
            </div>
            <div className="flex justify-between">
              <div className="flex-col">
                <div className="font-bold uppercase tracking-wide text-lg mb-1 flex items-center gap-1">
                  Total Inflow:{' '}
                  {selectedFanoutMint ? (
                    `${Number(
                      getMintNaturalAmountFromDecimal(
                        Number(selectedFanoutMint.data.totalInflow),
                        selectedFanoutMint.info.decimals
                      )
                    )} ${selectedFanoutMint.config.symbol}`
                  ) : fanoutData.data?.fanout ? (
                    `${
                      parseInt(
                        fanoutData.data?.fanout?.totalInflow.toString() ?? '0'
                      ) / 1e9
                    } ◎`
                  ) : (
                    <div className="animate h-6 w-10 animate-pulse bg-gray-200 rounded-md"></div>
                  )}
                </div>
                <p className="font-bold uppercase tracking-wide text-lg mb-1">
                  Balance:{' '}
                  {selectedFanoutMint
                    ? `${selectedFanoutMint.balance} ${selectedFanoutMint.config.symbol}`
                    : `${fanoutData.data?.balance}◎`}
                </p>
              </div>

              <div className="">
                <select
                  className="w-min-content bg-gray-700 text-white px-4 py-3 border-r-transparent border-r-8 rounded-md"
                  value={mintId}
                  onChange={(e) => {
                    selectSplToken(e.target.value)
                  }}
                >
                  <option value={'default'}>SOL</option>
                  {fanoutMints.data?.map((fanoutMint) => (
                    <option
                      key={fanoutMint.id.toString()}
                      value={fanoutMint.data.mint.toString()}
                    >
                      {paymentMintConfig[fanoutMint.data.mint.toString()]
                        ? paymentMintConfig[fanoutMint.data.mint.toString()]
                            ?.name
                        : shortPubKey(fanoutMint.data.mint.toString())}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="mb-5">
            <p className="font-bold uppercase tracking-wide text-md mb-1">
              Fanout Address:{' '}
              <a
                className="hover:text-blue-500 transition"
                target="_blank"
                rel="noopener noreferrer"
                href={pubKeyUrl(fanoutData.data?.fanoutId, environment.label)}
              >
                {shortPubKey(fanoutData.data?.fanoutId.toString())}
              </a>
                <button
                  onClick={()=>{handleCopy(fanoutData.data?.fanoutId.toString()||"", setFanCopied)}}
                  className="p-1 hover:bg-gray-100 rounded-md transition-colors"
                  title={copiedFan ? 'Copied!' : 'Copy address'}
                >
                  {copiedFan ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-500" />
                  )}
                </button>
            </p>
            {selectedFanoutMint ? (
              <p className="font-bold uppercase tracking-wide text-md mb-1">
                {selectedFanoutMint.config.symbol} Wallet Token Account:{' '}
                <a
                  className="hover:text-blue-500 transition"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={pubKeyUrl(
                    selectedFanoutMint.data.tokenAccount,
                    environment.label
                  )}
                >
                  {shortPubKey(selectedFanoutMint.data.tokenAccount)}
                </a>
              </p>
            ) : (
              <p className="font-bold uppercase tracking-wide text-md mb-1">
                Sol Wallet Address:{' '}
                <a
                  className="hover:text-blue-500 transition"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={pubKeyUrl(
                    fanoutData.data?.nativeAccount,
                    environment.label
                  )}
                >
                  {shortPubKey(fanoutData.data?.nativeAccount)}
                </a>
                <button
                  onClick={()=>{handleCopy(fanoutData.data?.nativeAccount.toString()||"", setCopied)}}
                  className="p-1 hover:bg-gray-100 rounded-md transition-colors"
                  title={copied ? 'Copied!' : 'Copy address'}
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <Copy className="w-4 h-4 text-gray-500" />
                  )}
                </button>
              </p>
            )}
            <p className="font-bold uppercase tracking-wide text-md mb-1">
              Total Members: {fanoutData.data?.fanout?.totalMembers.toString()}
            </p>
            <div className="max-h-[400px] overflow-y-auto border border-gray-200 rounded-md p-4 mb-4">
            <ul className="list-disc ml-6">
              {!fanoutMembershipVouchers.data ? (
                <>
                  <li className="mb-1 animate h-6 w-24 animate-pulse bg-gray-200 rounded-md"></li>
                  <li className="mb-1 animate h-6 w-24 animate-pulse bg-gray-200 rounded-md"></li>
                  <li className="mb-1 animate h-6 w-24 animate-pulse bg-gray-200 rounded-md"></li>
                </>
              ) : (
                fanoutMembershipVouchers.data?.map((voucher, i) => (
                  <li
                    key={voucher.pubkey.toString()}
                    className="relative font-bold uppercase tracking-wide text-md mb-1"
                  >
                    <div className="flex flex-wrap items-center">
                      <div className="min-w-0 break-all">
                        <DisplayAddress
                          connection={connection}
                          address={voucher.parsed.membershipKey}
                        />
                      </div>
                      <span className="ml-2 flex-shrink-0">
                        <>
                          {`(${Number(voucher.parsed.shares)} shares, `}
                          {selectedFanoutMint
                            ? fanoutMembershipMintVouchers.data &&
                              fanoutMembershipMintVouchers.data.length > 0
                              ? `${
                                  Number(
                                    getMintNaturalAmountFromDecimal(
                                      Number(
                                        fanoutMembershipMintVouchers.data.filter(
                                          (v) =>
                                            v.pubkey.toString() ===
                                            voucherMapping[voucher.pubkey.toString()]
                                        )[0]?.parsed.lastInflow
                                      ),
                                      selectedFanoutMint.info.decimals
                                    )
                                  ) *
                                  (Number(voucher.parsed.shares) / 100)
                                } ${selectedFanoutMint.config.symbol} claimed)`
                              : `0 ${selectedFanoutMint.config.symbol} claimed)`
                            : `${parseInt(voucher.parsed.totalInflow.toString()) / 1e9}◎ claimed)`}
                        </>
                      </span>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
          <p className="font-bold uppercase tracking-wide text-md mb-1">
            Total Shares: {fanoutData.data?.fanout?.totalShares.toString()}
          </p>
          </div>
          <div className="flex">
            <AsyncButton
              type="button"
              variant="primary"
              bgColor="rgb(96 165 250)"
              className="bg-blue-400 text-white hover:bg-blue-500 px-3 py-2 rounded-md mr-2"
              handleClick={async () =>
                fanoutData.data && distributeShare(fanoutData.data, true)
              }
            >
              Distribute To All
            </AsyncButton>
            {showDownloadButton && (
              <button
                onClick={downloadDistributionCSV}
                className="bg-green-500 text-white hover:bg-green-600 px-3 py-2 rounded-md"
              >
                Download Distribution Details
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default Home
