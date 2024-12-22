import { useFanoutId } from 'hooks/useFanoutId'
import * as hydra from '@metaplex-foundation/mpl-hydra/dist/src'
import { BorshAccountsCoder, utils } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import { useEnvironmentCtx } from 'providers/EnvironmentProvider'

import { useDataHook } from './useDataHook'
import { AccountData } from 'common/AccountData'
import { FanoutMembershipVoucher } from '@metaplex-foundation/mpl-hydra/dist/src'
import { useEffect, useState } from 'react'

const HYDRA_PROGRAM_ID = new PublicKey(
  'hyDQ4Nz1eYyegS6JfenyKwKzYxRsCWCriYSAjtzP4Vg'
)

export const useFanoutMembershipVouchers = () => {
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
  return useDataHook<AccountData<FanoutMembershipVoucher>[]>(
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
                  BorshAccountsCoder.accountDiscriminator(
                    'fanoutMembershipVoucher'
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
          ],
        }
      )
      return programAccounts
        .map((account) => {
          return {
            pubkey: account.pubkey,
            parsed: hydra.FanoutMembershipVoucher.fromAccountInfo(
              account.account
            )[0],
          }
        })
        .sort((a, b) =>
          parseInt(a.parsed.shares.toString()) ===
          parseInt(b.parsed.shares.toString())
            ? a.parsed.membershipKey
                .toString()
                .localeCompare(b.parsed.membershipKey.toString())
            : parseInt(b.parsed.shares.toString()) -
              parseInt(a.parsed.shares.toString())
        )
    },
    [fanoutId?.toString()],
    { name: 'useFanoutMembershipVoucher' }
  )
}
