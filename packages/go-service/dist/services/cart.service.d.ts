export declare class CartService {
    /**
     * Get or create cart for a user
     */
    getOrCreateCart(did: string): Promise<{
        items: ({
            post: {
                category: {
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    name: string;
                    isActive: boolean;
                    description: string | null;
                    nameAr: string | null;
                    listingType: import(".prisma/client").$Enums.ListingType;
                    emoji: string | null;
                    iconUrl: string | null;
                    gradientStart: string | null;
                    gradientEnd: string | null;
                    sortOrder: number;
                    isGlobal: boolean;
                    isPinnedToHome: boolean;
                    homePinOrder: number;
                };
                seller: {
                    user: {
                        did: string;
                        handle: string;
                        displayName: string;
                        avatarUrl: string;
                    };
                } & {
                    status: import(".prisma/client").$Enums.MarketSellerStatus;
                    id: string;
                    userId: string;
                    cityId: string | null;
                    verifiedAt: Date | null;
                    createdAt: Date;
                    updatedAt: Date;
                    isPrime: boolean;
                    rejectionReason: string | null;
                    storeName: string;
                    storeDescription: string | null;
                    contactPhone: string | null;
                    contactEmail: string | null;
                    primeStatus: import(".prisma/client").$Enums.PrimeStatus;
                    primeRequestedAt: Date | null;
                    primeApprovedAt: Date | null;
                    primeRejectionReason: string | null;
                    stripeConnectId: string | null;
                    stripeOnboarded: boolean;
                };
                shippingOptions: {
                    type: import(".prisma/client").$Enums.ShippingType;
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    name: string;
                    isActive: boolean;
                    description: string | null;
                    price: number;
                    postId: string;
                    freeAbove: number | null;
                    minDays: number | null;
                    maxDays: number | null;
                }[];
            } & {
                status: import(".prisma/client").$Enums.MarketPostStatus;
                id: string;
                cityId: string | null;
                createdAt: Date;
                updatedAt: Date;
                currency: string;
                description: string | null;
                listingType: import(".prisma/client").$Enums.ListingType;
                categoryId: string;
                title: string;
                sellerId: string;
                postUri: string;
                postCid: string;
                subcategoryId: string | null;
                price: number | null;
                quantity: number;
                soldCount: number;
                isInStock: boolean;
                duration: number | null;
                durationUnit: import(".prisma/client").$Enums.DurationUnit | null;
                pricingType: import(".prisma/client").$Enums.PricingType | null;
                minGuests: number | null;
                maxGuests: number | null;
                bookingLeadTime: number | null;
                serviceLocation: string | null;
                serviceLatitude: number | null;
                serviceLongitude: number | null;
                includedItems: string | null;
                isPrime: boolean;
                reviewedAt: Date | null;
                rejectionReason: string | null;
                isArchived: boolean;
                replacedById: string | null;
            };
            shippingOption: {
                type: import(".prisma/client").$Enums.ShippingType;
                id: string;
                createdAt: Date;
                updatedAt: Date;
                name: string;
                isActive: boolean;
                description: string | null;
                price: number;
                postId: string;
                freeAbove: number | null;
                minDays: number | null;
                maxDays: number | null;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            quantity: number;
            postId: string;
            cartId: string;
            shippingOptionId: string | null;
            priceAtAdd: number;
        })[];
    } & {
        id: string;
        userId: string;
        createdAt: Date;
        updatedAt: Date;
    }>;
    /**
     * Get cart with calculated totals
     */
    getCartWithTotals(did: string): Promise<{
        cart: {
            items: {
                itemTotal: number;
                shippingCost: number;
                post: {
                    category: {
                        id: string;
                        createdAt: Date;
                        updatedAt: Date;
                        name: string;
                        isActive: boolean;
                        description: string | null;
                        nameAr: string | null;
                        listingType: import(".prisma/client").$Enums.ListingType;
                        emoji: string | null;
                        iconUrl: string | null;
                        gradientStart: string | null;
                        gradientEnd: string | null;
                        sortOrder: number;
                        isGlobal: boolean;
                        isPinnedToHome: boolean;
                        homePinOrder: number;
                    };
                    seller: {
                        user: {
                            did: string;
                            handle: string;
                            displayName: string;
                            avatarUrl: string;
                        };
                    } & {
                        status: import(".prisma/client").$Enums.MarketSellerStatus;
                        id: string;
                        userId: string;
                        cityId: string | null;
                        verifiedAt: Date | null;
                        createdAt: Date;
                        updatedAt: Date;
                        isPrime: boolean;
                        rejectionReason: string | null;
                        storeName: string;
                        storeDescription: string | null;
                        contactPhone: string | null;
                        contactEmail: string | null;
                        primeStatus: import(".prisma/client").$Enums.PrimeStatus;
                        primeRequestedAt: Date | null;
                        primeApprovedAt: Date | null;
                        primeRejectionReason: string | null;
                        stripeConnectId: string | null;
                        stripeOnboarded: boolean;
                    };
                    shippingOptions: {
                        type: import(".prisma/client").$Enums.ShippingType;
                        id: string;
                        createdAt: Date;
                        updatedAt: Date;
                        name: string;
                        isActive: boolean;
                        description: string | null;
                        price: number;
                        postId: string;
                        freeAbove: number | null;
                        minDays: number | null;
                        maxDays: number | null;
                    }[];
                } & {
                    status: import(".prisma/client").$Enums.MarketPostStatus;
                    id: string;
                    cityId: string | null;
                    createdAt: Date;
                    updatedAt: Date;
                    currency: string;
                    description: string | null;
                    listingType: import(".prisma/client").$Enums.ListingType;
                    categoryId: string;
                    title: string;
                    sellerId: string;
                    postUri: string;
                    postCid: string;
                    subcategoryId: string | null;
                    price: number | null;
                    quantity: number;
                    soldCount: number;
                    isInStock: boolean;
                    duration: number | null;
                    durationUnit: import(".prisma/client").$Enums.DurationUnit | null;
                    pricingType: import(".prisma/client").$Enums.PricingType | null;
                    minGuests: number | null;
                    maxGuests: number | null;
                    bookingLeadTime: number | null;
                    serviceLocation: string | null;
                    serviceLatitude: number | null;
                    serviceLongitude: number | null;
                    includedItems: string | null;
                    isPrime: boolean;
                    reviewedAt: Date | null;
                    rejectionReason: string | null;
                    isArchived: boolean;
                    replacedById: string | null;
                };
                shippingOption: {
                    type: import(".prisma/client").$Enums.ShippingType;
                    id: string;
                    createdAt: Date;
                    updatedAt: Date;
                    name: string;
                    isActive: boolean;
                    description: string | null;
                    price: number;
                    postId: string;
                    freeAbove: number | null;
                    minDays: number | null;
                    maxDays: number | null;
                };
                id: string;
                createdAt: Date;
                updatedAt: Date;
                quantity: number;
                postId: string;
                cartId: string;
                shippingOptionId: string | null;
                priceAtAdd: number;
            }[];
            id: string;
            userId: string;
            createdAt: Date;
            updatedAt: Date;
        };
        totals: {
            subtotal: number;
            shipping: number;
            serviceFee: number;
            serviceFeeRate: number;
            tvaAmount: number;
            tvaRate: number;
            total: number;
            currency: string;
            itemCount: number;
        };
    }>;
    /**
     * Add item to cart
     */
    addToCart(data: {
        did: string;
        postId: string;
        quantity: number;
        shippingOptionId?: string;
    }): Promise<{
        post: {
            seller: {
                user: {
                    did: string;
                    handle: string;
                    displayName: string;
                    avatarUrl: string;
                };
            } & {
                status: import(".prisma/client").$Enums.MarketSellerStatus;
                id: string;
                userId: string;
                cityId: string | null;
                verifiedAt: Date | null;
                createdAt: Date;
                updatedAt: Date;
                isPrime: boolean;
                rejectionReason: string | null;
                storeName: string;
                storeDescription: string | null;
                contactPhone: string | null;
                contactEmail: string | null;
                primeStatus: import(".prisma/client").$Enums.PrimeStatus;
                primeRequestedAt: Date | null;
                primeApprovedAt: Date | null;
                primeRejectionReason: string | null;
                stripeConnectId: string | null;
                stripeOnboarded: boolean;
            };
        } & {
            status: import(".prisma/client").$Enums.MarketPostStatus;
            id: string;
            cityId: string | null;
            createdAt: Date;
            updatedAt: Date;
            currency: string;
            description: string | null;
            listingType: import(".prisma/client").$Enums.ListingType;
            categoryId: string;
            title: string;
            sellerId: string;
            postUri: string;
            postCid: string;
            subcategoryId: string | null;
            price: number | null;
            quantity: number;
            soldCount: number;
            isInStock: boolean;
            duration: number | null;
            durationUnit: import(".prisma/client").$Enums.DurationUnit | null;
            pricingType: import(".prisma/client").$Enums.PricingType | null;
            minGuests: number | null;
            maxGuests: number | null;
            bookingLeadTime: number | null;
            serviceLocation: string | null;
            serviceLatitude: number | null;
            serviceLongitude: number | null;
            includedItems: string | null;
            isPrime: boolean;
            reviewedAt: Date | null;
            rejectionReason: string | null;
            isArchived: boolean;
            replacedById: string | null;
        };
        shippingOption: {
            type: import(".prisma/client").$Enums.ShippingType;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            isActive: boolean;
            description: string | null;
            price: number;
            postId: string;
            freeAbove: number | null;
            minDays: number | null;
            maxDays: number | null;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        quantity: number;
        postId: string;
        cartId: string;
        shippingOptionId: string | null;
        priceAtAdd: number;
    }>;
    /**
     * Update cart item quantity
     */
    updateCartItem(data: {
        did: string;
        itemId: string;
        quantity: number;
        shippingOptionId?: string;
    }): Promise<{
        post: {
            seller: {
                user: {
                    did: string;
                    handle: string;
                    displayName: string;
                    avatarUrl: string;
                };
            } & {
                status: import(".prisma/client").$Enums.MarketSellerStatus;
                id: string;
                userId: string;
                cityId: string | null;
                verifiedAt: Date | null;
                createdAt: Date;
                updatedAt: Date;
                isPrime: boolean;
                rejectionReason: string | null;
                storeName: string;
                storeDescription: string | null;
                contactPhone: string | null;
                contactEmail: string | null;
                primeStatus: import(".prisma/client").$Enums.PrimeStatus;
                primeRequestedAt: Date | null;
                primeApprovedAt: Date | null;
                primeRejectionReason: string | null;
                stripeConnectId: string | null;
                stripeOnboarded: boolean;
            };
        } & {
            status: import(".prisma/client").$Enums.MarketPostStatus;
            id: string;
            cityId: string | null;
            createdAt: Date;
            updatedAt: Date;
            currency: string;
            description: string | null;
            listingType: import(".prisma/client").$Enums.ListingType;
            categoryId: string;
            title: string;
            sellerId: string;
            postUri: string;
            postCid: string;
            subcategoryId: string | null;
            price: number | null;
            quantity: number;
            soldCount: number;
            isInStock: boolean;
            duration: number | null;
            durationUnit: import(".prisma/client").$Enums.DurationUnit | null;
            pricingType: import(".prisma/client").$Enums.PricingType | null;
            minGuests: number | null;
            maxGuests: number | null;
            bookingLeadTime: number | null;
            serviceLocation: string | null;
            serviceLatitude: number | null;
            serviceLongitude: number | null;
            includedItems: string | null;
            isPrime: boolean;
            reviewedAt: Date | null;
            rejectionReason: string | null;
            isArchived: boolean;
            replacedById: string | null;
        };
        shippingOption: {
            type: import(".prisma/client").$Enums.ShippingType;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            isActive: boolean;
            description: string | null;
            price: number;
            postId: string;
            freeAbove: number | null;
            minDays: number | null;
            maxDays: number | null;
        };
    } & {
        id: string;
        createdAt: Date;
        updatedAt: Date;
        quantity: number;
        postId: string;
        cartId: string;
        shippingOptionId: string | null;
        priceAtAdd: number;
    }>;
    /**
     * Remove item from cart
     */
    removeFromCart(did: string, itemId: string): Promise<{
        success: boolean;
    }>;
    /**
     * Clear entire cart
     */
    clearCart(did: string): Promise<{
        success: boolean;
    }>;
    /**
     * Get market settings (singleton)
     */
    getMarketSettings(): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        tvaRate: number;
        tvaEnabled: boolean;
        serviceFeeRate: number;
        serviceFeeMin: number;
        serviceFeeMax: number | null;
        serviceFeeEnabled: boolean;
        primeCommissionRate: number;
        primeMonthlyFee: number;
        primeMinimumPayout: number;
        primeFreeShipping: boolean;
        primeAutoApprove: boolean;
        defaultCurrency: string;
    }>;
    /**
     * Update market settings (admin only)
     */
    updateMarketSettings(data: {
        tvaRate?: number;
        tvaEnabled?: boolean;
        serviceFeeRate?: number;
        serviceFeeMin?: number;
        serviceFeeMax?: number | null;
        serviceFeeEnabled?: boolean;
        defaultCurrency?: string;
    }): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        tvaRate: number;
        tvaEnabled: boolean;
        serviceFeeRate: number;
        serviceFeeMin: number;
        serviceFeeMax: number | null;
        serviceFeeEnabled: boolean;
        primeCommissionRate: number;
        primeMonthlyFee: number;
        primeMinimumPayout: number;
        primeFreeShipping: boolean;
        primeAutoApprove: boolean;
        defaultCurrency: string;
    }>;
}
