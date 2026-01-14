"use strict";
/**
 * Wallet Service
 * Core business logic for wallet operations
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrCreateWallet = getOrCreateWallet;
exports.getWalletInfo = getWalletInfo;
exports.getWalletBalance = getWalletBalance;
exports.getWalletTransactions = getWalletTransactions;
exports.setWalletPin = setWalletPin;
exports.changeWalletPin = changeWalletPin;
exports.verifyWalletPin = verifyWalletPin;
exports.hasPinSet = hasPinSet;
exports.calculateFee = calculateFee;
exports.initiateDeposit = initiateDeposit;
exports.completeDeposit = completeDeposit;
exports.initiateWithdrawal = initiateWithdrawal;
exports.completeWithdrawal = completeWithdrawal;
exports.cancelWithdrawal = cancelWithdrawal;
exports.processPayment = processPayment;
exports.releaseEscrow = releaseEscrow;
exports.refundEscrow = refundEscrow;
exports.getNearbyCashPoints = getNearbyCashPoints;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// =============================================================================
// Wallet CRUD
// =============================================================================
async function getOrCreateWallet(userDid) {
    let wallet = await prisma.wallet.findUnique({
        where: { userDid }
    });
    if (!wallet) {
        wallet = await prisma.wallet.create({
            data: {
                userDid,
                balance: 0,
                pendingBalance: 0,
                currency: 'MAD'
            }
        });
    }
    return wallet;
}
async function getWalletInfo(userDid) {
    const wallet = await getOrCreateWallet(userDid);
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
    };
}
async function getWalletBalance(userDid) {
    const wallet = await getOrCreateWallet(userDid);
    return {
        available: wallet.balance,
        pending: wallet.pendingBalance,
        total: wallet.balance + wallet.pendingBalance,
        currency: wallet.currency
    };
}
async function getWalletTransactions(userDid, options = {}) {
    const wallet = await getOrCreateWallet(userDid);
    const { limit = 50, offset = 0, type, status } = options;
    const where = { walletId: wallet.id };
    if (type)
        where.type = type;
    if (status)
        where.status = status;
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
    ]);
    return { transactions, total, limit, offset };
}
// =============================================================================
// PIN Management
// =============================================================================
const crypto_1 = __importDefault(require("crypto"));
function hashPin(pin) {
    return crypto_1.default.createHash('sha256').update(pin + process.env.PIN_SALT || 'wallet-pin-salt').digest('hex');
}
async function setWalletPin(userDid, pin) {
    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        throw new Error('PIN must be exactly 4 digits');
    }
    const wallet = await getOrCreateWallet(userDid);
    if (wallet.pinHash) {
        throw new Error('PIN already set. Use changePin to update.');
    }
    await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
            pinHash: hashPin(pin),
            lastPinChange: new Date()
        }
    });
    return true;
}
async function changeWalletPin(userDid, currentPin, newPin) {
    if (!newPin || newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
        throw new Error('New PIN must be exactly 4 digits');
    }
    const wallet = await getOrCreateWallet(userDid);
    if (!wallet.pinHash) {
        throw new Error('No PIN set. Use setPin first.');
    }
    if (hashPin(currentPin) !== wallet.pinHash) {
        throw new Error('Current PIN is incorrect');
    }
    await prisma.wallet.update({
        where: { id: wallet.id },
        data: {
            pinHash: hashPin(newPin),
            lastPinChange: new Date()
        }
    });
    return true;
}
async function verifyWalletPin(userDid, pin) {
    const wallet = await getOrCreateWallet(userDid);
    if (!wallet.pinHash) {
        throw new Error('No PIN set');
    }
    return hashPin(pin) === wallet.pinHash;
}
async function hasPinSet(userDid) {
    const wallet = await getOrCreateWallet(userDid);
    return !!wallet.pinHash;
}
// =============================================================================
// Fee Calculation
// =============================================================================
async function calculateFee(amount, feeCode, cityId) {
    // First try city-specific fee, then global
    let feeConfig = await prisma.walletFeeConfig.findFirst({
        where: {
            code: feeCode,
            cityId: cityId || null,
            isActive: true
        }
    });
    // Fallback to global config
    if (!feeConfig && cityId) {
        feeConfig = await prisma.walletFeeConfig.findFirst({
            where: {
                code: feeCode,
                cityId: null,
                isActive: true
            }
        });
    }
    if (!feeConfig) {
        // No fee configured
        return {
            originalAmount: amount,
            feeAmount: 0,
            netAmount: amount
        };
    }
    let feeAmount = 0;
    switch (feeConfig.type) {
        case 'PERCENTAGE':
            feeAmount = amount * (feeConfig.value / 100);
            if (feeConfig.minAmount && feeAmount < feeConfig.minAmount) {
                feeAmount = feeConfig.minAmount;
            }
            if (feeConfig.maxAmount && feeAmount > feeConfig.maxAmount) {
                feeAmount = feeConfig.maxAmount;
            }
            break;
        case 'FIXED':
            feeAmount = feeConfig.value;
            break;
        case 'TIERED':
            const tiers = feeConfig.tiers;
            if (tiers) {
                for (const tier of tiers) {
                    if (amount <= tier.upTo) {
                        feeAmount = tier.fee;
                        break;
                    }
                }
                // If amount exceeds all tiers, use the last tier
                if (feeAmount === 0 && tiers.length > 0) {
                    feeAmount = tiers[tiers.length - 1].fee;
                }
            }
            break;
    }
    return {
        originalAmount: amount,
        feeAmount: Math.round(feeAmount * 100) / 100, // Round to 2 decimals
        netAmount: Math.round((amount - feeAmount) * 100) / 100,
        feeConfig
    };
}
// =============================================================================
// Deposit Operations
// =============================================================================
async function initiateDeposit(request) {
    const { userDid, amount, type, cashPointId, stripePaymentIntentId, metadata } = request;
    const wallet = await getOrCreateWallet(userDid);
    // Calculate deposit fee
    const feeCode = type === 'CASH' ? 'deposit_fee_cash' :
        type === 'CARD' ? 'deposit_fee_card' : 'deposit_fee_bank';
    const fee = await calculateFee(amount, feeCode);
    const transactionType = type === 'CASH' ? client_1.WalletTransactionType.DEPOSIT_CASH :
        type === 'CARD' ? client_1.WalletTransactionType.DEPOSIT_CARD :
            client_1.WalletTransactionType.DEPOSIT_BANK;
    // For card deposits, status starts as pending (Stripe webhook will confirm)
    // For cash deposits, agent needs to confirm
    const initialStatus = type === 'CARD' ?
        client_1.WalletTransactionStatus.PROCESSING :
        client_1.WalletTransactionStatus.PENDING;
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
    });
    return {
        transaction,
        fee
    };
}
async function completeDeposit(transactionId) {
    const transaction = await prisma.walletTransaction.findUnique({
        where: { id: transactionId },
        include: { wallet: true }
    });
    if (!transaction) {
        throw new Error('Transaction not found');
    }
    if (transaction.status !== client_1.WalletTransactionStatus.PENDING &&
        transaction.status !== client_1.WalletTransactionStatus.PROCESSING) {
        throw new Error('Transaction cannot be completed');
    }
    // Update wallet balance and transaction status
    const [updatedTransaction] = await prisma.$transaction([
        prisma.walletTransaction.update({
            where: { id: transactionId },
            data: {
                status: client_1.WalletTransactionStatus.COMPLETED,
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
    ]);
    return updatedTransaction;
}
// =============================================================================
// Withdrawal Operations
// =============================================================================
async function initiateWithdrawal(request) {
    const { userDid, amount, type, cashPointId, bankAccountId } = request;
    const wallet = await getOrCreateWallet(userDid);
    // Check sufficient balance
    if (wallet.balance < amount) {
        throw new Error('Insufficient balance');
    }
    // Get withdrawal limits from config
    const minWithdrawal = await getConfigValue('min_withdrawal', 20);
    const maxWithdrawalDaily = await getConfigValue('max_withdrawal_daily', 5000);
    if (amount < minWithdrawal) {
        throw new Error(`Minimum withdrawal is ${minWithdrawal} MAD`);
    }
    // Check daily limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dailyWithdrawals = await prisma.walletTransaction.aggregate({
        where: {
            walletId: wallet.id,
            type: { in: [client_1.WalletTransactionType.WITHDRAWAL_CASH, client_1.WalletTransactionType.WITHDRAWAL_BANK] },
            status: { in: [client_1.WalletTransactionStatus.COMPLETED, client_1.WalletTransactionStatus.PENDING, client_1.WalletTransactionStatus.PROCESSING] },
            createdAt: { gte: today }
        },
        _sum: { amount: true }
    });
    const dailyTotal = (dailyWithdrawals._sum.amount || 0) + amount;
    if (dailyTotal > maxWithdrawalDaily) {
        throw new Error(`Daily withdrawal limit is ${maxWithdrawalDaily} MAD`);
    }
    // Calculate withdrawal fee
    const feeCode = type === 'CASH' ? 'withdrawal_fee_cash' : 'withdrawal_fee_bank';
    const fee = await calculateFee(amount, feeCode);
    const transactionType = type === 'CASH' ?
        client_1.WalletTransactionType.WITHDRAWAL_CASH :
        client_1.WalletTransactionType.WITHDRAWAL_BANK;
    // Create transaction and deduct from balance
    const [transaction] = await prisma.$transaction([
        prisma.walletTransaction.create({
            data: {
                walletId: wallet.id,
                type: transactionType,
                amount: -amount, // Negative for withdrawal
                fee: fee.feeAmount,
                netAmount: -(amount + fee.feeAmount), // Total deducted
                status: client_1.WalletTransactionStatus.PENDING,
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
    ]);
    return { transaction, fee };
}
async function completeWithdrawal(transactionId) {
    const transaction = await prisma.walletTransaction.findUnique({
        where: { id: transactionId }
    });
    if (!transaction) {
        throw new Error('Transaction not found');
    }
    if (transaction.status !== client_1.WalletTransactionStatus.PENDING) {
        throw new Error('Transaction cannot be completed');
    }
    return prisma.walletTransaction.update({
        where: { id: transactionId },
        data: {
            status: client_1.WalletTransactionStatus.COMPLETED,
            processedAt: new Date()
        }
    });
}
async function cancelWithdrawal(transactionId, reason) {
    const transaction = await prisma.walletTransaction.findUnique({
        where: { id: transactionId },
        include: { wallet: true }
    });
    if (!transaction) {
        throw new Error('Transaction not found');
    }
    if (transaction.status !== client_1.WalletTransactionStatus.PENDING) {
        throw new Error('Transaction cannot be cancelled');
    }
    // Refund the balance
    await prisma.$transaction([
        prisma.walletTransaction.update({
            where: { id: transactionId },
            data: {
                status: client_1.WalletTransactionStatus.CANCELLED,
                failureReason: reason
            }
        }),
        prisma.wallet.update({
            where: { id: transaction.walletId },
            data: {
                balance: { increment: Math.abs(transaction.netAmount) }
            }
        })
    ]);
}
// =============================================================================
// Payment Operations (Market & Rides)
// =============================================================================
async function processPayment(request) {
    const { buyerDid, sellerDid, amount, orderId, rideId, type, useEscrow = true } = request;
    const buyerWallet = await getOrCreateWallet(buyerDid);
    const sellerWallet = await getOrCreateWallet(sellerDid);
    // Check buyer balance
    if (buyerWallet.balance < amount) {
        throw new Error('Insufficient balance');
    }
    // Calculate platform fee
    const feeCode = type === 'MARKET' ? 'platform_fee_market' : 'platform_fee_ride';
    const fee = await calculateFee(amount, feeCode);
    const transactionType = type === 'MARKET' ?
        client_1.WalletTransactionType.PAYMENT_MARKET :
        client_1.WalletTransactionType.PAYMENT_RIDE;
    if (useEscrow) {
        // Create escrow hold
        const escrowReleaseDays = await getConfigValue('escrow_release_days', 7);
        const releaseAt = new Date();
        releaseAt.setDate(releaseAt.getDate() + escrowReleaseDays);
        const [buyerTx, escrow] = await prisma.$transaction([
            // Deduct from buyer
            prisma.walletTransaction.create({
                data: {
                    walletId: buyerWallet.id,
                    type: transactionType,
                    amount: -amount,
                    fee: 0,
                    netAmount: -amount,
                    status: client_1.WalletTransactionStatus.COMPLETED,
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
                    status: client_1.EscrowStatus.HELD,
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
        ]);
        return { buyerTransaction: buyerTx, escrow, fee };
    }
    else {
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
                    status: client_1.WalletTransactionStatus.COMPLETED,
                    referenceId: orderId || rideId,
                    referenceType: type,
                    description: `Payment for ${type.toLowerCase()}`
                }
            }),
            // Credit to seller (minus fee)
            prisma.walletTransaction.create({
                data: {
                    walletId: sellerWallet.id,
                    type: client_1.WalletTransactionType.ESCROW_RELEASE,
                    amount: amount,
                    fee: fee.feeAmount,
                    netAmount: fee.netAmount,
                    status: client_1.WalletTransactionStatus.COMPLETED,
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
        ]);
        return { buyerTransaction: buyerTx, sellerTransaction: sellerTx, fee };
    }
}
// =============================================================================
// Escrow Operations
// =============================================================================
async function releaseEscrow(escrowId) {
    const escrow = await prisma.escrowHold.findUnique({
        where: { id: escrowId },
        include: {
            sellerWallet: true
        }
    });
    if (!escrow) {
        throw new Error('Escrow not found');
    }
    if (escrow.status !== client_1.EscrowStatus.HELD) {
        throw new Error('Escrow already processed');
    }
    await prisma.$transaction([
        // Update escrow status
        prisma.escrowHold.update({
            where: { id: escrowId },
            data: {
                status: client_1.EscrowStatus.RELEASED,
                releasedAt: new Date()
            }
        }),
        // Create seller transaction
        prisma.walletTransaction.create({
            data: {
                walletId: escrow.sellerWalletId,
                type: client_1.WalletTransactionType.ESCROW_RELEASE,
                amount: escrow.amount,
                fee: escrow.feeAmount,
                netAmount: escrow.sellerAmount,
                status: client_1.WalletTransactionStatus.COMPLETED,
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
    ]);
    return { success: true, escrowId };
}
async function refundEscrow(escrowId, reason) {
    const escrow = await prisma.escrowHold.findUnique({
        where: { id: escrowId },
        include: {
            buyerWallet: true,
            sellerWallet: true
        }
    });
    if (!escrow) {
        throw new Error('Escrow not found');
    }
    if (escrow.status !== client_1.EscrowStatus.HELD && escrow.status !== client_1.EscrowStatus.DISPUTED) {
        throw new Error('Escrow cannot be refunded');
    }
    await prisma.$transaction([
        // Update escrow status
        prisma.escrowHold.update({
            where: { id: escrowId },
            data: {
                status: client_1.EscrowStatus.REFUNDED,
                releasedAt: new Date(),
                resolution: 'REFUND_BUYER'
            }
        }),
        // Create refund transaction for buyer
        prisma.walletTransaction.create({
            data: {
                walletId: escrow.buyerWalletId,
                type: client_1.WalletTransactionType.REFUND,
                amount: escrow.amount,
                fee: 0,
                netAmount: escrow.amount,
                status: client_1.WalletTransactionStatus.COMPLETED,
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
    ]);
    return { success: true, escrowId };
}
// =============================================================================
// Configuration Helpers
// =============================================================================
async function getConfigValue(key, defaultValue, cityId) {
    const config = await prisma.walletConfig.findFirst({
        where: {
            key,
            cityId: cityId || null,
            isActive: true
        }
    });
    if (config) {
        try {
            return JSON.parse(config.value);
        }
        catch {
            return defaultValue;
        }
    }
    // Try global config if city-specific not found
    if (cityId) {
        return getConfigValue(key, defaultValue);
    }
    return defaultValue;
}
// =============================================================================
// Cash Points
// =============================================================================
async function getNearbyCashPoints(latitude, longitude, radiusKm = 10, type) {
    // Simple distance calculation (for production, use PostGIS or similar)
    const cashPoints = await prisma.cashPoint.findMany({
        where: {
            isActive: true,
            ...(type ? { type: type } : {})
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
    });
    // Calculate distance and filter
    const nearby = cashPoints
        .map(cp => {
        const distance = haversineDistance(latitude, longitude, cp.latitude, cp.longitude);
        return { ...cp, distance };
    })
        .filter(cp => cp.distance <= radiusKm)
        .sort((a, b) => a.distance - b.distance);
    return nearby;
}
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function toRad(deg) {
    return deg * (Math.PI / 180);
}
exports.default = {
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
};
//# sourceMappingURL=wallet-service.js.map