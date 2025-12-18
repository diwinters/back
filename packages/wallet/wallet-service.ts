/**
 * Wallet Service
 * Core business logic for wallet operations
 */

import { PrismaClient, WalletTransactionType, WalletTransactionStatus, EscrowStatus, FeeType } from '@prisma/client'

const prisma = new PrismaClient()

// =============================================================================
// Types
// =============================================================================

export interface WalletBalance {
  available: number
  pending: number
  total: number
  currency: string
}

export interface DepositRequest {
  userDid: string
  amount: number
  type: 'CASH' | 'CARD' | 'BANK'
  cashPointId?: string
  stripePaymentIntentId?: string
  metadata?: Record<string, any>
}

export interface WithdrawRequest {
  userDid: string
  amount: number
  type: 'CASH' | 'BANK'
  cashPointId?: string
  bankAccountId?: string
  pin?: string
}

export interface PaymentRequest {
  buyerDid: string
  sellerDid: string
  amount: number
  orderId?: string
  rideId?: string
  type: 'MARKET' | 'RIDE'
  useEscrow?: boolean
}

export interface FeeCalculation {
  originalAmount: number
  feeAmount: number
  netAmount: number
  feeConfig?: any
}

// =============================================================================
// Wallet CRUD
// =============================================================================

export async function getOrCreateWallet(userDid: string) {
  let wallet = await prisma.wallet.findUnique({
    where: { userDid }
  })

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        userDid,
        balance: 0,
        pendingBalance: 0,
        currency: 'MAD'
      }
    })
  }

  return wallet
}

export interface WalletInfo {
  id: string
  userDid: string
  available: number
  pending: number
  held: number
  total: number
  currency: string
  lastPinChange: Date | null
  hasPinSet: boolean
  createdAt: Date
}

export async function getWalletInfo(userDid: string): Promise<WalletInfo> {
  const wallet = await getOrCreateWallet(userDid)
  
  return {
    id: wallet.id,
    userDid: wallet.userDid,
    available: wallet.balance,
    pending: wallet.pendingBalance,
    held: 0, // TODO: Calculate from escrow
    total: wallet.balance + wallet.pendingBalance,
    currency: wallet.currency,
    lastPinChange: wallet.lastPinChange,
    hasPinSet: !!wallet.pinHash,
    createdAt: wallet.createdAt
  }
}

export async function getWalletBalance(userDid: string): Promise<WalletBalance> {
  const wallet = await getOrCreateWallet(userDid)
  
  return {
    available: wallet.balance,
    pending: wallet.pendingBalance,
    total: wallet.balance + wallet.pendingBalance,
    currency: wallet.currency
  }
}

export async function getWalletTransactions(
  userDid: string,
  options: {
    limit?: number
    offset?: number
    type?: WalletTransactionType
    status?: WalletTransactionStatus
  } = {}
) {
  const wallet = await getOrCreateWallet(userDid)
  
  const { limit = 50, offset = 0, type, status } = options
  
  const where: any = { walletId: wallet.id }
  if (type) where.type = type
  if (status) where.status = status
  
  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        cashPoint: true
      }
    }),
    prisma.walletTransaction.count({ where })
  ])
  
  return { transactions, total, limit, offset }
}

// =============================================================================
// PIN Management
// =============================================================================

import crypto from 'crypto'

function hashPin(pin: string): string {
  return crypto.createHash('sha256').update(pin + process.env.PIN_SALT || 'wallet-pin-salt').digest('hex')
}

export async function setWalletPin(userDid: string, pin: string): Promise<boolean> {
  if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    throw new Error('PIN must be exactly 4 digits')
  }
  
  const wallet = await getOrCreateWallet(userDid)
  
  if (wallet.pinHash) {
    throw new Error('PIN already set. Use changePin to update.')
  }
  
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: {
      pinHash: hashPin(pin),
      lastPinChange: new Date()
    }
  })
  
  return true
}

export async function changeWalletPin(userDid: string, currentPin: string, newPin: string): Promise<boolean> {
  if (!newPin || newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
    throw new Error('New PIN must be exactly 4 digits')
  }
  
  const wallet = await getOrCreateWallet(userDid)
  
  if (!wallet.pinHash) {
    throw new Error('No PIN set. Use setPin first.')
  }
  
  if (hashPin(currentPin) !== wallet.pinHash) {
    throw new Error('Current PIN is incorrect')
  }
  
  await prisma.wallet.update({
    where: { id: wallet.id },
    data: {
      pinHash: hashPin(newPin),
      lastPinChange: new Date()
    }
  })
  
  return true
}

