"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cartRouter = void 0;
const express_1 = require("express");
const core_1 = require("@gominiapp/core");
const go_service_1 = require("@gominiapp/go-service");
const router = (0, express_1.Router)();
const cartService = new go_service_1.CartService();
// GET /cart - Get cart with totals
router.get('/', async (req, res, next) => {
    try {
        const did = req.query.did;
        core_1.logger.info(`[Cart] GET / did=${did}`);
        if (!did) {
            return res.status(400).json({ success: false, error: 'did query parameter required' });
        }
        const result = await cartService.getCartWithTotals(did);
        res.json({ success: true, data: result });
    }
    catch (error) {
        core_1.logger.error('[Cart] Error fetching cart:', error);
        next(error);
    }
});
// POST /cart/items - Add item to cart
router.post('/items', async (req, res, next) => {
    try {
        core_1.logger.info(`[Cart] POST /items`, req.body);
        const { did, postId, quantity, shippingOptionId } = req.body;
        if (!did || !postId) {
            return res.status(400).json({ success: false, error: 'did and postId are required' });
        }
        const result = await cartService.addToCart({
            did,
            postId,
            quantity: quantity || 1,
            shippingOptionId
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        core_1.logger.error('[Cart] Error adding to cart:', error);
        next(error);
    }
});
// PUT /cart/items/:itemId - Update cart item
router.put('/items/:itemId', async (req, res, next) => {
    try {
        core_1.logger.info(`[Cart] PUT /items/${req.params.itemId}`, req.body);
        const { did, quantity, shippingOptionId } = req.body;
        if (!did) {
            return res.status(400).json({ success: false, error: 'did is required' });
        }
        const result = await cartService.updateCartItem({
            did,
            itemId: req.params.itemId,
            quantity: quantity ?? 1,
            shippingOptionId
        });
        res.json({ success: true, data: result });
    }
    catch (error) {
        core_1.logger.error('[Cart] Error updating cart item:', error);
        next(error);
    }
});
// DELETE /cart/items/:itemId - Remove item from cart
router.delete('/items/:itemId', async (req, res, next) => {
    try {
        const did = req.query.did;
        core_1.logger.info(`[Cart] DELETE /items/${req.params.itemId} did=${did}`);
        if (!did) {
            return res.status(400).json({ success: false, error: 'did query parameter required' });
        }
        const result = await cartService.removeFromCart(did, req.params.itemId);
        res.json({ success: true, data: result });
    }
    catch (error) {
        core_1.logger.error('[Cart] Error removing from cart:', error);
        next(error);
    }
});
// DELETE /cart - Clear entire cart
router.delete('/', async (req, res, next) => {
    try {
        const did = req.query.did;
        core_1.logger.info(`[Cart] DELETE / (clear) did=${did}`);
        if (!did) {
            return res.status(400).json({ success: false, error: 'did query parameter required' });
        }
        const result = await cartService.clearCart(did);
        res.json({ success: true, data: result });
    }
    catch (error) {
        core_1.logger.error('[Cart] Error clearing cart:', error);
        next(error);
    }
});
// GET /cart/settings - Get market settings (public - for displaying fees)
router.get('/settings', async (req, res, next) => {
    try {
        core_1.logger.info(`[Cart] GET /settings`);
        const settings = await cartService.getMarketSettings();
        res.json({ success: true, data: settings });
    }
    catch (error) {
        core_1.logger.error('[Cart] Error fetching settings:', error);
        next(error);
    }
});
exports.cartRouter = router;
