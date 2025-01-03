import type { Connection, PublicKey } from '@solana/web3.js'

function shortenAddress(address: string, chars = 5): string {
    return `${address.substring(0, chars)}...${address.substring(
      address.length - chars
    )}`;
  }

const formatShortAddress = (address: PublicKey | undefined) => {
    if (!address) return <></>;
    return (
      <a
        href={`https://explorer.solana.com/address/${address.toString()}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {shortenAddress(address.toString())}
      </a>
    );
  };

export const DisplayAddress = ({
    connection,
    address,
    height = '20px',
    width = '100px',
    dark = false,
    style,
  }: {
    connection: Connection
    address: PublicKey | undefined
    height?: string
    width?: string
    dark?: boolean
    style?: React.CSSProperties
  }) => {
  
    if (!address) return <></>
    return (
      <div style={{ display: 'flex', gap: '5px', ...style }}>
        {formatShortAddress(address)}
      </div>
    )
  }
  
