import axios from "axios";
import { FastMCP } from "fastmcp";
// import { createRequire } from "node:module";
import { z } from "zod";
import "dotenv/config";

import { ProductService } from "./services/product-service.js";

// Initialize services
const productService = new ProductService();

const api_token = process.env.BRIGHT_DATA_API_TOKEN;
const unlocker_zone = process.env.WEB_UNLOCKER_ZONE || "ecommerce_tracker";

if (!api_token) {
	throw new Error("Cannot run MCP server without BRIGHT_DATA_API_TOKEN env");
}

const api_headers = () => ({
	authorization: `Bearer ${api_token}`,
	"user-agent": `pricemorphe/1.0.0`,
});

type Platform =
	| "amazon"
	| "bestbuy"
	| "ebay"
	| "etsy"
	| "homedepot"
	| "unknown"
	| "walmart"
	| "zara";

interface ProductData {
	data: unknown;
	method: string;
	platform: Platform;
	url: string;
}

interface ServerTools {
	// Product Search and Comparison Tools
	compare_prices: {
		execute: (args: {
			platforms?: Platform[];
			query?: string;
			urls?: string[];
		}) => Promise<string>;
	};
	get_price_update: {
		execute: (args: { urls: string[] }) => Promise<string>;
	};
	get_product_details: {
		execute: (args: { url: string }) => Promise<ProductData>;
	};

	get_user_tracked_products: {
		execute: (args: {
			include_price_history?: boolean;
			userId: string;
		}) => Promise<string>;
	};
	search_products: {
		execute: (args: {
			max_results?: number;
			platforms?: Platform[];
			query: string;
		}) => Promise<{ results: ProductData[] }>;
	};
	track_product: {
		execute: (args: {
			productDetails: Record<string, unknown>;
			url: string;
			userId: string;
		}) => Promise<string>;
	};
	untrack_product: {
		execute: (args: {
			productId: string;
			userId: string;
		}) => Promise<string>;
	};
	update_product_prices: {
		execute: (args: {
			updates: Array<{
				currentPrice: number;
				id: string;
			}>;
		}) => Promise<string>;
	};
}

const server = new FastMCP({
	name: "PriceMorphe",
	version: "1.0.0",
}) as { tools: ServerTools } & FastMCP;

// Ensure required zones exist
async function ensure_required_zones() {
	try {
		console.error("Checking for required zones...");
		const response = await axios({
			headers: api_headers(),
			method: "GET",
			url: "https://api.brightdata.com/zone/get_active_zones",
		});
		const zones = response.data || [];
		const has_unlocker_zone = zones.some(
			(zone: { name: string }) => zone.name == unlocker_zone
		);
		if (!has_unlocker_zone) {
			console.error(
				`Required zone "${unlocker_zone}" not found, creating it...`
			);
			await axios({
				data: {
					plan: { type: "unblocker" },
					zone: { name: unlocker_zone, type: "unblocker" },
				},
				headers: {
					...api_headers(),
					"Content-Type": "application/json",
				},
				method: "POST",
				url: "https://api.brightdata.com/zone",
			});
			console.error(`Zone "${unlocker_zone}" created successfully`);
		} else {
			console.error(`Required zone "${unlocker_zone}" already exists`);
		}
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} catch (e: any) {
		console.error(
			"Error checking/creating zones:",
			e.response?.data || e.message
		);
	}
}

await ensure_required_zones();