export async function verifyWalletPin(userDid: string, pin: string): Promise<boolean> {
  const wallet = await getOrCreateWallet(userDid)
  
  if (!wallet.pinHash) {
    throw new Error('No PIN set')
  }
  
  return hashPin(pin) === wallet.pinHash
}

export async function hasPinSet(userDid: string): Promise<boolean> {
  const wallet = await getOrCreateWallet(userDid)
  return !!wallet.pinHash
}

// =============================================================================
// Fee Calculation
// =============================================================================

export async function calculateFee(
  amount: number,
  feeCode: string,
  cityId?: string
): Promise<FeeCalculation> {
  // First try city-specific fee, then global
  let feeConfig = await prisma.walletFeeConfig.findFirst({
    where: {
      code: feeCode,
      cityId: cityId || null,
      isActive: true
    }
  })
  
  // Fallback to global config
  if (!feeConfig && cityId) {
    feeConfig = await prisma.walletFeeConfig.findFirst({
      where: {
        code: feeCode,
        cityId: null,
        isActive: true
      }
    })
  }
  
  if (!feeConfig) {
    // No fee configured
    return {
      originalAmount: amount,
      feeAmount: 0,
      netAmount: amount
    }
  }
  
  let feeAmount = 0
  
  switch (feeConfig.type) {
    case 'PERCENTAGE':
      feeAmount = amount * (feeConfig.value / 100)
      if (feeConfig.minAmount && feeAmount < feeConfig.minAmount) {
        feeAmount = feeConfig.minAmount
      }
      if (feeConfig.maxAmount && feeAmount > feeConfig.maxAmount) {
        feeAmount = feeConfig.maxAmount
      }
      break
      
    case 'FIXED':
      feeAmount = feeConfig.value
      break
      
    case 'TIERED':
      const tiers = feeConfig.tiers as Array<{ upTo: number; fee: number }> | null
      if (tiers) {
        for (const tier of tiers) {
          if (amount <= tier.upTo) {
            feeAmount = tier.fee
            break
          }
        }
        // If amount exceeds all tiers, use the last tier
        if (feeAmount === 0 && tiers.length > 0) {
          feeAmount = tiers[tiers.length - 1].fee
        }
      }
      break
  }
  
  return {
    originalAmount: amount,
    feeAmount: Math.round(feeAmount * 100) / 100, // Round to 2 decimals
    netAmount: Math.round((amount - feeAmount) * 100) / 100,
    feeConfig
  }
}

// =============================================================================
// Deposit Operations
// =============================================================================

export async function initiateDeposit(request: DepositRequest) {
  const { userDid, amount, type, cashPointId, stripePaymentIntentId, metadata } = request
  
  const wallet = await getOrCreateWallet(userDid)
  
  // Calculate deposit fee
  const feeCode = type === 'CASH' ? 'deposit_fee_cash' : 
                  type === 'CARD' ? 'deposit_fee_card' : 'deposit_fee_bank'
  const fee = await calculateFee(amount, feeCode)
  
  const transactionType = type === 'CASH' ? WalletTransactionType.DEPOSIT_CASH :
                          type === 'CARD' ? WalletTransactionType.DEPOSIT_CARD :
                          WalletTransactionType.DEPOSIT_BANK
  
  // For card deposits, status starts as pending (Stripe webhook will confirm)
  // For cash deposits, agent needs to confirm
  const initialStatus = type === 'CARD' ? 
    WalletTransactionStatus.PROCESSING : 
    WalletTransactionStatus.PENDING
  
  const transaction = await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: transactionType,
      amount: amount,
      fee: fee.feeAmount,
      netAmount: fee.netAmount,
      status: initialStatus,
      cashPointId: cashPointId || null,
      description: `Deposit via ${type.toLowerCase()}`,
      metadata: {
        ...metadata,
        stripePaymentIntentId
      }
    }
  })
  
  return {
    transaction,
    fee
  }
}

