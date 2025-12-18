/**
 * Wallet Package
 * City Cash Points - Digital wallet system
 */

export { default as walletService } from './wallet-service'
export { default as walletRoutes } from './wallet-routes'
export { default as walletAdminRoutes } from './wallet-admin-routes'

// Types
export type {
  WalletBalance,
  DepositRequest,
  WithdrawRequest,
  PaymentRequest,
  FeeCalculation
} from './wallet-service'
