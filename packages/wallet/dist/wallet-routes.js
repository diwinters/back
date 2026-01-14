"use strict";
/**
 * Wallet API Routes
 * Express router for wallet operations
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const wallet_service_1 = __importDefault(require("./wallet-service"));
const router = express_1.default.Router();
// =============================================================================
// Middleware - Auth check (simplified, implement proper auth)
// =============================================================================
function requireAuth(req, res, next) {
    const userDid = req.headers['x-user-did'];
    console.log('[WalletRoutes] 🔐 Auth check - DID:', userDid ? userDid.substring(0, 25) + '...' : 'MISSING');
    if (!userDid) {
        console.log('[WalletRoutes] ❌ Unauthorized - no DID header');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userDid = userDid;
    next();
}
// =============================================================================
// Wallet Routes
// =============================================================================
/**
 * GET /api/wallet
 * Get wallet info including PIN status
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        console.log('[WalletRoutes] 📱 GET /api/wallet - DID:', userDid.substring(0, 25) + '...');
        const walletInfo = await wallet_service_1.default.getWalletInfo(userDid);
        console.log('[WalletRoutes] ✅ Wallet info retrieved:', { id: walletInfo.id, hasPinSet: walletInfo.hasPinSet });
        res.json({ success: true, data: walletInfo });
    }
    catch (error) {
        console.error('[WalletRoutes] ❌ Get wallet info error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/wallet/balance
 * Get wallet balance breakdown (alias for main endpoint)
 */
