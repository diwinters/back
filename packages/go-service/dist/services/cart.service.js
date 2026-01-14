"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CartService = void 0;
const core_1 = require("@gominiapp/core");
class CartService {
    /**
     * Get or create cart for a user
     */
    async getOrCreateCart(did) {
        // Find or create user first
        let user = await core_1.prisma.user.findUnique({ where: { did } });
        if (!user) {
            user = await core_1.prisma.user.create({ data: { did } });
        }
        // Find or create cart
        let cart = await core_1.prisma.cart.findUnique({
            where: { userId: user.id },
            include: {
                items: {
                    include: {
                        post: {
                            include: {
                                seller: {
                                    include: {
                                        user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                                    }
                                },
                                category: true,
                                shippingOptions: { where: { isActive: true } }
                            }
                        },
                        shippingOption: true
                    }
                }
            }
        });
        if (!cart) {
            cart = await core_1.prisma.cart.create({
                data: { userId: user.id },
                include: {
                    items: {
                        include: {
                            post: {
                                include: {
                                    seller: {
                                        include: {
                                            user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                                        }
                                    },
                                    category: true,
                                    shippingOptions: { where: { isActive: true } }
                                }
                            },
                            shippingOption: true
                        }
                    }
                }
            });
        }
        return cart;
    }
    /**
     * Get cart with calculated totals
     */
    async getCartWithTotals(did) {
        const cart = await this.getOrCreateCart(did);
        const settings = await this.getMarketSettings();
        // Calculate totals
        let subtotal = 0;
        let totalShipping = 0;
        const itemsWithTotals = cart.items.map(item => {
            const itemTotal = (item.post.price || 0) * item.quantity;
            subtotal += itemTotal;
            const shippingCost = item.shippingOption?.price || 0;
            totalShipping += shippingCost;
            return {
                ...item,
                itemTotal,
                shippingCost
            };
        });
        // Calculate fees
        const serviceFee = settings.serviceFeeEnabled
            ? Math.min(Math.max(subtotal * settings.serviceFeeRate, settings.serviceFeeMin), settings.serviceFeeMax || Infinity)
            : 0;
        const tvaAmount = settings.tvaEnabled
            ? (subtotal + serviceFee) * settings.tvaRate
            : 0;
        const total = subtotal + totalShipping + serviceFee + tvaAmount;
        return {
            cart: {
                ...cart,
                items: itemsWithTotals
            },
            totals: {
                subtotal,
                shipping: totalShipping,
                serviceFee,
                serviceFeeRate: settings.serviceFeeRate,
                tvaAmount,
                tvaRate: settings.tvaRate,
                total,
                currency: settings.defaultCurrency,
                itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0)
            }
        };
    }
    /**
     * Add item to cart
     */
    async addToCart(data) {
        const cart = await this.getOrCreateCart(data.did);
        // Verify post exists and is active
        const post = await core_1.prisma.marketPost.findUnique({
            where: { id: data.postId },
            include: { shippingOptions: { where: { isActive: true } } }
        });
        if (!post)
            throw new core_1.NotFoundError('Product not found');
        if (post.status !== 'ACTIVE' || post.isArchived) {
            throw new core_1.AppError('Product is not available', core_1.ErrorCode.BAD_REQUEST, 400);
        }
        if (!post.isInStock || post.quantity < data.quantity) {
            throw new core_1.AppError('Insufficient stock', core_1.ErrorCode.BAD_REQUEST, 400);
        }
        // Validate shipping option if provided
        if (data.shippingOptionId) {
            const validOption = post.shippingOptions.find(o => o.id === data.shippingOptionId);
            if (!validOption) {
                throw new core_1.AppError('Invalid shipping option', core_1.ErrorCode.BAD_REQUEST, 400);
            }
        }
        // Check if item already in cart
        const existingItem = cart.items.find(item => item.postId === data.postId);
        if (existingItem) {
            // Update quantity
            const newQuantity = existingItem.quantity + data.quantity;
            if (newQuantity > post.quantity) {
                throw new core_1.AppError('Insufficient stock', core_1.ErrorCode.BAD_REQUEST, 400);
            }
            return core_1.prisma.cartItem.update({
                where: { id: existingItem.id },
                data: {
                    quantity: newQuantity,
                    shippingOptionId: data.shippingOptionId || existingItem.shippingOptionId
                },
                include: {
                    post: {
                        include: {
                            seller: {
                                include: {
                                    user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                                }
                            }
                        }
                    },
                    shippingOption: true
                }
            });
        }
        // Add new item
        return core_1.prisma.cartItem.create({
            data: {
                cartId: cart.id,
                postId: data.postId,
                quantity: data.quantity,
                shippingOptionId: data.shippingOptionId,
                priceAtAdd: post.price || 0
            },
            include: {
                post: {
                    include: {
                        seller: {
                            include: {
                                user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                            }
                        }
                    }
                },
                shippingOption: true
            }
        });
    }
    /**
     * Update cart item quantity
     */
    async updateCartItem(data) {
        const cart = await this.getOrCreateCart(data.did);
        const item = cart.items.find(i => i.id === data.itemId);
        if (!item)
            throw new core_1.NotFoundError('Cart item not found');
        if (data.quantity <= 0) {
            // Remove item
            await core_1.prisma.cartItem.delete({ where: { id: data.itemId } });
            return null;
        }
        // Check stock
        const post = await core_1.prisma.marketPost.findUnique({ where: { id: item.postId } });
        if (!post || data.quantity > post.quantity) {
            throw new core_1.AppError('Insufficient stock', core_1.ErrorCode.BAD_REQUEST, 400);
        }
        return core_1.prisma.cartItem.update({
            where: { id: data.itemId },
            data: {
                quantity: data.quantity,
                shippingOptionId: data.shippingOptionId !== undefined ? data.shippingOptionId : item.shippingOptionId
            },
            include: {
                post: {
                    include: {
                        seller: {
                            include: {
                                user: { select: { did: true, handle: true, displayName: true, avatarUrl: true } }
                            }
                        }
                    }
                },
                shippingOption: true
            }
        });
    }
    /**
     * Remove item from cart
     */
    async removeFromCart(did, itemId) {
        const cart = await this.getOrCreateCart(did);
        const item = cart.items.find(i => i.id === itemId);
        if (!item)
            throw new core_1.NotFoundError('Cart item not found');
        await core_1.prisma.cartItem.delete({ where: { id: itemId } });
        return { success: true };
    }
    /**
     * Clear entire cart
     */
    async clearCart(did) {
        const cart = await this.getOrCreateCart(did);
        await core_1.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
        return { success: true };
    }
    /**
     * Get market settings (singleton)
     */
    async getMarketSettings() {
        let settings = await core_1.prisma.marketSettings.findUnique({ where: { id: 1 } });
        if (!settings) {
            // Create default settings
            settings = await core_1.prisma.marketSettings.create({
                data: {
                    id: 1,
                    tvaRate: 0.20,
                    tvaEnabled: true,
                    serviceFeeRate: 0.05,
                    serviceFeeMin: 5,
                    serviceFeeEnabled: true,
                    defaultCurrency: 'MAD'
                }
            });
        }
        return settings;
    }
    /**
     * Update market settings (admin only)
     */
    async updateMarketSettings(data) {
        // Ensure settings exist
        await this.getMarketSettings();
        return core_1.prisma.marketSettings.update({
            where: { id: 1 },
            data
        });
    }
}
exports.CartService = CartService;
