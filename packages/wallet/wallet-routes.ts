/**
 * Wallet API Routes
 * Express router for wallet operations
 */

import express, { Request, Response } from 'express'
import walletService from './wallet-service'

const router = express.Router()

// =============================================================================
// Middleware - Auth check (simplified, implement proper auth)
// =============================================================================

function requireAuth(req: Request, res: Response, next: Function) {
  const userDid = req.headers['x-user-did'] as string
  if (!userDid) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  (req as any).userDid = userDid
  next()
}

// =============================================================================
// Wallet Routes
// =============================================================================

/**
 * GET /api/wallet
 * Get wallet balance and info
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const balance = await walletService.getWalletBalance(userDid)
    res.json({ success: true, data: balance })
  } catch (error: any) {
    console.error('[Wallet] Get balance error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/wallet/balance
 * Get wallet balance breakdown (alias for main endpoint)
 */
router.get('/balance', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const balance = await walletService.getWalletBalance(userDid)
    res.json({ success: true, data: balance })
  } catch (error: any) {
    console.error('[Wallet] Get balance error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/wallet/transactions
 * Get transaction history
 */
router.get('/transactions', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const { limit, offset, type, status } = req.query
    
    const result = await walletService.getWalletTransactions(userDid, {
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
      type: type as any,
      status: status as any
    })
    
    res.json({ success: true, data: result })
  } catch (error: any) {
    console.error('[Wallet] Get transactions error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// PIN Management Routes
// =============================================================================

/**
 * GET /api/wallet/pin/status
 * Check if PIN is set
 */
router.get('/pin/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const hasPin = await walletService.hasPinSet(userDid)
    res.json({ success: true, data: { hasPinSet: hasPin } })
  } catch (error: any) {
    console.error('[Wallet] PIN status error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/pin/set
 * Set wallet PIN for first time
 */
router.post('/pin/set', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const { pin, confirmPin } = req.body
    
    if (!pin || !confirmPin) {
      return res.status(400).json({ error: 'PIN and confirmation required' })
    }
    
    if (pin !== confirmPin) {
      return res.status(400).json({ error: 'PINs do not match' })
    }
    
    await walletService.setWalletPin(userDid, pin)
    res.json({ success: true, data: { message: 'PIN set successfully' } })
  } catch (error: any) {
    console.error('[Wallet] Set PIN error:', error)
    res.status(400).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/pin/change
 * Change wallet PIN
 */
router.post('/pin/change', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const { currentPin, newPin, confirmNewPin } = req.body
    
    if (!currentPin || !newPin || !confirmNewPin) {
      return res.status(400).json({ error: 'All PIN fields required' })
    }
    
    if (newPin !== confirmNewPin) {
      return res.status(400).json({ error: 'New PINs do not match' })
    }
    
    await walletService.changeWalletPin(userDid, currentPin, newPin)
    res.json({ success: true, data: { message: 'PIN changed successfully' } })
  } catch (error: any) {
    console.error('[Wallet] Change PIN error:', error)
    res.status(400).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/pin/verify
 * Verify wallet PIN
 */
router.post('/pin/verify', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const { pin } = req.body
    
    if (!pin) {
      return res.status(400).json({ error: 'PIN required' })
    }
    
    const valid = await walletService.verifyWalletPin(userDid, pin)
    res.json({ success: true, data: { valid } })
  } catch (error: any) {
    console.error('[Wallet] Verify PIN error:', error)
    res.status(400).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/deposit
 * Initiate a deposit
 */
router.post('/deposit', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const { amount, type, cashPointId, stripePaymentIntentId, metadata } = req.body
    
    if (!amount || !type) {
      return res.status(400).json({ error: 'Amount and type are required' })
    }
    
    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' })
    }
    
    const result = await walletService.initiateDeposit({
      userDid,
      amount,
      type,
      cashPointId,
      stripePaymentIntentId,
      metadata
    })
    
    res.json({ success: true, data: result })
  } catch (error: any) {
    console.error('[Wallet] Deposit error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/deposit/:id/complete
 * Complete a deposit (agent or Stripe webhook)
 */
router.post('/deposit/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    // TODO: Verify agent auth or Stripe signature
    
    const transaction = await walletService.completeDeposit(id)
    res.json({ success: true, data: transaction })
  } catch (error: any) {
    console.error('[Wallet] Complete deposit error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/withdraw
 * Initiate a withdrawal
 */
router.post('/withdraw', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const { amount, type, cashPointId, bankAccountId, pin } = req.body
    
    if (!amount || !type) {
      return res.status(400).json({ error: 'Amount and type are required' })
    }
    
    // TODO: Verify PIN
    
    const result = await walletService.initiateWithdrawal({
      userDid,
      amount,
      type,
      cashPointId,
      bankAccountId,
      pin
    })
    
    res.json({ success: true, data: result })
  } catch (error: any) {
    console.error('[Wallet] Withdraw error:', error)
    res.status(400).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/withdraw/:id/complete
 * Complete a withdrawal (agent)
 */
router.post('/withdraw/:id/complete', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    // TODO: Verify agent auth
    
    const transaction = await walletService.completeWithdrawal(id)
    res.json({ success: true, data: transaction })
  } catch (error: any) {
    console.error('[Wallet] Complete withdrawal error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/withdraw/:id/cancel
 * Cancel a withdrawal
 */
router.post('/withdraw/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { reason } = req.body
    
    await walletService.cancelWithdrawal(id, reason)
    res.json({ success: true })
  } catch (error: any) {
    console.error('[Wallet] Cancel withdrawal error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/pay
 * Process a payment (Market or Ride)
 */
router.post('/pay', requireAuth, async (req: Request, res: Response) => {
  try {
    const buyerDid = (req as any).userDid
    const { sellerDid, amount, orderId, rideId, type, useEscrow } = req.body
    
    if (!sellerDid || !amount || !type) {
      return res.status(400).json({ error: 'Missing required fields' })
    }
    
    const result = await walletService.processPayment({
      buyerDid,
      sellerDid,
      amount,
      orderId,
      rideId,
      type,
      useEscrow
    })
    
    res.json({ success: true, data: result })
  } catch (error: any) {
    console.error('[Wallet] Payment error:', error)
    res.status(400).json({ error: error.message })
  }
})

/**
 * GET /api/wallet/escrow
 * Get user's escrow holds
 */
router.get('/escrow', requireAuth, async (req: Request, res: Response) => {
  try {
    const userDid = (req as any).userDid
    const wallet = await walletService.getOrCreateWallet(userDid)
    
    // TODO: Implement escrow list in service
    res.json({ success: true, data: [] })
  } catch (error: any) {
    console.error('[Wallet] Get escrow error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/escrow/:id/release
 * Release escrow (buyer confirms delivery)
 */
router.post('/escrow/:id/release', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    // TODO: Verify buyer owns this escrow
    
    const result = await walletService.releaseEscrow(id)
    res.json({ success: true, data: result })
  } catch (error: any) {
    console.error('[Wallet] Release escrow error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * POST /api/wallet/escrow/:id/dispute
 * Dispute an escrow
 */
router.post('/escrow/:id/dispute', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { reason } = req.body
    
    // TODO: Implement dispute flow
    res.json({ success: true, message: 'Dispute submitted' })
  } catch (error: any) {
    console.error('[Wallet] Dispute escrow error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Cash Points Routes
// =============================================================================

/**
 * GET /api/wallet/cash-points
 * Get nearby cash points
 */
router.get('/cash-points', async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, radius, type } = req.query
    
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Location required' })
    }
    
    const cashPoints = await walletService.getNearbyCashPoints(
      parseFloat(latitude as string),
      parseFloat(longitude as string),
      radius ? parseFloat(radius as string) : undefined,
      type as string
    )
    
    res.json({ success: true, data: cashPoints })
  } catch (error: any) {
    console.error('[Wallet] Get cash points error:', error)
    res.status(500).json({ error: error.message })
  }
})

/**
 * GET /api/wallet/cash-points/:id
 * Get cash point details
 */
router.get('/cash-points/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    
    // TODO: Implement in service
    res.json({ success: true, data: null })
  } catch (error: any) {
    console.error('[Wallet] Get cash point error:', error)
    res.status(500).json({ error: error.message })
  }
})

// =============================================================================
// Fee Calculation Route
// =============================================================================

/**
 * POST /api/wallet/calculate-fee
 * Calculate fee for an amount
 */
router.post('/calculate-fee', async (req: Request, res: Response) => {
  try {
    const { amount, feeCode, cityId } = req.body
    
    if (!amount || !feeCode) {
      return res.status(400).json({ error: 'Amount and feeCode required' })
    }
    
    const fee = await walletService.calculateFee(amount, feeCode, cityId)
    res.json({ success: true, data: fee })
  } catch (error: any) {
    console.error('[Wallet] Calculate fee error:', error)
    res.status(500).json({ error: error.message })
  }
})

export default router
