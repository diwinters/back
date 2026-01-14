export declare class MarketService {
    /**
     * Get all active categories with subcategories
     * If cityId is provided, returns categories that are:
     * 1. Global (isGlobal = true) - shown in all cities
     * 2. Enabled for this specific city via CategoryCity junction table
     *
     * If no cityId is provided, returns all active categories (backward compatible)
     */
    getCategories(cityId?: string): Promise<{
        isFeatured: boolean;
        _count: {
            posts: number;
        };
        subcategories: {
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
            isPinnedToHome: boolean;
            homePinOrder: number;
            categoryId: string;
        }[];
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
    }[]>;
    /**
     * Get active posts with pagination and filtering
     */
    getActivePosts(params: {
        page?: number;
        pageSize?: number;
        categoryId?: string;
        subcategoryId?: string;
        cityId?: string;
        search?: string;
        sortBy?: 'newest' | 'price_asc' | 'price_desc' | 'best_selling';
    }): Promise<{
        data: ({
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
            subcategory: {
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
                isPinnedToHome: boolean;
                homePinOrder: number;
                categoryId: string;
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
        })[];
        meta: {
            total: number;
            page: number;
            pageSize: number;
            totalPages: number;
        };
    }>;
    /**
     * Get admin-curated best sellers for a city
     * Returns posts from MarketBestSeller table, ordered by sortOrder
     */
    getCuratedBestSellers(cityId: string, limit?: number): Promise<{
        bestSellerId: string;
        customPrice: number;
        customTitle: string;
        postUri: string;
        category?: {
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
        seller?: {
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
        subcategory?: {
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
            isPinnedToHome: boolean;
            homePinOrder: number;
            categoryId: string;
        };
        status?: import(".prisma/client").$Enums.MarketPostStatus;
        id?: string;
        cityId?: string | null;
        createdAt?: Date;
        updatedAt?: Date;
        currency?: string;
        description?: string | null;
        listingType?: import(".prisma/client").$Enums.ListingType;
        categoryId?: string;
        title?: string;
        sellerId?: string;
        postCid?: string;
        subcategoryId?: string | null;
        price?: number | null;
        quantity?: number;
        soldCount?: number;
        isInStock?: boolean;
        duration?: number | null;
        durationUnit?: import(".prisma/client").$Enums.DurationUnit | null;
        pricingType?: import(".prisma/client").$Enums.PricingType | null;
        minGuests?: number | null;
        maxGuests?: number | null;
        bookingLeadTime?: number | null;
        serviceLocation?: string | null;
        serviceLatitude?: number | null;
        serviceLongitude?: number | null;
        includedItems?: string | null;
        isPrime?: boolean;
        reviewedAt?: Date | null;
        rejectionReason?: string | null;
        isArchived?: boolean;
        replacedById?: string | null;
    }[]>;
    /**
     * Helper to find user by DID
     */
    private findUserByDid;
    /**
     * Helper to find seller by user's DID
     */
    private findSellerByDid;
    /**
     * Get seller profile by DID
     */
    getSellerProfile(did: string): Promise<{
        user: {
            did: string;
            handle: string;
            displayName: string;
            avatarUrl: string;
        };
        posts: {
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
        }[];
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
    }>;
    /**
     * Apply to become a seller
     */
    applyAsSeller(data: {
        did: string;
        storeName: string;
        storeDescription?: string;
        contactPhone?: string;
        contactEmail?: string;
    }): Promise<{
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
    }>;
    /**
     * Create a new product post
     */
    createPost(data: {
        did: string;
        postUri: string;
        postCid: string;
        categoryId: string;
        subcategoryId?: string;
        cityId?: string;
        title: string;
        description?: string;
        price?: number;
        currency?: string;
        quantity?: number;
        duration?: number;
        durationUnit?: string;
        pricingType?: string;
        minGuests?: number;
        maxGuests?: number;
        bookingLeadTime?: number;
        serviceLocation?: string;
        serviceLatitude?: number;
        serviceLongitude?: number;
        includedItems?: string[];
    }): Promise<{
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
    }>;
    /**
     * Helper to verify post ownership
     */
    private verifyPostOwnership;
    /**
     * Update inventory
     */
    updateInventory(postId: string, did: string, quantity: number): Promise<{
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
    }>;
    /**
     * Record a sale
     */
    recordSale(postId: string, did: string, quantitySold: number): Promise<{
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
    }>;
    /**
     * Archive a post
     */
    archivePost(postId: string, did: string): Promise<{
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
    }>;
    /**
     * Delete a post (soft delete via archive or mark as REMOVED)
     */
    deletePost(postId: string, did: string): Promise<{
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
    }>;
    /**
     * Get checkout config for a city (falls back to global if no city-specific config)
     */
    getCheckoutConfig(cityId?: string): Promise<{
        id: string;
        cityId: string | null;
        createdAt: Date;
        updatedAt: Date;
        defaultShippingFee: number;
        freeShippingThreshold: number | null;
        codEnabled: boolean;
        codFeeEnabled: boolean;
        codFeeAmount: number;
        codFeeType: string;
        walletEnabled: boolean;
        cardEnabled: boolean;
        requireFullName: boolean;
        requirePhone: boolean;
        requireStreet: boolean;
        requireCity: boolean;
        requireState: boolean;
        requirePostalCode: boolean;
        requireCountry: boolean;
        defaultCountry: string;
        minOrderAmount: number | null;
        maxOrderAmount: number | null;
    }>;
    /**
     * Update or create checkout config (admin only)
     */
    upsertCheckoutConfig(cityId: string | null, data: {
        defaultShippingFee?: number;
        freeShippingThreshold?: number | null;
        codEnabled?: boolean;
        codFeeEnabled?: boolean;
        codFeeAmount?: number;
        codFeeType?: string;
        walletEnabled?: boolean;
        cardEnabled?: boolean;
        requireFullName?: boolean;
        requirePhone?: boolean;
        requireStreet?: boolean;
        requireCity?: boolean;
        requireState?: boolean;
        requirePostalCode?: boolean;
        requireCountry?: boolean;
        defaultCountry?: string;
        minOrderAmount?: number | null;
        maxOrderAmount?: number | null;
    }): Promise<{
        id: string;
        cityId: string | null;
        createdAt: Date;
        updatedAt: Date;
        defaultShippingFee: number;
        freeShippingThreshold: number | null;
        codEnabled: boolean;
        codFeeEnabled: boolean;
        codFeeAmount: number;
        codFeeType: string;
        walletEnabled: boolean;
        cardEnabled: boolean;
        requireFullName: boolean;
        requirePhone: boolean;
        requireStreet: boolean;
        requireCity: boolean;
        requireState: boolean;
        requirePostalCode: boolean;
        requireCountry: boolean;
        defaultCountry: string;
        minOrderAmount: number | null;
        maxOrderAmount: number | null;
    }>;
    /**
     * Get all checkout configs (for admin listing)
     */
    getAllCheckoutConfigs(): Promise<({
        city: {
            code: string;
            id: string;
            name: string;
        };
    } & {
        id: string;
        cityId: string | null;
        createdAt: Date;
        updatedAt: Date;
        defaultShippingFee: number;
        freeShippingThreshold: number | null;
        codEnabled: boolean;
        codFeeEnabled: boolean;
        codFeeAmount: number;
        codFeeType: string;
        walletEnabled: boolean;
        cardEnabled: boolean;
        requireFullName: boolean;
        requirePhone: boolean;
        requireStreet: boolean;
        requireCity: boolean;
        requireState: boolean;
        requirePostalCode: boolean;
        requireCountry: boolean;
        defaultCountry: string;
        minOrderAmount: number | null;
        maxOrderAmount: number | null;
    })[]>;
    /**
     * Delete city-specific checkout config (reverts to global)
     */
    deleteCheckoutConfig(configId: string): Promise<{
        id: string;
        cityId: string | null;
        createdAt: Date;
        updatedAt: Date;
        defaultShippingFee: number;
        freeShippingThreshold: number | null;
        codEnabled: boolean;
        codFeeEnabled: boolean;
        codFeeAmount: number;
        codFeeType: string;
        walletEnabled: boolean;
        cardEnabled: boolean;
        requireFullName: boolean;
        requirePhone: boolean;
        requireStreet: boolean;
        requireCity: boolean;
        requireState: boolean;
        requirePostalCode: boolean;
        requireCountry: boolean;
        defaultCountry: string;
        minOrderAmount: number | null;
        maxOrderAmount: number | null;
    }>;
    /**
     * Get all promo codes (admin)
     */
    getPromoCodes(params?: {
        cityId?: string;
        isActive?: boolean;
    }): Promise<({
        city: {
            code: string;
            id: string;
            name: string;
        };
        _count: {
            usages: number;
        };
    } & {
        value: number;
        code: string;
        type: import(".prisma/client").$Enums.PromoType;
        id: string;
        cityId: string | null;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        description: string | null;
        minOrderAmount: number | null;
        maxDiscount: number | null;
        maxTotalUses: number | null;
        maxUsesPerUser: number;
        totalUsedCount: number;
        validFrom: Date | null;
        validUntil: Date | null;
    })[]>;
    /**
     * Create promo code (admin)
     */
    createPromoCode(data: {
        code: string;
        cityId?: string | null;
        type: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';
        value?: number;
        minOrderAmount?: number | null;
        maxDiscount?: number | null;
        maxTotalUses?: number | null;
        maxUsesPerUser?: number;
        validFrom?: Date | null;
        validUntil?: Date | null;
        isActive?: boolean;
        description?: string | null;
    }): Promise<{
        value: number;
        code: string;
        type: import(".prisma/client").$Enums.PromoType;
        id: string;
        cityId: string | null;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        description: string | null;
        minOrderAmount: number | null;
        maxDiscount: number | null;
        maxTotalUses: number | null;
        maxUsesPerUser: number;
        totalUsedCount: number;
        validFrom: Date | null;
        validUntil: Date | null;
    }>;
    /**
     * Update promo code (admin)
     */
    updatePromoCode(promoId: string, data: {
        code?: string;
        cityId?: string | null;
        type?: 'PERCENTAGE' | 'FIXED' | 'FREE_SHIPPING';
        value?: number;
        minOrderAmount?: number | null;
        maxDiscount?: number | null;
        maxTotalUses?: number | null;
        maxUsesPerUser?: number;
        validFrom?: Date | null;
        validUntil?: Date | null;
        isActive?: boolean;
        description?: string | null;
    }): Promise<{
        value: number;
        code: string;
        type: import(".prisma/client").$Enums.PromoType;
        id: string;
        cityId: string | null;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        description: string | null;
        minOrderAmount: number | null;
        maxDiscount: number | null;
        maxTotalUses: number | null;
        maxUsesPerUser: number;
        totalUsedCount: number;
        validFrom: Date | null;
        validUntil: Date | null;
    }>;
    /**
     * Delete promo code (admin)
     */
    deletePromoCode(promoId: string): Promise<{
        value: number;
        code: string;
        type: import(".prisma/client").$Enums.PromoType;
        id: string;
        cityId: string | null;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        description: string | null;
        minOrderAmount: number | null;
        maxDiscount: number | null;
        maxTotalUses: number | null;
        maxUsesPerUser: number;
        totalUsedCount: number;
        validFrom: Date | null;
        validUntil: Date | null;
    }>;
    /**
     * Validate promo code for checkout (public)
     */
    validatePromoCode(params: {
        code: string;
        userDid: string;
        cityId?: string;
        orderSubtotal: number;
    }): Promise<{
        valid: boolean;
        error?: string;
        promo?: {
            id: string;
            code: string;
            type: string;
            value: number;
            maxDiscount?: number | null;
        };
        discount: number;
    }>;
    /**
     * Record promo code usage (called after successful order)
     */
    recordPromoUsage(params: {
        promoCodeId: string;
        userDid: string;
        orderId?: string;
        discountAmount: number;
    }): Promise<void>;
    /**
     * Save a search query to user's history
     */
    saveSearchHistory(params: {
        userDid: string;
        query: string;
        resultsCount?: number;
    }): Promise<{
        id: string;
        createdAt: Date;
        userDid: string;
        query: string;
        resultsCount: number;
    }>;
    /**
     * Get user's recent search history
     */
    getSearchHistory(userDid: string, limit?: number): Promise<{
        id: string;
        createdAt: Date;
        query: string;
        resultsCount: number;
    }[]>;
    /**
     * Clear user's search history
     */
    clearSearchHistory(userDid: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    /**
     * Delete a single search history entry
     */
    deleteSearchHistoryItem(userDid: string, searchId: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    /**
     * Track a product visit
     */
    trackProductVisit(params: {
        userDid: string;
        postId: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        userDid: string;
        postId: string;
        visitCount: number;
        lastVisitedAt: Date;
    }>;
    /**
     * Get user's recently visited products
     */
    getVisitedProducts(userDid: string, limit?: number): Promise<{
        visitCount: number;
        lastVisitedAt: Date;
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
        subcategory: {
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
            isPinnedToHome: boolean;
            homePinOrder: number;
            categoryId: string;
        };
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
    }[]>;
    /**
     * Clear user's visited products history
     */
    clearVisitedProducts(userDid: string): Promise<import(".prisma/client").Prisma.BatchPayload>;
    /**
     * Get availability slots for a service
     */
    getServiceAvailability(postId: string, params?: {
        startDate?: string;
        endDate?: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        postId: string;
        startTime: string | null;
        endTime: string | null;
        totalSlots: number;
        bookedSlots: number;
        priceOverride: number | null;
        isAvailable: boolean;
    }[]>;
    /**
     * Create/update availability slots for a service
     */
    setServiceAvailability(postId: string, did: string, slots: Array<{
        date: string;
        startTime?: string;
        endTime?: string;
        totalSlots?: number;
        priceOverride?: number;
        isAvailable?: boolean;
    }>): Promise<any[]>;
    /**
     * Delete availability slots
     */
    deleteServiceAvailability(postId: string, did: string, slotIds: string[]): Promise<import(".prisma/client").Prisma.BatchPayload>;
    /**
     * Bulk generate availability slots for a date range
     */
    generateAvailabilitySlots(postId: string, did: string, params: {
        startDate: string;
        endDate: string;
        startTime?: string;
        endTime?: string;
        slotDuration?: number;
        totalSlotsPerSlot?: number;
        excludeDays?: number[];
    }): Promise<any[]>;
    /**
     * Book a slot (increment bookedSlots)
     */
    bookSlot(slotId: string, quantity?: number): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        postId: string;
        startTime: string | null;
        endTime: string | null;
        totalSlots: number;
        bookedSlots: number;
        priceOverride: number | null;
        isAvailable: boolean;
    }>;
    /**
     * Cancel a booking (decrement bookedSlots) - DEPRECATED: Use cancelServiceBooking instead
     */
    cancelBooking(slotId: string, quantity?: number): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        postId: string;
        startTime: string | null;
        endTime: string | null;
        totalSlots: number;
        bookedSlots: number;
        priceOverride: number | null;
        isAvailable: boolean;
    }>;
    /**
     * Create a service booking with full tracking
     */
    createServiceBooking(data: {
        serviceAvailabilityId: string;
        userDid: string;
        guestCount?: number;
        customerName?: string;
        customerPhone?: string;
        customerEmail?: string;
        specialRequests?: string;
        orderItemId?: string;
        paymentMethod?: 'PAY_ON_ARRIVAL' | 'PREPAID';
    }): Promise<{
        serviceAvailability: {
            post: {
                id: string;
                title: string;
                sellerId: string;
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            date: Date;
            postId: string;
            startTime: string | null;
            endTime: string | null;
            totalSlots: number;
            bookedSlots: number;
            priceOverride: number | null;
            isAvailable: boolean;
        };
    } & {
        status: import(".prisma/client").$Enums.ServiceBookingStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        currency: string;
        completedAt: Date | null;
        cancelledAt: Date | null;
        cancelledBy: string | null;
        userDid: string;
        paymentMethod: import(".prisma/client").$Enums.ServicePaymentMethod;
        guestCount: number;
        totalPrice: number;
        customerName: string | null;
        customerPhone: string | null;
        customerEmail: string | null;
        specialRequests: string | null;
        sellerNotes: string | null;
        cancellationReason: string | null;
        confirmedAt: Date | null;
        serviceAvailabilityId: string;
        orderItemId: string | null;
    }>;
    /**
     * Get a single booking by ID
     */
    getServiceBooking(bookingId: string): Promise<{
        serviceAvailability: {
            post: {
                id: string;
                currency: string;
                title: string;
                sellerId: string;
                price: number;
                duration: number;
                durationUnit: import(".prisma/client").$Enums.DurationUnit;
                serviceLocation: string;
                seller: {
                    userId: string;
                    user: {
                        did: string;
                    };
                    storeName: string;
                };
            };
        } & {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            date: Date;
            postId: string;
            startTime: string | null;
            endTime: string | null;
            totalSlots: number;
            bookedSlots: number;
            priceOverride: number | null;
            isAvailable: boolean;
        };
    } & {
        status: import(".prisma/client").$Enums.ServiceBookingStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        currency: string;
        completedAt: Date | null;
        cancelledAt: Date | null;
        cancelledBy: string | null;
        userDid: string;
        paymentMethod: import(".prisma/client").$Enums.ServicePaymentMethod;
        guestCount: number;
        totalPrice: number;
        customerName: string | null;
        customerPhone: string | null;
        customerEmail: string | null;
        specialRequests: string | null;
        sellerNotes: string | null;
        cancellationReason: string | null;
        confirmedAt: Date | null;
        serviceAvailabilityId: string;
        orderItemId: string | null;
    }>;
    /**
     * Get all bookings for a user (buyer view)
     */
    getUserBookings(userDid: string, options?: {
        status?: string;
        upcoming?: boolean;
        page?: number;
        pageSize?: number;
    }): Promise<{
        data: ({
            serviceAvailability: {
                post: {
                    id: string;
                    currency: string;
                    title: string;
                    postUri: string;
                    price: number;
                    duration: number;
                    durationUnit: import(".prisma/client").$Enums.DurationUnit;
                    serviceLocation: string;
                    seller: {
                        userId: string;
                        user: {
                            did: string;
                        };
                        storeName: string;
                    };
                };
            } & {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                date: Date;
                postId: string;
                startTime: string | null;
                endTime: string | null;
                totalSlots: number;
                bookedSlots: number;
                priceOverride: number | null;
                isAvailable: boolean;
            };
        } & {
            status: import(".prisma/client").$Enums.ServiceBookingStatus;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            currency: string;
            completedAt: Date | null;
            cancelledAt: Date | null;
            cancelledBy: string | null;
            userDid: string;
            paymentMethod: import(".prisma/client").$Enums.ServicePaymentMethod;
            guestCount: number;
            totalPrice: number;
            customerName: string | null;
            customerPhone: string | null;
            customerEmail: string | null;
            specialRequests: string | null;
            sellerNotes: string | null;
            cancellationReason: string | null;
            confirmedAt: Date | null;
            serviceAvailabilityId: string;
            orderItemId: string | null;
        })[];
        total: number;
        page: number;
        pageSize: number;
    }>;
    /**
     * Get all bookings for a seller's service post
     */
    getSellerBookings(postId: string, sellerDid: string, options?: {
        date?: string;
        status?: string;
        page?: number;
        pageSize?: number;
    }): Promise<{
        data: ({
            serviceAvailability: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                date: Date;
                postId: string;
                startTime: string | null;
                endTime: string | null;
                totalSlots: number;
                bookedSlots: number;
                priceOverride: number | null;
                isAvailable: boolean;
            };
        } & {
            status: import(".prisma/client").$Enums.ServiceBookingStatus;
            id: string;
            createdAt: Date;
            updatedAt: Date;
            currency: string;
            completedAt: Date | null;
            cancelledAt: Date | null;
            cancelledBy: string | null;
            userDid: string;
            paymentMethod: import(".prisma/client").$Enums.ServicePaymentMethod;
            guestCount: number;
            totalPrice: number;
            customerName: string | null;
            customerPhone: string | null;
            customerEmail: string | null;
            specialRequests: string | null;
            sellerNotes: string | null;
            cancellationReason: string | null;
            confirmedAt: Date | null;
            serviceAvailabilityId: string;
            orderItemId: string | null;
        })[];
        total: number;
        page: number;
        pageSize: number;
    }>;
    /**
     * Confirm a booking (seller action)
     */
    confirmServiceBooking(bookingId: string, sellerDid: string): Promise<{
        status: import(".prisma/client").$Enums.ServiceBookingStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        currency: string;
        completedAt: Date | null;
        cancelledAt: Date | null;
        cancelledBy: string | null;
        userDid: string;
        paymentMethod: import(".prisma/client").$Enums.ServicePaymentMethod;
        guestCount: number;
        totalPrice: number;
        customerName: string | null;
        customerPhone: string | null;
        customerEmail: string | null;
        specialRequests: string | null;
        sellerNotes: string | null;
        cancellationReason: string | null;
        confirmedAt: Date | null;
        serviceAvailabilityId: string;
        orderItemId: string | null;
    }>;
    /**
     * Cancel a service booking (no refund policy)
     */
    cancelServiceBooking(bookingId: string, cancelledByDid: string, reason?: string): Promise<{
        status: import(".prisma/client").$Enums.ServiceBookingStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        currency: string;
        completedAt: Date | null;
        cancelledAt: Date | null;
        cancelledBy: string | null;
        userDid: string;
        paymentMethod: import(".prisma/client").$Enums.ServicePaymentMethod;
        guestCount: number;
        totalPrice: number;
        customerName: string | null;
        customerPhone: string | null;
        customerEmail: string | null;
        specialRequests: string | null;
        sellerNotes: string | null;
        cancellationReason: string | null;
        confirmedAt: Date | null;
        serviceAvailabilityId: string;
        orderItemId: string | null;
    }>;
    /**
     * Mark booking as completed (seller action after service delivery)
     */
    completeServiceBooking(bookingId: string, sellerDid: string): Promise<{
        status: import(".prisma/client").$Enums.ServiceBookingStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        currency: string;
        completedAt: Date | null;
        cancelledAt: Date | null;
        cancelledBy: string | null;
        userDid: string;
        paymentMethod: import(".prisma/client").$Enums.ServicePaymentMethod;
        guestCount: number;
        totalPrice: number;
        customerName: string | null;
        customerPhone: string | null;
        customerEmail: string | null;
        specialRequests: string | null;
        sellerNotes: string | null;
        cancellationReason: string | null;
        confirmedAt: Date | null;
        serviceAvailabilityId: string;
        orderItemId: string | null;
    }>;
    /**
     * Mark as no-show (seller action)
     */
    markBookingNoShow(bookingId: string, sellerDid: string): Promise<{
        status: import(".prisma/client").$Enums.ServiceBookingStatus;
        id: string;
        createdAt: Date;
        updatedAt: Date;
        currency: string;
        completedAt: Date | null;
        cancelledAt: Date | null;
        cancelledBy: string | null;
        userDid: string;
        paymentMethod: import(".prisma/client").$Enums.ServicePaymentMethod;
        guestCount: number;
        totalPrice: number;
        customerName: string | null;
        customerPhone: string | null;
        customerEmail: string | null;
        specialRequests: string | null;
        sellerNotes: string | null;
        cancellationReason: string | null;
        confirmedAt: Date | null;
        serviceAvailabilityId: string;
        orderItemId: string | null;
    }>;
    /**
     * Create a recurring availability pattern
     */
    createRecurringPattern(postId: string, sellerDid: string, data: {
        daysOfWeek: number[];
        startTime: string;
        endTime: string;
        slotDurationMinutes: number;
        slotsPerWindow?: number;
        breakBetweenMinutes?: number;
        priceOverride?: number;
        validFrom?: Date;
        validUntil?: Date;
    }): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        validFrom: Date;
        validUntil: Date | null;
        postId: string;
        startTime: string;
        endTime: string;
        priceOverride: number | null;
        daysOfWeek: number[];
        slotDurationMinutes: number;
        slotsPerWindow: number;
        breakBetweenMinutes: number;
    }>;
    /**
     * Get recurring patterns for a service
     */
    getRecurringPatterns(postId: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        validFrom: Date;
        validUntil: Date | null;
        postId: string;
        startTime: string;
        endTime: string;
        priceOverride: number | null;
        daysOfWeek: number[];
        slotDurationMinutes: number;
        slotsPerWindow: number;
        breakBetweenMinutes: number;
    }[]>;
    /**
     * Update a recurring pattern
     */
    updateRecurringPattern(patternId: string, sellerDid: string, data: Partial<{
        daysOfWeek: number[];
        startTime: string;
        endTime: string;
        slotDurationMinutes: number;
        slotsPerWindow: number;
        breakBetweenMinutes: number;
        priceOverride: number | null;
        validUntil: Date | null;
        isActive: boolean;
    }>): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        validFrom: Date;
        validUntil: Date | null;
        postId: string;
        startTime: string;
        endTime: string;
        priceOverride: number | null;
        daysOfWeek: number[];
        slotDurationMinutes: number;
        slotsPerWindow: number;
        breakBetweenMinutes: number;
    }>;
    /**
     * Delete a recurring pattern
     */
    deleteRecurringPattern(patternId: string, sellerDid: string): Promise<{
        id: string;
        createdAt: Date;
        updatedAt: Date;
        isActive: boolean;
        validFrom: Date;
        validUntil: Date | null;
        postId: string;
        startTime: string;
        endTime: string;
        priceOverride: number | null;
        daysOfWeek: number[];
        slotDurationMinutes: number;
        slotsPerWindow: number;
        breakBetweenMinutes: number;
    }>;
    /**
     * Generate slots from recurring patterns for a date range
     * This should be called periodically (cron job) or on-demand
     */
    generateSlotsFromPatterns(postId: string, startDate: Date, endDate: Date): Promise<any[]>;
    private timeToMinutes;
    private minutesToTime;
}
