import { tryPublicKey } from './../common/utils'
import { useFanoutId } from 'hooks/useFanoutId'
import * as hydra from '@metaplex-foundation/mpl-hydra/dist/src'
import { BorshAccountsCoder, utils } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'

import { useDataHook } from './useDataHook'
import { AccountData } from 'common/AccountData'
import { FanoutMembershipMintVoucher } from '@metaplex-foundation/mpl-hydra/dist/src'
import { useEffect, useState } from 'react'

const HYDRA_PROGRAM_ID = new PublicKey(
  'hyDQ4Nz1eYyegS6JfenyKwKzYxRsCWCriYSAjtzP4Vg'
)

export const useFanoutMembershipMintVouchers = (
  fanoutMintId?: string | null
) => {
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

  return useDataHook<AccountData<FanoutMembershipMintVoucher>[]>(
    async () => {
      if (!fanoutId || !fanoutMintId || !tryPublicKey(fanoutMintId)) return
      const programAccounts = await connection.getProgramAccounts(
        HYDRA_PROGRAM_ID,
        {
          filters: [
            {
              memcmp: {
                offset: 0,
                bytes: utils.bytes.bs58.encode(
                  BorshAccountsCoder.accountDiscriminator(
                    'fanoutMembershipMintVoucher'
                  )
                ),
              },
            },
            {
              memcmp: {
                offset: 8,
                bytes: fanoutId.toBase58(),
              },
            },
            {
              memcmp: {
                offset: 40,
                bytes: tryPublicKey(fanoutMintId)!.toBase58(),
              },
            },
          ],
        }
      )

      return programAccounts.map((account) => {
        return {
          pubkey: account.pubkey,
          parsed: hydra.FanoutMembershipMintVoucher.fromAccountInfo(
            account.account
          )[0],
        }
      })
    },
    [fanoutId?.toString(), fanoutMintId],
    { name: 'useFanoutMembershipMintVouchers' }
  )
}