// Universal product search across multiple platforms
server.addTool({
	description:
		"Search for products across multiple e-commerce platforms (Amazon, eBay, Walmart, etc.). Returns structured product data including prices, ratings, and availability.",
	execute: async ({ platforms, query }) => {
		const results: Array<{
			data?: unknown;
			error?: string;
			platform: Platform;
			search_url: string;
		}> = [];

		for (const platform of platforms) {
			try {
				let search_url = "";
				switch (platform) {
					case "amazon":
						search_url = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
						break;
					case "bestbuy":
						search_url = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(query)}&intl=nosplash`;
						break;
					case "ebay":
						search_url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
						break;
					case "etsy":
						search_url = `https://www.etsy.com/search?q=${encodeURIComponent(query)}`;
						break;
					case "homedepot":
						search_url = `https://www.homedepot.com/search?q=${encodeURIComponent(query)}`;
						break;
					case "walmart":
						search_url = `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
						break;
					case "zara":
						search_url = `https://www.zara.com/us/en/search?q=${encodeURIComponent(query)}`;
						break;
				}

				const response = await axios({
					data: {
						data_format: "markdown",
						format: "raw",
						url: search_url,
						zone: unlocker_zone,
					},
					headers: api_headers(),
					method: "POST",
					responseType: "text",
					url: "https://api.brightdata.com/request",
				});

				results.push({
					data: response.data,
					platform,
					search_url,
				});
			} catch (e: unknown) {
				results.push({
					error:
						e instanceof Error
							? e.message
							: "An unknown error occurred",
					platform,
					search_url: "",
				});
			}
		}

		return JSON.stringify(
			{
				platforms_searched: platforms,
				query,
				results,
			},
			null,
			2
		);
	},
	name: "search_products",
	parameters: z.object({
		max_results: z
			.number()
			.min(1)
			.max(50)
			.optional()
			.default(10)
			.describe("Maximum number of results per platform"),
		platforms: z
			.array(
				z.enum([
					"amazon",
					"ebay",
					"walmart",
					"etsy",
					"bestbuy",
					"homedepot",
					"zara",
				])
			)
			.optional()
			.default(["amazon", "ebay", "walmart"])
			.describe("E-commerce platforms to search"),
		query: z.string().describe("Product search query"),
	}),
});

// Get detailed product information
server.addTool({
	description:
		"Get detailed information about a specific product from its URL. Supports Amazon, eBay, Walmart, Etsy, BestBuy, Home Depot, and Zara.",
	execute: async ({ url }) => {
		const platform = detect_platform(url);
		const dataset_id = get_dataset_id(platform);

		if (!dataset_id) {
			// Fallback to general scraping
			const response = await axios({
				data: {
					data_format: "markdown",
					format: "raw",
					url,
					zone: unlocker_zone,
				},
				headers: api_headers(),
				method: "POST",
				responseType: "text",
				url: "https://api.brightdata.com/request",
			});
			return JSON.stringify(
				{
					data: response.data,
					method: "scraping",
					platform,
					url,
				},
				null,
				2
			);
		}

		// Use structured dataset
		const trigger_response = await axios({
			data: [{ url }],
			headers: api_headers(),
			method: "POST",
			params: { dataset_id, include_errors: true },
			url: "https://api.brightdata.com/datasets/v3/trigger",
		});

		if (!trigger_response.data?.snapshot_id) {
			throw new Error("Failed to trigger dataset collection");
		}

		const snapshot_id = trigger_response.data.snapshot_id;

		// Poll for results
		const max_attempts = 30;
		for (let i = 0; i < max_attempts; i++) {
			await new Promise((resolve) => setTimeout(resolve, 2000));

			const status_response = await axios({
				headers: api_headers(),
				method: "GET",
				url: `https://api.brightdata.com/datasets/v3/progress/${snapshot_id}`,
			});

			if (status_response.data.status === "running") continue;

			if (status_response.data.status === "failed") {
				throw new Error("Dataset collection failed");
			}

			// Get results
			const results_response = await axios({
				headers: api_headers(),
				method: "GET",
				url: `https://api.brightdata.com/datasets/v3/snapshot/${snapshot_id}`,
			});

			const product_data = {
				data: results_response.data,
				method: "structured_dataset",
				platform,
				url,
			};

			return JSON.stringify(product_data, null, 2);
		}

		throw new Error("Timeout waiting for dataset results");
	},
	name: "get_product_details",
	parameters: z.object({
		url: z.string().url().describe("Product URL"),
	}),
});