export async function completeDeposit(transactionId: string) {
  const transaction = await prisma.walletTransaction.findUnique({
    where: { id: transactionId },
    include: { wallet: true }
  })
  
  if (!transaction) {
    throw new Error('Transaction not found')
  }
  
  if (transaction.status !== WalletTransactionStatus.PENDING && 
      transaction.status !== WalletTransactionStatus.PROCESSING) {
    throw new Error('Transaction cannot be completed')
  }
  
  // Update wallet balance and transaction status
  const [updatedTransaction] = await prisma.$transaction([
    prisma.walletTransaction.update({
      where: { id: transactionId },
      data: {
        status: WalletTransactionStatus.COMPLETED,
        processedAt: new Date()
      }
    }),
    prisma.wallet.update({
      where: { id: transaction.walletId },
      data: {
        balance: { increment: transaction.netAmount },
        lifetimeEarned: { increment: transaction.netAmount }
      }
    })
  ])
  
  return updatedTransaction
}

// =============================================================================
// Withdrawal Operations
// =============================================================================

export async function initiateWithdrawal(request: WithdrawRequest) {
  const { userDid, amount, type, cashPointId, bankAccountId } = request
  
  const wallet = await getOrCreateWallet(userDid)
  
  // Check sufficient balance
  if (wallet.balance < amount) {
    throw new Error('Insufficient balance')
  }
  
  // Get withdrawal limits from config
  const minWithdrawal = await getConfigValue('min_withdrawal', 20)
  const maxWithdrawalDaily = await getConfigValue('max_withdrawal_daily', 5000)
  
  if (amount < minWithdrawal) {
    throw new Error(`Minimum withdrawal is ${minWithdrawal} MAD`)
  }
  
  // Check daily limit
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  const dailyWithdrawals = await prisma.walletTransaction.aggregate({
    where: {
      walletId: wallet.id,
      type: { in: [WalletTransactionType.WITHDRAWAL_CASH, WalletTransactionType.WITHDRAWAL_BANK] },
      status: { in: [WalletTransactionStatus.COMPLETED, WalletTransactionStatus.PENDING, WalletTransactionStatus.PROCESSING] },
      createdAt: { gte: today }
    },
    _sum: { amount: true }
  })
  
  const dailyTotal = (dailyWithdrawals._sum.amount || 0) + amount
  if (dailyTotal > maxWithdrawalDaily) {
    throw new Error(`Daily withdrawal limit is ${maxWithdrawalDaily} MAD`)
  }
  
  // Calculate withdrawal fee
  const feeCode = type === 'CASH' ? 'withdrawal_fee_cash' : 'withdrawal_fee_bank'
  const fee = await calculateFee(amount, feeCode)
  
  const transactionType = type === 'CASH' ? 
    WalletTransactionType.WITHDRAWAL_CASH : 
    WalletTransactionType.WITHDRAWAL_BANK
  
  // Create transaction and deduct from balance
  const [transaction] = await prisma.$transaction([
    prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: transactionType,
        amount: -amount, // Negative for withdrawal
        fee: fee.feeAmount,
        netAmount: -(amount + fee.feeAmount), // Total deducted
        status: WalletTransactionStatus.PENDING,
        cashPointId: cashPointId || null,
        description: `Withdrawal via ${type.toLowerCase()}`,
        metadata: { bankAccountId }
      }
    }),
    prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amount + fee.feeAmount }
      }
    })
  ])
  
  return { transaction, fee }
}

export async function completeWithdrawal(transactionId: string) {
  const transaction = await prisma.walletTransaction.findUnique({
    where: { id: transactionId }
  })
  
  if (!transaction) {
    throw new Error('Transaction not found')
  }
  
  if (transaction.status !== WalletTransactionStatus.PENDING) {
    throw new Error('Transaction cannot be completed')
  }
  
  return prisma.walletTransaction.update({
    where: { id: transactionId },
    data: {
      status: WalletTransactionStatus.COMPLETED,
      processedAt: new Date()
    }
  })
}

export async function cancelWithdrawal(transactionId: string, reason?: string) {
  const transaction = await prisma.walletTransaction.findUnique({
    where: { id: transactionId },
    include: { wallet: true }
  })
  
  if (!transaction) {
    throw new Error('Transaction not found')
  }
  
  if (transaction.status !== WalletTransactionStatus.PENDING) {
    throw new Error('Transaction cannot be cancelled')
  }
  
  // Refund the balance
  await prisma.$transaction([
    prisma.walletTransaction.update({
      where: { id: transactionId },
      data: {
        status: WalletTransactionStatus.CANCELLED,
        failureReason: reason
      }
    }),
    prisma.wallet.update({
      where: { id: transaction.walletId },
      data: {
        balance: { increment: Math.abs(transaction.netAmount) }
      }
    })
  ])
}

// =============================================================================
// Payment Operations (Market & Rides)
// =============================================================================

