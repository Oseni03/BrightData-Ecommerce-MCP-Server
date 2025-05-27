import { prisma } from "../lib/prisma.js";

interface ProductDetails {
	currentPrice?: number;
	name?: string;
	platform?: string;
}

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

	async getUserTrackedProducts(
		userId: string,
		include_price_history = false
	) {
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

	async trackProduct(
		userId: string,
		url: string,
		productDetails: ProductDetails
	) {
		const user = await prisma.user.findUnique({
			where: { userId },
		});

		if (!user) {
			throw new Error("User not found");
		}

		return await prisma.product.create({
			data: {
				name: productDetails.name || "New Product",
				platform: productDetails.platform || new URL(url).hostname,
				prices: {
					create: {
						amount: productDetails.currentPrice || 0,
					},
				},
				tracking_type: "price",
				url,
				userId: user.id,
			},
		});
	}

	async untrackProduct(userId: string, productId: string) {
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

	async updateAllProducts(data: { currentPrice: number; id: string }[]) {
		const updates = data.map((item) =>
			prisma.product.update({
				data: {
					prices: {
						create: {
							amount: item.currentPrice,
						},
					},
				},
				where: { id: item.id },
			})
		);

		return await prisma.$transaction(updates);
	}
}
