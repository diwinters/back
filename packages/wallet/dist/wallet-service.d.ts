/**
 * Wallet Service
 * Core business logic for wallet operations
 */
import { WalletTransactionType, WalletTransactionStatus } from '@prisma/client';
export interface WalletBalance {
    available: number;
    pending: number;
    total: number;
    currency: string;
}
export interface DepositRequest {
    userDid: string;
    amount: number;
    type: 'CASH' | 'CARD' | 'BANK';
    cashPointId?: string;
    stripePaymentIntentId?: string;
    metadata?: Record<string, any>;
}
export interface WithdrawRequest {
    userDid: string;
    amount: number;
    type: 'CASH' | 'BANK';
    cashPointId?: string;
    bankAccountId?: string;
    pin?: string;
}
export interface PaymentRequest {
    buyerDid: string;
    sellerDid: string;
    amount: number;
    orderId?: string;
    rideId?: string;
    type: 'MARKET' | 'RIDE';
    useEscrow?: boolean;
}
export interface FeeCalculation {
    originalAmount: number;
    feeAmount: number;
    netAmount: number;
    feeConfig?: any;
}
export declare function getOrCreateWallet(userDid: string): Promise<{
    id: string;
    userDid: string;
    balance: number;
    pendingBalance: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    currency: string;
    isActive: boolean;
    isFrozen: boolean;
    pinHash: string | null;
    lastPinChange: Date | null;
    failedPinAttempts: number;
    createdAt: Date;
    updatedAt: Date;
}>;
export interface WalletInfo {
    id: string;
    userDid: string;
    available: number;
    pending: number;
    held: number;
    total: number;
    currency: string;
    lastPinChange: Date | null;
    hasPinSet: boolean;
    createdAt: Date;
}
export declare function getWalletInfo(userDid: string): Promise<WalletInfo>;
export declare function getWalletBalance(userDid: string): Promise<WalletBalance>;
export declare function getWalletTransactions(userDid: string, options?: {
    limit?: number;
    offset?: number;
    type?: WalletTransactionType;
    status?: WalletTransactionStatus;
}): Promise<{
    transactions: ({
        cashPoint: {
            id: string;
            isActive: boolean;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            type: import(".prisma/client").$Enums.CashPointType;
            nameAr: string | null;
            cityId: string;
            address: string;
            addressAr: string | null;
            latitude: number;
            longitude: number;
            operatingHours: import("@prisma/client/runtime/library").JsonValue | null;
            phone: string | null;
            dailyDepositLimit: number | null;
            dailyWithdrawalLimit: number | null;
            agentId: string | null;
            isVerified: boolean;
            rating: number;
            ratingCount: number;
            totalDeposits: number;
            totalWithdrawals: number;
        } | null;
    } & {
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.WalletTransactionType;
        status: import(".prisma/client").$Enums.WalletTransactionStatus;
        walletId: string;
        amount: number;
        fee: number;
        netAmount: number;
        referenceId: string | null;
        referenceType: string | null;
        cashPointId: string | null;
        description: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        processedAt: Date | null;
        failureReason: string | null;
    })[];
    total: number;
    limit: number;
    offset: number;
}>;
export declare function setWalletPin(userDid: string, pin: string): Promise<boolean>;
export declare function changeWalletPin(userDid: string, currentPin: string, newPin: string): Promise<boolean>;
export declare function verifyWalletPin(userDid: string, pin: string): Promise<boolean>;
export declare function hasPinSet(userDid: string): Promise<boolean>;
export declare function calculateFee(amount: number, feeCode: string, cityId?: string): Promise<FeeCalculation>;
export declare function initiateDeposit(request: DepositRequest): Promise<{
    transaction: {
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.WalletTransactionType;
        status: import(".prisma/client").$Enums.WalletTransactionStatus;
        walletId: string;
        amount: number;
        fee: number;
        netAmount: number;
        referenceId: string | null;
        referenceType: string | null;
        cashPointId: string | null;
        description: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        processedAt: Date | null;
        failureReason: string | null;
    };
    fee: FeeCalculation;
}>;
export declare function completeDeposit(transactionId: string): Promise<{
    id: string;
    createdAt: Date;
    type: import(".prisma/client").$Enums.WalletTransactionType;
    status: import(".prisma/client").$Enums.WalletTransactionStatus;
    walletId: string;
    amount: number;
    fee: number;
    netAmount: number;
    referenceId: string | null;
    referenceType: string | null;
    cashPointId: string | null;
    description: string | null;
    metadata: import("@prisma/client/runtime/library").JsonValue | null;
    processedAt: Date | null;
    failureReason: string | null;
}>;
export declare function initiateWithdrawal(request: WithdrawRequest): Promise<{
    transaction: {
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.WalletTransactionType;
        status: import(".prisma/client").$Enums.WalletTransactionStatus;
        walletId: string;
        amount: number;
        fee: number;
        netAmount: number;
        referenceId: string | null;
        referenceType: string | null;
        cashPointId: string | null;
        description: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        processedAt: Date | null;
        failureReason: string | null;
    };
    fee: FeeCalculation;
}>;
export declare function completeWithdrawal(transactionId: string): Promise<{
    id: string;
    createdAt: Date;
    type: import(".prisma/client").$Enums.WalletTransactionType;
    status: import(".prisma/client").$Enums.WalletTransactionStatus;
    walletId: string;
    amount: number;
    fee: number;
    netAmount: number;
    referenceId: string | null;
    referenceType: string | null;
    cashPointId: string | null;
    description: string | null;
    metadata: import("@prisma/client/runtime/library").JsonValue | null;
    processedAt: Date | null;
    failureReason: string | null;
}>;
export declare function cancelWithdrawal(transactionId: string, reason?: string): Promise<void>;
export declare function processPayment(request: PaymentRequest): Promise<{
    buyerTransaction: {
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.WalletTransactionType;
        status: import(".prisma/client").$Enums.WalletTransactionStatus;
        walletId: string;
        amount: number;
        fee: number;
        netAmount: number;
        referenceId: string | null;
        referenceType: string | null;
        cashPointId: string | null;
        description: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        processedAt: Date | null;
        failureReason: string | null;
    };
    escrow: {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        status: import(".prisma/client").$Enums.EscrowStatus;
        amount: number;
        feeAmount: number;
        orderId: string | null;
        rideId: string | null;
        buyerWalletId: string;
        sellerWalletId: string;
        sellerAmount: number;
        releaseAt: Date | null;
        releasedAt: Date | null;
        disputeReason: string | null;
        disputedAt: Date | null;
        resolvedAt: Date | null;
        resolution: string | null;
    };
    fee: FeeCalculation;
    sellerTransaction?: undefined;
} | {
    buyerTransaction: {
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.WalletTransactionType;
        status: import(".prisma/client").$Enums.WalletTransactionStatus;
        walletId: string;
        amount: number;
        fee: number;
        netAmount: number;
        referenceId: string | null;
        referenceType: string | null;
        cashPointId: string | null;
        description: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        processedAt: Date | null;
        failureReason: string | null;
    };
    sellerTransaction: {
        id: string;
        createdAt: Date;
        type: import(".prisma/client").$Enums.WalletTransactionType;
        status: import(".prisma/client").$Enums.WalletTransactionStatus;
        walletId: string;
        amount: number;
        fee: number;
        netAmount: number;
        referenceId: string | null;
        referenceType: string | null;
        cashPointId: string | null;
        description: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        processedAt: Date | null;
        failureReason: string | null;
    };
    fee: FeeCalculation;
    escrow?: undefined;
}>;
export declare function releaseEscrow(escrowId: string): Promise<{
    success: boolean;
    escrowId: string;
}>;
export declare function refundEscrow(escrowId: string, reason?: string): Promise<{
    success: boolean;
    escrowId: string;
}>;
export declare function getNearbyCashPoints(latitude: number, longitude: number, radiusKm?: number, type?: string): Promise<{
    distance: number;
    city: {
        id: string;
        currency: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        code: string;
        country: string;
        timezone: string | null;
        centerLatitude: number;
        centerLongitude: number;
        radiusKm: number;
        boundaryPolygon: import("@prisma/client/runtime/library").JsonValue | null;
        usePolygonBoundary: boolean;
        enabledServices: string[];
        allowCrossCityOrders: boolean;
        linkedCityIds: string[];
        imageUrl: string | null;
    };
    agent: {
        name: string;
        phone: string;
    } | null;
    id: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    name: string;
    type: import(".prisma/client").$Enums.CashPointType;
    nameAr: string | null;
    cityId: string;
    address: string;
    addressAr: string | null;
    latitude: number;
    longitude: number;
    operatingHours: import("@prisma/client/runtime/library").JsonValue | null;
    phone: string | null;
    dailyDepositLimit: number | null;
    dailyWithdrawalLimit: number | null;
    agentId: string | null;
    isVerified: boolean;
    rating: number;
    ratingCount: number;
    totalDeposits: number;
    totalWithdrawals: number;
}[]>;
declare const _default: {
    getOrCreateWallet: typeof getOrCreateWallet;
    getWalletBalance: typeof getWalletBalance;
    getWalletTransactions: typeof getWalletTransactions;
    calculateFee: typeof calculateFee;
    initiateDeposit: typeof initiateDeposit;
    completeDeposit: typeof completeDeposit;
    initiateWithdrawal: typeof initiateWithdrawal;
    completeWithdrawal: typeof completeWithdrawal;
    cancelWithdrawal: typeof cancelWithdrawal;
    processPayment: typeof processPayment;
    releaseEscrow: typeof releaseEscrow;
    refundEscrow: typeof refundEscrow;
    getNearbyCashPoints: typeof getNearbyCashPoints;
    setWalletPin: typeof setWalletPin;
    changeWalletPin: typeof changeWalletPin;
    verifyWalletPin: typeof verifyWalletPin;
    hasPinSet: typeof hasPinSet;
    getWalletInfo: typeof getWalletInfo;
};
export default _default;
//# sourceMappingURL=wallet-service.d.ts.map