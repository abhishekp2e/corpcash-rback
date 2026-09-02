export interface WalletRecord {
  id: string;
  ownerId: string;
  label: string;
}

const WALLETS: WalletRecord[] = [
  { id: "wallet_1", ownerId: "dev-1", label: "Developer wallet" },
  { id: "wallet_2", ownerId: "viewer-1", label: "Viewer wallet" },
];

/** Stands in for a database call, so ownership policies have something to await. */
export async function findWalletById(
  id: string
): Promise<WalletRecord | undefined> {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return WALLETS.find((wallet) => wallet.id === id);
}

export function listWallets(): WalletRecord[] {
  return WALLETS;
}
