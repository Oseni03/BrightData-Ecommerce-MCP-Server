import { prisma } from "../lib/prisma.js";
export class ProductService {
    async getAllTrackedProducts() {
        return await prisma.product.findMany({
            include: {
                prices: {
                    orderBy: {
                        createdAt: "desc",
                    },
                    take: 1,
                },
            },
        });
    }
    async getUserTrackedProducts(userId, include_price_history = false) {
        return await prisma.product.findMany({
            include: {
                prices: include_price_history,
            },
            where: {
                User: {
                    userId,
                },
            },
        });
    }
    async trackProduct(userId, productDetails) {
        const user = await prisma.user.findUnique({
            where: { userId },
        });
        if (!user) {
            throw new Error("User not found");
        }
        return await prisma.product.create({
            data: {
                name: productDetails.name || "New Product",
                platform: productDetails.platform ||
                    new URL(productDetails.url).hostname,
                prices: {
                    create: {
                        amount: productDetails.currentPrice || 0,
                    },
                },
                tracking_type: "price",
                url: productDetails.url instanceof URL
                    ? productDetails.url.toString()
                    : productDetails.url,
                userId: user.id,
            },
        });
    }
    async untrackProduct(userId, productId) {
        const user = await prisma.user.findUnique({
            where: { userId },
        });
        if (!user) {
            throw new Error("User not found");
        }
        return await prisma.product.delete({
            where: {
                id: productId,
                userId: user.id,
            },
        });
    }
    async updateAllProducts(data) {
        const updates = data.map((item) => prisma.product.update({
            data: {
                prices: {
                    create: {
                        amount: item.currentPrice,
                    },
                },
            },
            where: { id: item.id },
        }));
        return await prisma.$transaction(updates);
    }
}