// Price comparison across platforms
server.addTool({
	description:
		"Compare prices for a product across multiple e-commerce platforms. Provide either a search query or specific product URLs.",
	execute: async ({ platforms, query, urls }) => {
		let comparison_results = [];

		if (urls && urls.length > 0) {
			// Compare specific URLs
			for (const url of urls) {
				try {
					const product_details =
						await server.tools.get_product_details.execute({ url });
					comparison_results.push(product_details);
				} catch (e: unknown) {
					console.log((e as Error).message);
				}
			}
		} else if (query) {
			// Search and compare
			const search_results = await server.tools.search_products.execute({
				// max_results: 5,
				platforms,
				query,
			});
			comparison_results = search_results.results;
		} else {
			throw new Error("Either query or urls must be provided");
		}

		return JSON.stringify(
			{
				query: query || null,
				results: comparison_results,
				timestamp: new Date().toISOString(),
				type: urls ? "url_comparison" : "search_comparison",
			},
			null,
			2
		);
	},
	name: "compare_prices",
	parameters: z.object({
		platforms: z
			.array(z.enum(["amazon", "ebay", "walmart", "etsy", "bestbuy"]))
			.optional()
			.default(["amazon", "ebay", "walmart"])
			.describe("Platforms to compare (only used with query)"),
		query: z.string().optional().describe("Product search query"),
		urls: z
			.array(z.string().url())
			.optional()
			.describe("Specific product URLs to compare"),
	}),
});

// Update prices for tracked products
server.addTool({
	description: "Update price information for all tracked products.",
	execute: async ({ urls }) => {
		const updates = [];

		for (const product_url of urls) {
			try {
				const current_data =
					await server.tools.get_product_details.execute({
						url: product_url,
					});

				updates.push({
					data: current_data,
					status: "updated",
					url: product_url,
				});
			} catch (e: unknown) {
				updates.push({
					error: (e as Error).message,
					status: "error",
					url: product_url,
				});
			}
		}

		return JSON.stringify(
			{
				timestamp: new Date().toISOString(),
				updated_products: updates.length,
				updates,
			},
			null,
			2
		);
	},
	name: "get_price_update",
	parameters: z.object({
		urls: z
			.array(z.string().url())
			.optional()
			.default([])
			.describe("Specific product URLs to update"),
	}),
});

// Product Management Tools
server.addTool({
	description: "Get all products tracked by a specific user",
	execute: async ({ include_price_history, userId }) => {
		const products = await productService.getUserTrackedProducts(
			userId,
			include_price_history
		);
		return JSON.stringify(products, null, 2);
	},
	name: "get_user_tracked_products",
	parameters: z.object({
		include_price_history: z.boolean().optional().default(false),
		userId: z.string(),
	}),
});

server.addTool({
	description: "Track a new product for a user",
	execute: async ({ productDetails, url, userId }) => {
		const product = await productService.trackProduct(
			userId,
			url,
			productDetails
		);
		return JSON.stringify(product, null, 2);
	},
	name: "track_product",
	parameters: z.object({
		productDetails: z.any(),
		url: z.string().url(),
		userId: z.string(),
	}),
});

server.addTool({
	description: "Stop tracking a product for a user",
	execute: async ({ productId, userId }) => {
		const result = await productService.untrackProduct(userId, productId);
		return JSON.stringify(result, null, 2);
	},
	name: "untrack_product",
	parameters: z.object({
		productId: z.string(),
		userId: z.string(),
	}),
});

server.addTool({
	description: "Update prices for multiple tracked products",
	execute: async ({ updates }) => {
		const result = await productService.updateAllProducts(updates);
		return JSON.stringify(result, null, 2);
	},
	name: "update_product_prices",
	parameters: z.object({
		updates: z.array(
			z.object({
				currentPrice: z.number(),
				id: z.string(),
			})
		),
	}),
});

// Helper functions
function detect_platform(url: string): Platform {
	if (url.includes("amazon.")) return "amazon";
	if (url.includes("ebay.")) return "ebay";
	if (url.includes("walmart.")) return "walmart";
	if (url.includes("etsy.")) return "etsy";
	if (url.includes("bestbuy.")) return "bestbuy";
	if (url.includes("homedepot.")) return "homedepot";
	if (url.includes("zara.")) return "zara";
	return "unknown";
}

function get_dataset_id(platform: Platform): string | undefined {
	const dataset_map: Record<Platform, string> = {
		amazon: "gd_l7q7dkf244hwjntr0",
		bestbuy: "gd_ltre1jqe1jfr7cccf",
		ebay: "gd_ltr9mjt81n0zzdk1fb",
		etsy: "gd_ltppk0jdv1jqz25mz",
		homedepot: "gd_lmusivh019i7g97q2n",
		unknown: "",
		walmart: "gd_l95fol7l1ru6rlo116",
		zara: "gd_lct4vafw1tgx27d4o0",
	};
	return dataset_map[platform] || undefined;
}

server.start();