export async function processPayment(request: PaymentRequest) {
  const { buyerDid, sellerDid, amount, orderId, rideId, type, useEscrow = true } = request
  
  const buyerWallet = await getOrCreateWallet(buyerDid)
  const sellerWallet = await getOrCreateWallet(sellerDid)
  
  // Check buyer balance
  if (buyerWallet.balance < amount) {
    throw new Error('Insufficient balance')
  }
  
  // Calculate platform fee
  const feeCode = type === 'MARKET' ? 'platform_fee_market' : 'platform_fee_ride'
  const fee = await calculateFee(amount, feeCode)
  
  const transactionType = type === 'MARKET' ? 
    WalletTransactionType.PAYMENT_MARKET : 
    WalletTransactionType.PAYMENT_RIDE
  
  if (useEscrow) {
    // Create escrow hold
    const escrowReleaseDays = await getConfigValue('escrow_release_days', 7)
    const releaseAt = new Date()
    releaseAt.setDate(releaseAt.getDate() + escrowReleaseDays)
    
    const [buyerTx, escrow] = await prisma.$transaction([
      // Deduct from buyer
      prisma.walletTransaction.create({
        data: {
          walletId: buyerWallet.id,
          type: transactionType,
          amount: -amount,
          fee: 0,
          netAmount: -amount,
          status: WalletTransactionStatus.COMPLETED,
          referenceId: orderId || rideId,
          referenceType: type,
          description: `Payment for ${type.toLowerCase()}`
        }
      }),
      // Create escrow
      prisma.escrowHold.create({
        data: {
          buyerWalletId: buyerWallet.id,
          sellerWalletId: sellerWallet.id,
          amount,
          feeAmount: fee.feeAmount,
          sellerAmount: fee.netAmount,
          orderId,
          rideId,
          status: EscrowStatus.HELD,
          releaseAt
        }
      }),
      // Update buyer balance
      prisma.wallet.update({
        where: { id: buyerWallet.id },
        data: {
          balance: { decrement: amount },
          lifetimeSpent: { increment: amount }
        }
      }),
      // Update seller pending balance
      prisma.wallet.update({
        where: { id: sellerWallet.id },
        data: {
          pendingBalance: { increment: fee.netAmount }
        }
      })
    ])
    
    return { buyerTransaction: buyerTx, escrow, fee }
  } else {
    // Direct payment (no escrow)
    const [buyerTx, sellerTx] = await prisma.$transaction([
      // Deduct from buyer
      prisma.walletTransaction.create({
        data: {
          walletId: buyerWallet.id,
          type: transactionType,
          amount: -amount,
          fee: 0,
          netAmount: -amount,
          status: WalletTransactionStatus.COMPLETED,
          referenceId: orderId || rideId,
          referenceType: type,
          description: `Payment for ${type.toLowerCase()}`
        }
      }),
      // Credit to seller (minus fee)
      prisma.walletTransaction.create({
        data: {
          walletId: sellerWallet.id,
          type: WalletTransactionType.ESCROW_RELEASE,
          amount: amount,
          fee: fee.feeAmount,
          netAmount: fee.netAmount,
          status: WalletTransactionStatus.COMPLETED,
          referenceId: orderId || rideId,
          referenceType: type,
          description: `Payment received for ${type.toLowerCase()}`
        }
      }),
      // Update balances
      prisma.wallet.update({
        where: { id: buyerWallet.id },
        data: {
          balance: { decrement: amount },
          lifetimeSpent: { increment: amount }
        }
      }),
      prisma.wallet.update({
        where: { id: sellerWallet.id },
        data: {
          balance: { increment: fee.netAmount },
          lifetimeEarned: { increment: fee.netAmount }
        }
      })
    ])
    
    return { buyerTransaction: buyerTx, sellerTransaction: sellerTx, fee }
  }
}

// =============================================================================
// Escrow Operations
// =============================================================================

