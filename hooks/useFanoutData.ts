import { useFanoutId } from 'hooks/useFanoutId'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'

import { useDataHook } from './useDataHook'
import { Fanout, FanoutClient } from '@metaplex-foundation/mpl-hydra/dist/src'
import { useWallet } from '@solana/wallet-adapter-react'
import { asWallet } from 'common/Wallets'
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { useEffect, useState } from 'react'

export type FanoutData = {
  fanoutId: PublicKey
  fanout: Fanout
  nativeAccount: PublicKey
  balance: number
}

export const useFanoutData = () => {
  const { environment } = useEnvironmentCtx()
  const [connection, setConnection] = useState(
    environment.label == "mainnet-beta"? new Connection(process.env.NEXT_PUBLIC_RPC_URL!, 'confirmed') :
    new Connection(process.env.NEXT_PUBLIC_RPC_DEVNET!, 'confirmed')
  )
  const { data: fanoutId } = useFanoutId()
  const wallet = useWallet()
  const fanoutSdk = new FanoutClient(connection, asWallet(wallet!))


    // Initialize connection based on environment
    useEffect(() => {
      const rpcUrl = environment.label === 'mainnet-beta' 
        ? process.env.NEXT_PUBLIC_RPC_URL 
        : process.env.NEXT_PUBLIC_RPC_DEVNET
        
      if (rpcUrl) {
        setConnection(new Connection(rpcUrl))
      }
    }, [environment.label])

  return useDataHook<FanoutData>(
    async () => {
      if (!fanoutId) return
      const [nativeAccount] = await FanoutClient.nativeAccount(fanoutId)
      const fanout = await fanoutSdk.fetch<Fanout>(fanoutId, Fanout)
      const [fanoutBalance, nativeBalance] = await Promise.all([
        connection.getBalance(fanoutId),
        connection.getBalance(nativeAccount),
      ])
      const balance = (fanoutBalance + nativeBalance) / LAMPORTS_PER_SOL
      return { fanoutId, fanout, nativeAccount, balance }
    },
    [fanoutId?.toString()],
    { name: 'useFanoutData' }
  )
}