router.get('/balance', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        console.log('[WalletRoutes] 💰 GET /api/wallet/balance - DID:', userDid.substring(0, 25) + '...');
        const balance = await wallet_service_1.default.getWalletBalance(userDid);
        console.log('[WalletRoutes] ✅ Balance retrieved:', balance);
        res.json({ success: true, data: balance });
    }
    catch (error) {
        console.error('[WalletRoutes] ❌ Get balance error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/wallet/transactions
 * Get transaction history
 */
router.get('/transactions', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        const { limit, offset, type, status } = req.query;
        console.log('[WalletRoutes] 📝 GET /api/wallet/transactions - DID:', userDid.substring(0, 25) + '...', { limit, offset, type, status });
        const result = await wallet_service_1.default.getWalletTransactions(userDid, {
            limit: limit ? parseInt(limit) : undefined,
            offset: offset ? parseInt(offset) : undefined,
            type: type,
            status: status
        });
        console.log('[WalletRoutes] ✅ Transactions retrieved:', { count: result.transactions.length, total: result.total });
        res.json({ success: true, data: result });
    }
    catch (error) {
        console.error('[WalletRoutes] ❌ Get transactions error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
// =============================================================================
// PIN Management Routes
// =============================================================================
/**
 * GET /api/wallet/pin/status
 * Check if PIN is set
 */
router.get('/pin/status', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        const hasPin = await wallet_service_1.default.hasPinSet(userDid);
        res.json({ success: true, data: { hasPinSet: hasPin } });
    }
    catch (error) {
        console.error('[Wallet] PIN status error:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/pin/set
 * Set wallet PIN for first time
 */
router.post('/pin/set', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        const { pin, confirmPin } = req.body;
        if (!pin || !confirmPin) {
            return res.status(400).json({ error: 'PIN and confirmation required' });
        }
        if (pin !== confirmPin) {
            return res.status(400).json({ error: 'PINs do not match' });
        }
        await wallet_service_1.default.setWalletPin(userDid, pin);
        res.json({ success: true, data: { message: 'PIN set successfully' } });
    }
    catch (error) {
        console.error('[Wallet] Set PIN error:', error);
        res.status(400).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/pin/change
 * Change wallet PIN
 */
router.post('/pin/change', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        const { currentPin, newPin, confirmNewPin } = req.body;
        if (!currentPin || !newPin || !confirmNewPin) {
            return res.status(400).json({ error: 'All PIN fields required' });
        }
        if (newPin !== confirmNewPin) {
            return res.status(400).json({ error: 'New PINs do not match' });
        }
        await wallet_service_1.default.changeWalletPin(userDid, currentPin, newPin);
        res.json({ success: true, data: { message: 'PIN changed successfully' } });
    }
    catch (error) {
        console.error('[Wallet] Change PIN error:', error);
        res.status(400).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/pin/verify
 * Verify wallet PIN
 */
router.post('/pin/verify', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        const { pin } = req.body;
        if (!pin) {
            return res.status(400).json({ error: 'PIN required' });
        }
        const valid = await wallet_service_1.default.verifyWalletPin(userDid, pin);
        res.json({ success: true, data: { valid } });
    }
    catch (error) {
        console.error('[Wallet] Verify PIN error:', error);
        res.status(400).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/deposit
 * Initiate a deposit
 */
router.post('/deposit', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        // Support both 'method' (frontend) and 'type' (original)
        const { amount, method, type, cashPointId, stripePaymentIntentId, metadata } = req.body;
        const depositType = method || type;
        console.log('[WalletRoutes] 💰 POST /api/wallet/deposit:', { userDid: userDid.substring(0, 25) + '...', amount, depositType, cashPointId });
        if (!amount || !depositType) {
            console.log('[WalletRoutes] ❌ Deposit validation failed: missing amount or type');
            return res.status(400).json({ error: 'Amount and method/type are required' });
        }
        if (amount <= 0) {
            console.log('[WalletRoutes] ❌ Deposit validation failed: negative amount');
            return res.status(400).json({ error: 'Amount must be positive' });
        }
        const result = await wallet_service_1.default.initiateDeposit({
            userDid,
            amount,
            type: depositType,
            cashPointId,
            stripePaymentIntentId,
            metadata
        });
        console.log('[WalletRoutes] ✅ Deposit initiated:', { transactionId: result.transaction?.id, status: result.transaction?.status });
        res.json({ success: true, data: result });
    }
    catch (error) {
        console.error('[WalletRoutes] ❌ Deposit error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/deposit/:id/complete
 * Complete a deposit (agent or Stripe webhook)
 */
router.post('/deposit/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        console.log('[WalletRoutes] 💰 POST /api/wallet/deposit/:id/complete - ID:', id);
        // TODO: Verify agent auth or Stripe signature
        const transaction = await wallet_service_1.default.completeDeposit(id);
        console.log('[WalletRoutes] ✅ Deposit completed:', { id, status: transaction.status });
        res.json({ success: true, data: transaction });
    }
    catch (error) {
        console.error('[WalletRoutes] ❌ Complete deposit error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/withdraw
 * Initiate a withdrawal
 */
router.post('/withdraw', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        const { amount, type, cashPointId, bankAccountId, pin } = req.body;
        console.log('[WalletRoutes] 💸 POST /api/wallet/withdraw:', { userDid: userDid.substring(0, 25) + '...', amount, type, cashPointId });
        if (!amount || !type) {
            console.log('[WalletRoutes] ❌ Withdrawal validation failed: missing amount or type');
            return res.status(400).json({ error: 'Amount and type are required' });
        }
        // TODO: Verify PIN
        const result = await wallet_service_1.default.initiateWithdrawal({
            userDid,
            amount,
            type,
            cashPointId,
            bankAccountId,
            pin
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        console.error('[Wallet] Withdraw error:', error);
        res.status(400).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/withdraw/:id/complete
 * Complete a withdrawal (agent)
 */
router.post('/withdraw/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        // TODO: Verify agent auth
        const transaction = await wallet_service_1.default.completeWithdrawal(id);
        res.json({ success: true, data: transaction });
    }
    catch (error) {
        console.error('[Wallet] Complete withdrawal error:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/withdraw/:id/cancel
 * Cancel a withdrawal
 */
router.post('/withdraw/:id/cancel', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        await wallet_service_1.default.cancelWithdrawal(id, reason);
        res.json({ success: true });
    }
    catch (error) {
        console.error('[Wallet] Cancel withdrawal error:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/pay
 * Process a payment (Market or Ride)
 */
router.post('/pay', requireAuth, async (req, res) => {
    try {
        const buyerDid = req.userDid;
        const { sellerDid, amount, orderId, rideId, type, useEscrow } = req.body;
        if (!sellerDid || !amount || !type) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        const result = await wallet_service_1.default.processPayment({
            buyerDid,
            sellerDid,
            amount,
            orderId,
            rideId,
            type,
            useEscrow
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        console.error('[Wallet] Payment error:', error);
        res.status(400).json({ error: error.message });
    }
});
/**
 * GET /api/wallet/escrow
 * Get user's escrow holds
 */
router.get('/escrow', requireAuth, async (req, res) => {
    try {
        const userDid = req.userDid;
        const wallet = await wallet_service_1.default.getOrCreateWallet(userDid);
        // TODO: Implement escrow list in service
        res.json({ success: true, data: [] });
    }
    catch (error) {
        console.error('[Wallet] Get escrow error:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/escrow/:id/release
 * Release escrow (buyer confirms delivery)
 */
router.post('/escrow/:id/release', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        // TODO: Verify buyer owns this escrow
        const result = await wallet_service_1.default.releaseEscrow(id);
        res.json({ success: true, data: result });
    }
    catch (error) {
        console.error('[Wallet] Release escrow error:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/escrow/:id/dispute
 * Dispute an escrow
 */
router.post('/escrow/:id/dispute', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        // TODO: Implement dispute flow
        res.json({ success: true, message: 'Dispute submitted' });
    }
    catch (error) {
        console.error('[Wallet] Dispute escrow error:', error);
        res.status(500).json({ error: error.message });
    }
});
// =============================================================================
// Cash Points Routes
// =============================================================================
/**
 * GET /api/wallet/cash-points
 * Get nearby cash points
 */
router.get('/cash-points', async (req, res) => {
    try {
        // Support both lat/lng and latitude/longitude
        const lat = req.query.lat || req.query.latitude;
        const lng = req.query.lng || req.query.longitude;
        const { radius, type } = req.query;
        if (!lat || !lng) {
            return res.status(400).json({ error: 'Location required (lat/lng or latitude/longitude)' });
        }
        const cashPoints = await wallet_service_1.default.getNearbyCashPoints(parseFloat(lat), parseFloat(lng), radius ? parseFloat(radius) : undefined, type);
        res.json({ success: true, data: cashPoints });
    }
    catch (error) {
        console.error('[Wallet] Get cash points error:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/wallet/cash-points/:id
 * Get cash point details
 */
router.get('/cash-points/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // TODO: Implement in service
        res.json({ success: true, data: null });
    }
    catch (error) {
        console.error('[Wallet] Get cash point error:', error);
        res.status(500).json({ error: error.message });
    }
});
// =============================================================================
// Fee Calculation Route
// =============================================================================
/**
 * GET /api/wallet/calculate-fee
 * Calculate fee for an amount (frontend calls this)
 */
router.get('/calculate-fee', async (req, res) => {
    try {
        const { amount, type, feeCode, cityId } = req.query;
        // Support both 'type' (frontend) and 'feeCode' (original)
        const code = (type || feeCode);
        if (!amount || !code) {
            return res.status(400).json({ error: 'Amount and type/feeCode required' });
        }
        const fee = await wallet_service_1.default.calculateFee(parseFloat(amount), code, cityId);
        res.json({ success: true, data: fee });
    }
    catch (error) {
        console.error('[Wallet] Calculate fee error:', error);
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/wallet/calculate-fee
 * Calculate fee for an amount
 */
router.post('/calculate-fee', async (req, res) => {
    try {
        const { amount, feeCode, cityId } = req.body;
        if (!amount || !feeCode) {
            return res.status(400).json({ error: 'Amount and feeCode required' });
        }
        const fee = await wallet_service_1.default.calculateFee(amount, feeCode, cityId);
        res.json({ success: true, data: fee });
    }
    catch (error) {
        console.error('[Wallet] Calculate fee error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=wallet-routes.js.map