export async function releaseEscrow(escrowId: string) {
  const escrow = await prisma.escrowHold.findUnique({
    where: { id: escrowId },
    include: {
      sellerWallet: true
    }
  })
  
  if (!escrow) {
    throw new Error('Escrow not found')
  }
  
  if (escrow.status !== EscrowStatus.HELD) {
    throw new Error('Escrow already processed')
  }
  
  await prisma.$transaction([
    // Update escrow status
    prisma.escrowHold.update({
      where: { id: escrowId },
      data: {
        status: EscrowStatus.RELEASED,
        releasedAt: new Date()
      }
    }),
    // Create seller transaction
    prisma.walletTransaction.create({
      data: {
        walletId: escrow.sellerWalletId,
        type: WalletTransactionType.ESCROW_RELEASE,
        amount: escrow.amount,
        fee: escrow.feeAmount,
        netAmount: escrow.sellerAmount,
        status: WalletTransactionStatus.COMPLETED,
        referenceId: escrow.orderId || escrow.rideId || undefined,
        referenceType: escrow.orderId ? 'ORDER' : 'RIDE',
        description: 'Escrow released'
      }
    }),
    // Move from pending to available
    prisma.wallet.update({
      where: { id: escrow.sellerWalletId },
      data: {
        pendingBalance: { decrement: escrow.sellerAmount },
        balance: { increment: escrow.sellerAmount },
        lifetimeEarned: { increment: escrow.sellerAmount }
      }
    })
  ])
  
  return { success: true, escrowId }
}

export async function refundEscrow(escrowId: string, reason?: string) {
  const escrow = await prisma.escrowHold.findUnique({
    where: { id: escrowId },
    include: {
      buyerWallet: true,
      sellerWallet: true
    }
  })
  
  if (!escrow) {
    throw new Error('Escrow not found')
  }
  
  if (escrow.status !== EscrowStatus.HELD && escrow.status !== EscrowStatus.DISPUTED) {
    throw new Error('Escrow cannot be refunded')
  }
  
  await prisma.$transaction([
    // Update escrow status
    prisma.escrowHold.update({
      where: { id: escrowId },
      data: {
        status: EscrowStatus.REFUNDED,
        releasedAt: new Date(),
        resolution: 'REFUND_BUYER'
      }
    }),
    // Create refund transaction for buyer
    prisma.walletTransaction.create({
      data: {
        walletId: escrow.buyerWalletId,
        type: WalletTransactionType.REFUND,
        amount: escrow.amount,
        fee: 0,
        netAmount: escrow.amount,
        status: WalletTransactionStatus.COMPLETED,
        referenceId: escrow.orderId || escrow.rideId || undefined,
        referenceType: escrow.orderId ? 'ORDER' : 'RIDE',
        description: reason || 'Escrow refunded'
      }
    }),
    // Refund buyer balance
    prisma.wallet.update({
      where: { id: escrow.buyerWalletId },
      data: {
        balance: { increment: escrow.amount }
      }
    }),
    // Remove from seller pending
    prisma.wallet.update({
      where: { id: escrow.sellerWalletId },
      data: {
        pendingBalance: { decrement: escrow.sellerAmount }
      }
    })
  ])
  
  return { success: true, escrowId }
}

// =============================================================================
// Configuration Helpers
// =============================================================================

async function getConfigValue(key: string, defaultValue: number, cityId?: string): Promise<number> {
  const config = await prisma.walletConfig.findFirst({
    where: {
      key,
      cityId: cityId || null,
      isActive: true
    }
  })
  
  if (config) {
    try {
      return JSON.parse(config.value)
    } catch {
      return defaultValue
    }
  }
  
  // Try global config if city-specific not found
  if (cityId) {
    return getConfigValue(key, defaultValue)
  }
  
  return defaultValue
}

// =============================================================================
// Cash Points
// =============================================================================

export async function getNearbyCashPoints(
  latitude: number,
  longitude: number,
  radiusKm: number = 10,
  type?: string
) {
  // Simple distance calculation (for production, use PostGIS or similar)
  const cashPoints = await prisma.cashPoint.findMany({
    where: {
      isActive: true,
      ...(type ? { type: type as any } : {})
    },
    include: {
      city: true,
      agent: {
        select: {
          name: true,
          phone: true
        }
      }
    }
  })
  
  // Calculate distance and filter
  const nearby = cashPoints
    .map(cp => {
      const distance = haversineDistance(latitude, longitude, cp.latitude, cp.longitude)
      return { ...cp, distance }
    })
    .filter(cp => cp.distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
  
  return nearby
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}

export default {
  getOrCreateWallet,
  getWalletBalance,
  getWalletTransactions,
  calculateFee,
  initiateDeposit,
  completeDeposit,
  initiateWithdrawal,
  completeWithdrawal,
  cancelWithdrawal,
  processPayment,
  releaseEscrow,
  refundEscrow,
  getNearbyCashPoints,
  // PIN management
  setWalletPin,
  changeWalletPin,
  verifyWalletPin,
  hasPinSet,
  // Wallet info
  getWalletInfo
}
