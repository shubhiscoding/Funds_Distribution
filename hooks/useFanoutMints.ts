import {
  PaymentMintConfig,
  paymentMintConfig,
} from './../config/paymentMintConfig'
import { useFanoutId } from 'hooks/useFanoutId'
import * as hydra from '@metaplex-foundation/mpl-hydra/dist/src'
import { BorshAccountsCoder, utils } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'

import { useDataHook } from './useDataHook'
import { FanoutMint } from '@metaplex-foundation/mpl-hydra/dist/src'
import * as splToken from '@solana/spl-token'
import { shortPubKey } from 'common/utils'
import { useEffect, useState } from 'react'

export const HYDRA_PROGRAM_ID = new PublicKey(
  'hyDQ4Nz1eYyegS6JfenyKwKzYxRsCWCriYSAjtzP4Vg'
)

export type FanoutMintData = {
  id: PublicKey
  data: FanoutMint
  balance: number
  info: splToken.MintInfo
  config: PaymentMintConfig
}

export const useFanoutMints = () => {
  const { environment } = useEnvironmentCtx()
  const { data: fanoutId } = useFanoutId()
    const [connection, setConnection] = useState(
      environment.label == "mainnet-beta"? new Connection(process.env.NEXT_PUBLIC_RPC_URL!, 'confirmed') :
      new Connection(process.env.NEXT_PUBLIC_RPC_DEVNET!, 'confirmed')
    )
    // Initialize connection based on environment
    useEffect(() => {
      const rpcUrl = environment.label === 'mainnet-beta' 
        ? process.env.NEXT_PUBLIC_RPC_URL 
        : process.env.NEXT_PUBLIC_RPC_DEVNET
        
      if (rpcUrl) {
        setConnection(new Connection(rpcUrl))
      }
    }, [environment.label])
  return useDataHook<FanoutMintData[]>(
    async () => {
      if (!fanoutId) return
      const programAccounts = await connection.getProgramAccounts(
        HYDRA_PROGRAM_ID,
        {
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: utils.bytes.bs58.encode(
                  BorshAccountsCoder.accountDiscriminator('fanoutMint')
                ),
              },
            },
            {
              memcmp: {
                offset: 40,
                bytes: fanoutId.toBase58(),
              },
            },
          ],
        }
      )
      const fanoutMints = await Promise.all(
        programAccounts.map(async (account) => {
          const fanoutMintData = hydra.FanoutMint.fromAccountInfo(
            account.account
          )[0]
          const mintAddress = fanoutMintData.mint
          return {
            id: account.pubkey,
            data: fanoutMintData,
            balance: parseFloat(
              (
                await connection.getTokenAccountBalance(
                  fanoutMintData.tokenAccount
                )
              ).value.uiAmountString ?? '0'
            ),
            info: await new splToken.Token(
              connection,
              mintAddress,
              splToken.TOKEN_PROGRAM_ID,
              // @ts-ignore
              null
            ).getMintInfo(),
            config: paymentMintConfig[fanoutMintData.mint.toString()] ?? {
              name: shortPubKey(mintAddress),
              symbol: shortPubKey(mintAddress),
            },
          }
        })
      )
      return fanoutMints
    },
    [fanoutId?.toString()],
    { name: 'useFanoutMints' }
  )
}
