/**
 * Wallet Admin API Routes
 * Admin-only routes for wallet configuration and management
 */

import express, { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const router = express.Router()
const prisma = new PrismaClient()

// =============================================================================
// Middleware - Admin Auth check
// =============================================================================

function requireAdmin(req: Request, res: Response, next: Function) {
  // TODO: Implement proper admin auth
  const adminToken = req.headers['x-admin-token']
  if (!adminToken) {
    return res.status(401).json({ error: 'Admin access required' })
  }
  next()
}

router.use(requireAdmin)

// =============================================================================
// Fee Configuration
// =============================================================================

/**
 * GET /api/admin/wallet/fees
 * List all fee configurations
 */
router.get('/fees', async (req: Request, res: Response) => {
  try {
    const { cityId, isActive } = req.query
    
    const fees = await prisma.walletFeeConfig.findMany({
      where: {
        ...(cityId ? { cityId: cityId as string } : {}),
        ...(isActive !== undefined ? { isActive: isActive === 'true' } : {})
      },
      include: {
        city: {
          select: { id: true, name: true, code: true }
        }
      },
      orderBy: { code: 'asc' }
    })
    
    res.json({ success: true, data: fees })
  } catch (error: any) {
    console.error('[Admin Wallet] List fees error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/wallet/fees
 * Create a fee configuration
 */
router.post('/fees', async (req: Request, res: Response) => {
  try {
    const { name, code, description, type, value, minAmount, maxAmount, tiers, appliesTo, cityId, isActive } = req.body
    
    if (!name || !code || !type || value === undefined) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    
    // Check for duplicate code + cityId combo
    const existing = await prisma.walletFeeConfig.findFirst({
      where: { code, cityId: cityId || null }
    })
    
    if (existing) {
      return res.status(400).json({ error: 'Fee config with this code already exists' })
    }
    
    const fee = await prisma.walletFeeConfig.create({
      data: {
        name,
        code,
        description,
        type,
        value,
        minAmount,
        maxAmount,
        tiers,
        appliesTo: appliesTo || [],
        cityId: cityId || null,
        isActive: isActive !== false
      }
    })
    
    res.json({ success: true, data: fee })
  } catch (error: any) {
    console.error('[Admin Wallet] Create fee error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * PUT /api/admin/wallet/fees/:id
 * Update a fee configuration
 */
router.put('/fees/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { name, description, type, value, minAmount, maxAmount, tiers, appliesTo, isActive } = req.body
    
    const fee = await prisma.walletFeeConfig.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(type && { type }),
        ...(value !== undefined && { value }),
        ...(minAmount !== undefined && { minAmount }),
        ...(maxAmount !== undefined && { maxAmount }),
        ...(tiers !== undefined && { tiers }),
        ...(appliesTo && { appliesTo }),
        ...(isActive !== undefined && { isActive })
      }
    })
    
    res.json({ success: true, data: fee })
  } catch (error: any) {
    console.error('[Admin Wallet] Update fee error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/admin/wallet/fees/:id
 * Delete a fee configuration
 */
router.delete('/fees/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    await prisma.walletFeeConfig.delete({ where: { id } })
    
    res.json({ success: true })
  } catch (error: any) {
    console.error('[Admin Wallet] Delete fee error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Wallet Configuration (Key-Value)
// =============================================================================

/**
 * GET /api/admin/wallet/config
 * List all wallet configs
 */
router.get('/config', async (req: Request, res: Response) => {
  try {
    const { cityId } = req.query
    
    const configs = await prisma.walletConfig.findMany({
      where: cityId ? { cityId: cityId as string } : {},
      include: {
        city: {
          select: { id: true, name: true, code: true }
        }
      },
      orderBy: { key: 'asc' }
    })
    
    res.json({ success: true, data: configs })
  } catch (error: any) {
    console.error('[Admin Wallet] List configs error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * PUT /api/admin/wallet/config
 * Set a wallet config value
 */
router.put('/config', async (req: Request, res: Response) => {
  try {
    const { key, value, description, cityId } = req.body
    
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'Key and value required' })
    }
    
    const config = await prisma.walletConfig.upsert({
      where: {
        key: key // This needs a unique constraint
      },
      create: {
        key,
        value: JSON.stringify(value),
        description,
        cityId: cityId || null
      },
      update: {
        value: JSON.stringify(value),
        ...(description && { description })
      }
    })
    
    res.json({ success: true, data: config })
  } catch (error: any) {
    console.error('[Admin Wallet] Set config error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Cash Points Management
// =============================================================================

/**
 * GET /api/admin/wallet/cash-points
 * List all cash points
 */
router.get('/cash-points', async (req: Request, res: Response) => {
  try {
    const { cityId, type, isActive, isVerified } = req.query
    
    const cashPoints = await prisma.cashPoint.findMany({
      where: {
        ...(cityId ? { cityId: cityId as string } : {}),
        ...(type ? { type: type as any } : {}),
        ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
        ...(isVerified !== undefined ? { isVerified: isVerified === 'true' } : {})
      },
      include: {
        city: { select: { id: true, name: true, code: true } },
        agent: { select: { id: true, name: true, phone: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    res.json({ success: true, data: cashPoints })
  } catch (error: any) {
    console.error('[Admin Wallet] List cash points error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/wallet/cash-points
 * Create a cash point
 */
router.post('/cash-points', async (req: Request, res: Response) => {
  try {
    const { 
      name, nameAr, type, cityId, address, addressAr, 
      latitude, longitude, operatingHours, phone,
      dailyDepositLimit, dailyWithdrawalLimit, agentId,
      isActive, isVerified
    } = req.body
    
    if (!name || !type || !cityId || !address || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    
    const cashPoint = await prisma.cashPoint.create({
      data: {
        name,
        nameAr,
        type,
        cityId,
        address,
        addressAr,
        latitude,
        longitude,
        operatingHours,
        phone,
        dailyDepositLimit,
        dailyWithdrawalLimit,
        agentId,
        isActive: isActive !== false,
        isVerified: isVerified === true
      }
    })
    
    res.json({ success: true, data: cashPoint })
  } catch (error: any) {
    console.error('[Admin Wallet] Create cash point error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * PUT /api/admin/wallet/cash-points/:id
 * Update a cash point
 */
router.put('/cash-points/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const updates = req.body
    
    const cashPoint = await prisma.cashPoint.update({
      where: { id },
      data: updates
    })
    
    res.json({ success: true, data: cashPoint })
  } catch (error: any) {
    console.error('[Admin Wallet] Update cash point error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * DELETE /api/admin/wallet/cash-points/:id
 * Delete a cash point
 */
router.delete('/cash-points/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    await prisma.cashPoint.delete({ where: { id } })
    
    res.json({ success: true })
  } catch (error: any) {
    console.error('[Admin Wallet] Delete cash point error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Cash Point Agents Management
// =============================================================================

/**
 * GET /api/admin/wallet/agents
 * List all agents
 */
router.get('/agents', async (req: Request, res: Response) => {
  try {
    const { isActive, isVerified } = req.query
    
    const agents = await prisma.cashPointAgent.findMany({
      where: {
        ...(isActive !== undefined ? { isActive: isActive === 'true' } : {}),
        ...(isVerified !== undefined ? { isVerified: isVerified === 'true' } : {})
      },
      include: {
        cashPoints: {
          select: { id: true, name: true, type: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    
    res.json({ success: true, data: agents })
  } catch (error: any) {
    console.error('[Admin Wallet] List agents error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/wallet/agents
 * Create an agent
 */
router.post('/agents', async (req: Request, res: Response) => {
  try {
    const { userDid, name, phone, email, nationalId, commissionRate, documents, isVerified, isActive } = req.body
    
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone required' })
    }
    
    const agent = await prisma.cashPointAgent.create({
      data: {
        userDid,
        name,
        phone,
        email,
        nationalId,
        commissionRate: commissionRate || 0.01,
        documents,
        isVerified: isVerified === true,
        isActive: isActive !== false
      }
    })
    
    res.json({ success: true, data: agent })
  } catch (error: any) {
    console.error('[Admin Wallet] Create agent error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * PUT /api/admin/wallet/agents/:id
 * Update an agent
 */
router.put('/agents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const updates = req.body
    
    const agent = await prisma.cashPointAgent.update({
      where: { id },
      data: updates
    })
    
    res.json({ success: true, data: agent })
  } catch (error: any) {
    console.error('[Admin Wallet] Update agent error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Transaction Monitoring
// =============================================================================

/**
 * GET /api/admin/wallet/transactions
 * List all transactions (with filters)
 */
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const { 
      type, status, minAmount, maxAmount, 
      startDate, endDate, userDid,
      limit = '50', offset = '0'
    } = req.query
    
    const where: any = {}
    
    if (type) where.type = type
    if (status) where.status = status
    if (minAmount) where.amount = { ...where.amount, gte: parseFloat(minAmount as string) }
    if (maxAmount) where.amount = { ...where.amount, lte: parseFloat(maxAmount as string) }
    if (startDate) where.createdAt = { ...where.createdAt, gte: new Date(startDate as string) }
    if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate as string) }
    if (userDid) {
      where.wallet = { userDid: userDid as string }
    }
    
    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where,
        include: {
          wallet: { select: { userDid: true } },
          cashPoint: { select: { name: true, type: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string)
      }),
      prisma.walletTransaction.count({ where })
    ])
    
    res.json({ 
      success: true, 
      data: { transactions, total, limit: parseInt(limit as string), offset: parseInt(offset as string) }
    })
  } catch (error: any) {
    console.error('[Admin Wallet] List transactions error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Escrow Management
// =============================================================================

/**
 * GET /api/admin/wallet/escrow
 * List all escrow holds
 */
router.get('/escrow', async (req: Request, res: Response) => {
  try {
    const { status, limit = '50', offset = '0' } = req.query
    
    const [escrows, total] = await Promise.all([
      prisma.escrowHold.findMany({
        where: status ? { status: status as any } : {},
        include: {
          buyerWallet: { select: { userDid: true } },
          sellerWallet: { select: { userDid: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string)
      }),
      prisma.escrowHold.count({ where: status ? { status: status as any } : {} })
    ])
    
    res.json({ 
      success: true, 
      data: { escrows, total, limit: parseInt(limit as string), offset: parseInt(offset as string) }
    })
  } catch (error: any) {
    console.error('[Admin Wallet] List escrow error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/wallet/escrow/:id/release
 * Admin force release escrow
 */
router.post('/escrow/:id/release', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { reason } = req.body
    
    // Import wallet service for this
    const walletService = require('./wallet-service').default
    const result = await walletService.releaseEscrow(id)
    
    // TODO: Log admin action
    
    res.json({ success: true, data: result })
  } catch (error: any) {
    console.error('[Admin Wallet] Release escrow error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/wallet/escrow/:id/refund
 * Admin force refund escrow
 */
router.post('/escrow/:id/refund', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { reason } = req.body
    
    const walletService = require('./wallet-service').default
    const result = await walletService.refundEscrow(id, reason)
    
    // TODO: Log admin action
    
    res.json({ success: true, data: result })
  } catch (error: any) {
    console.error('[Admin Wallet] Refund escrow error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Analytics / Stats
// =============================================================================

/**
 * GET /api/admin/wallet/stats
 * Get wallet system stats
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    const [
      totalWallets,
      totalBalance,
      todayDeposits,
      todayWithdrawals,
      pendingEscrow,
      activeCashPoints
    ] = await Promise.all([
      prisma.wallet.count(),
      prisma.wallet.aggregate({ _sum: { balance: true } }),
      prisma.walletTransaction.aggregate({
        where: {
          type: { in: ['DEPOSIT_CASH', 'DEPOSIT_CARD', 'DEPOSIT_BANK'] },
          status: 'COMPLETED',
          createdAt: { gte: today }
        },
        _sum: { amount: true },
        _count: true
      }),
      prisma.walletTransaction.aggregate({
        where: {
          type: { in: ['WITHDRAWAL_CASH', 'WITHDRAWAL_BANK'] },
          status: 'COMPLETED',
          createdAt: { gte: today }
        },
        _sum: { amount: true },
        _count: true
      }),
      prisma.escrowHold.aggregate({
        where: { status: 'HELD' },
        _sum: { amount: true },
        _count: true
      }),
      prisma.cashPoint.count({ where: { isActive: true } })
    ])
    
    res.json({
      success: true,
      data: {
        totalWallets,
        totalBalance: totalBalance._sum.balance || 0,
        todayDeposits: {
          count: todayDeposits._count,
          amount: todayDeposits._sum.amount || 0
        },
        todayWithdrawals: {
          count: todayWithdrawals._count,
          amount: Math.abs(todayWithdrawals._sum.amount || 0)
        },
        pendingEscrow: {
          count: pendingEscrow._count,
          amount: pendingEscrow._sum.amount || 0
        },
        activeCashPoints
      }
    })
  } catch (error: any) {
    console.error('[Admin Wallet] Stats error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Admin Wallet Top-Up
// =============================================================================

/**
 * GET /api/admin/wallet/users
 * Search users by handle or DID
 */
router.get('/users', async (req: Request, res: Response) => {
  try {
    const { search } = req.query
    
    if (!search || (search as string).length < 2) {
      return res.json({ success: true, data: [] })
    }
    
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { handle: { contains: search as string, mode: 'insensitive' } },
          { displayName: { contains: search as string, mode: 'insensitive' } },
          { did: { contains: search as string } }
        ]
      },
      include: {
        wallet: {
          select: { id: true, available: true, pending: true, held: true, total: true }
        }
      },
      take: 20
    })
    
    res.json({ success: true, data: users })
  } catch (error: any) {
    console.error('[Admin Wallet] Search users error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/admin/wallet/users/:did
 * Get user wallet details by DID
 */
router.get('/users/:did', async (req: Request, res: Response) => {
  try {
    const { did } = req.params
    
    const user = await prisma.user.findFirst({
      where: { did },
      include: {
        wallet: {
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 50
            }
          }
        }
      }
    })
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    res.json({ success: true, data: user })
  } catch (error: any) {
    console.error('[Admin Wallet] Get user error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/wallet/top-up
 * Admin top-up a user's wallet
 */
router.post('/top-up', async (req: Request, res: Response) => {
  try {
    const { userDid, amount, reason, adminNote } = req.body
    
    if (!userDid || !amount) {
      return res.status(400).json({ error: 'User DID and amount are required' })
    }
    
    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' })
    }
    
    // Find user
    const user = await prisma.user.findFirst({
      where: { did: userDid },
      include: { wallet: true }
    })
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }
    
    // Create wallet if doesn't exist
    let wallet = user.wallet
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: {
          user: { connect: { id: user.id } },
          available: 0,
          pending: 0,
          held: 0,
          total: 0,
          currency: 'MAD'
        }
      })
    }
    
    // Create transaction and update wallet balance
    const result = await prisma.$transaction(async (tx) => {
      // Create admin top-up transaction
      const transaction = await tx.walletTransaction.create({
        data: {
          wallet: { connect: { id: wallet!.id } },
          type: 'DEPOSIT_CASH', // Use DEPOSIT_CASH for admin top-ups
          status: 'COMPLETED',
          amount,
          fee: 0,
          netAmount: amount,
          currency: 'MAD',
          description: reason || 'Admin top-up',
          metadata: {
            adminTopUp: true,
            adminNote: adminNote || '',
            topUpDate: new Date().toISOString()
          }
        }
      })
      
      // Update wallet balance
      const updatedWallet = await tx.wallet.update({
        where: { id: wallet!.id },
        data: {
          available: { increment: amount },
          total: { increment: amount }
        }
      })
      
      return { transaction, wallet: updatedWallet }
    })
    
    console.log(`[Admin Wallet] Top-up successful: ${amount} MAD to user ${userDid}`)
    
    res.json({ 
      success: true, 
      data: result,
      message: `Successfully added ${amount} MAD to wallet`
    })
  } catch (error: any) {
    console.error('[Admin Wallet] Top-up error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/admin/wallet/deduct
 * Admin deduct from a user's wallet (for corrections, refunds, etc.)
 */
router.post('/deduct', async (req: Request, res: Response) => {
  try {
    const { userDid, amount, reason, adminNote } = req.body
    
    if (!userDid || !amount) {
      return res.status(400).json({ error: 'User DID and amount are required' })
    }
    
    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' })
    }
    
    // Find user's wallet
    const user = await prisma.user.findFirst({
      where: { did: userDid },
      include: { wallet: true }
    })
    
    if (!user || !user.wallet) {
      return res.status(404).json({ error: 'User wallet not found' })
    }
    
    if (user.wallet.available < amount) {
      return res.status(400).json({ error: 'Insufficient balance for deduction' })
    }
    
    // Create transaction and update wallet balance
    const result = await prisma.$transaction(async (tx) => {
      // Create deduction transaction
      const transaction = await tx.walletTransaction.create({
        data: {
          wallet: { connect: { id: user.wallet!.id } },
          type: 'WITHDRAWAL_CASH', // Use WITHDRAWAL for deductions
          status: 'COMPLETED',
          amount: -amount,
          fee: 0,
          netAmount: -amount,
          currency: 'MAD',
          description: reason || 'Admin deduction',
          metadata: {
            adminDeduction: true,
            adminNote: adminNote || '',
            deductionDate: new Date().toISOString()
          }
        }
      })
      
      // Update wallet balance
      const updatedWallet = await tx.wallet.update({
        where: { id: user.wallet!.id },
        data: {
          available: { decrement: amount },
          total: { decrement: amount }
        }
      })
      
      return { transaction, wallet: updatedWallet }
    })
    
    console.log(`[Admin Wallet] Deduction successful: ${amount} MAD from user ${userDid}`)
    
    res.json({ 
      success: true, 
      data: result,
      message: `Successfully deducted ${amount} MAD from wallet`
    })
  } catch (error: any) {
    console.error('[Admin Wallet] Deduction error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Seed Default Fees
// =============================================================================

/**
 * POST /api/admin/wallet/seed-defaults
 * Seed default fee configurations
 */
router.post('/seed-defaults', async (req: Request, res: Response) => {
  try {
    const defaults = [
      { code: 'platform_fee_market', name: 'Market Platform Fee', type: 'PERCENTAGE', value: 8, appliesTo: ['MARKET'] },
      { code: 'platform_fee_ride', name: 'Ride Platform Fee', type: 'PERCENTAGE', value: 5, appliesTo: ['RIDE'] },
      { code: 'deposit_fee_cash', name: 'Cash Deposit Fee', type: 'FIXED', value: 0, appliesTo: ['DEPOSIT'] },
      { code: 'deposit_fee_card', name: 'Card Deposit Fee', type: 'PERCENTAGE', value: 2.9, minAmount: 3, appliesTo: ['DEPOSIT'] },
      { code: 'deposit_fee_bank', name: 'Bank Deposit Fee', type: 'FIXED', value: 0, appliesTo: ['DEPOSIT'] },
      { code: 'withdrawal_fee_cash', name: 'Cash Withdrawal Fee', type: 'FIXED', value: 5, appliesTo: ['WITHDRAWAL'] },
      { code: 'withdrawal_fee_bank', name: 'Bank Withdrawal Fee', type: 'FIXED', value: 10, appliesTo: ['WITHDRAWAL'] },
      { code: 'cod_fee', name: 'Cash on Delivery Fee', type: 'FIXED', value: 5, appliesTo: ['MARKET'] }
    ]
    
    const configs = [
      { key: 'min_withdrawal', value: '20', description: 'Minimum withdrawal amount (MAD)' },
      { key: 'max_withdrawal_daily', value: '5000', description: 'Maximum daily withdrawal (MAD)' },
      { key: 'max_deposit_daily', value: '10000', description: 'Maximum daily deposit (MAD)' },
      { key: 'escrow_release_days', value: '7', description: 'Auto-release escrow after days' },
      { key: 'agent_commission', value: '0.01', description: 'Agent commission rate (1%)' }
    ]
    
    // Upsert fees
    for (const fee of defaults) {
      await prisma.walletFeeConfig.upsert({
        where: { code: fee.code },
        create: fee as any,
        update: {}
      })
    }
    
    // Upsert configs
    for (const config of configs) {
      await prisma.walletConfig.upsert({
        where: { key: config.key },
        create: config,
        update: {}
      })
    }
    
    res.json({ success: true, message: 'Default configurations seeded' })
  } catch (error: any) {
    console.error('[Admin Wallet] Seed defaults error:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
